// Browser-side AgentClient. Streams AgentEvent from the Node Core over SSE and reduces
// them into a live session model. It deliberately has no React dependency.

import { fileTypeOf, type AgentClient, type AgentEvent } from './contracts';
import type {
  CustomModelEntry,
  Message,
  ModelConfigFile,
  ModelConfigImportResult,
  ModelOption,
  ModelTestResult,
  PiInheritancePreview,
  RuntimeBootstrapResult,
  SessionSummary,
  UpdateModelEntry,
  WorkspaceChange,
} from './types';
import { DEMO_CONTENTS, DEMO_FILES, DEMO_MESSAGES } from './demo-data';
import { visiblePrompt } from './prompt';
import { messageOf, requestJson } from './request';
import {
  emptyStreamingTurn,
  initialAgentClientState,
  initialAgentState,
  reduceAgentEvent,
  type AgentClientState,
  type AgentState,
} from './state';

type ActionResult = { ok: boolean; error?: string };

export class BrowserAgentClient implements AgentClient {
  private state: AgentClientState = initialAgentClientState;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: AgentEvent) => void>();
  private es: EventSource | null = null;
  private reconnectTimer: number | null = null;
  private onOffline = () => {
    this.set({ connectionStatus: 'reconnecting' });
    if (this.es?.readyState === EventSource.CLOSED) this.scheduleReconnect(this.es);
  };
  private onOnline = () => {
    if (this.state.connectionStatus !== 'reconnecting') return;
    // Force a fresh authoritative snapshot after the browser regains connectivity. Some
    // engines keep the old EventSource object alive while offline and never emit `open` again.
    this.es?.close();
    this.es = null;
    this.scheduleReconnect(null);
  };

  constructor() {
    if (typeof window !== 'undefined') {
      this.connect();
      window.addEventListener('offline', this.onOffline);
      window.addEventListener('online', this.onOnline);
      this.refreshHealth();
    }
  }

  /** Pull workspace-level health metadata from Core. Session snapshots are loaded by ID. */
  async refreshHealth() {
    try {
      const h = await requestJson<{ model?: string; workspaceRoot?: string; cwd?: string }>('/api/health');
      this.set({
        model: h.model ?? null,
        workspaceRoot: h.workspaceRoot ?? null,
      });
    } catch { /* server not ready yet — retry on next interaction */ }
  }

  private connect() {
    if (this.es) return;
    try {
      const stream = new EventSource('/api/events');
      this.es = stream;
      stream.onopen = () => {
        const knownSessionIds = Object.keys(this.state.sessions);
        if (this.state.connectionStatus !== 'reconnecting' || knownSessionIds.length === 0) {
          this.set({ connectionStatus: 'connected' });
          return;
        }
        // The event stream is intentionally not bound to a process-global "current" Session.
        // Reconcile only the Session records already known by this browser instance.
        void Promise.all(knownSessionIds.map(id => this.getSession(id))).then(() => {
          if (this.es === stream) this.set({ connectionStatus: 'connected' });
        });
      };
      stream.onmessage = (msg) => {
        try { this.reduce(JSON.parse(msg.data) as AgentEvent); } catch { /* skip keepalive comments */ }
      };
      stream.onerror = () => {
        if (this.es !== stream) return;
        this.set({ connectionStatus: 'reconnecting' });
        // Native EventSource retries transient failures. Recreate only after a terminal close
        // (for example after a proxy returns an unrecoverable response).
        if (stream.readyState === EventSource.CLOSED) this.scheduleReconnect(stream);
      };
    } catch {
      this.set({ connectionStatus: 'reconnecting' });
      this.scheduleReconnect(null);
    }
  }

  private scheduleReconnect(closedStream: EventSource | null) {
    if (this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (closedStream && this.es !== closedStream) return;
      if (closedStream) closedStream.close();
      this.es = null;
      this.connect();
    }, 1500);
  }

  // ---- AgentClient contract: deliver raw events to subscribers ----
  subscribe = (fn: (e: AgentEvent) => void): (() => void) => {
    this.eventListeners.add(fn);
    return () => { this.eventListeners.delete(fn); };
  };

  // ---- external store contract (for useSyncExternalStore) ----
  storeSubscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getSnapshot = (): AgentClientState => this.state;
  private emit() { for (const l of this.listeners) l(); }
  private set(patch: Partial<AgentClientState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private sessionState(id: string): AgentState {
    return this.state.sessions[id] ?? {
      ...initialAgentState,
      model: this.state.model,
      workspaceRoot: this.state.workspaceRoot,
      connectionStatus: this.state.connectionStatus,
    };
  }

  private setSession(id: string, patch: Partial<AgentState>) {
    const current = this.sessionState(id);
    this.set({ sessions: { ...this.state.sessions, [id]: { ...current, ...patch } } });
  }

  private reduce(e: AgentEvent) {
    for (const l of this.eventListeners) l(e);
    const current = { ...this.sessionState(e.sessionId), connectionStatus: this.state.connectionStatus };
    const patch = reduceAgentEvent(current, e);
    if (patch) this.setSession(e.sessionId, patch);
    if (e.type === 'session_snapshot' && this.state.connectionStatus === 'reconnecting') {
      this.set({ connectionStatus: 'connected' });
    }
  }

  // ---- AgentClient methods (HTTP) ----
  async prompt(sessionId: string, text: string, displayText?: string, workspaceChanges: WorkspaceChange[] = []): Promise<boolean> {
    const visible = visiblePrompt(displayText || text);
    const userMsg: Message = {
      role: 'user', text: visible.text, attachments: visible.attachments,
      workspaceChanges: workspaceChanges.length ? workspaceChanges : undefined, when: '刚刚',
    };
    const state = this.sessionState(sessionId);
    this.setSession(sessionId, {
      messages: [...state.messages, userMsg],
      streaming: emptyStreamingTurn(),
      loading: true,
      error: null,
    });
    try {
      await requestJson('/api/prompt', {
        method: 'POST',
        body: { sessionId, text, displayText: displayText || text, workspaceChanges },
        errorMessage: '服务器未接受本轮任务',
      });
      return true;
    } catch (error) {
      this.setSession(sessionId, { error: 'network: ' + messageOf(error), loading: false });
      return false;
    }
  }

  async steer(sessionId: string, text: string, displayText?: string, workspaceChanges: WorkspaceChange[] = []): Promise<boolean> {
    try {
      const result = await requestJson<{ ok?: boolean; error?: string }>('/api/steer', {
        method: 'POST',
        body: { sessionId, text, displayText: displayText || text, workspaceChanges },
        errorMessage: 'Agent 无法插入当前指令',
      });
      if (!result.ok) throw new Error(result.error || 'Agent 无法插入当前指令');
      return true;
    } catch (error) {
      this.setSession(sessionId, { error: 'network: ' + messageOf(error) });
      return false;
    }
  }

  async interruptAndSteer(sessionId: string, text: string, displayText?: string, workspaceChanges: WorkspaceChange[] = []): Promise<boolean> {
    try {
      const result = await requestJson<{ ok?: boolean; error?: string }>('/api/interrupt', {
        method: 'POST',
        body: { sessionId, text, displayText: displayText || text, workspaceChanges },
        errorMessage: 'Agent 中断失败',
      });
      if (!result.ok) throw new Error(result.error || 'Agent 中断失败');
      return true;
    } catch (error) {
      // Keep the current live turn intact: this can be a transient transport loss and the SSE
      // reconnect path will reconcile it instead of incorrectly presenting the turn as finished.
      this.setSession(sessionId, { error: 'network: ' + messageOf(error) });
      return false;
    }
  }

  async setThinking(sessionId: string, on: boolean): Promise<void> {
    try {
      await requestJson('/api/thinking', { method: 'POST', body: { sessionId, on } });
    } catch { /* ignore */ }
  }

  // ---- model configuration (plain HTTP; the drawer refreshes view state after) ----
  async listModels(): Promise<ModelOption[]> {
    try { return (await requestJson<{ models?: ModelOption[] }>('/api/models')).models ?? []; }
    catch { return []; }
  }
  async getModelConfigFile(): Promise<ModelConfigFile> {
    return requestJson<ModelConfigFile>('/api/models/config', { errorMessage: '无法读取 models.json' });
  }
  async saveModelConfigFile(content: string): Promise<{ ok: boolean; error?: string; file?: ModelConfigFile; models?: ModelOption[] }> {
    try {
      return await requestJson('/api/models/config', { method: 'PUT', body: { content } });
    } catch (error) { return { ok: false, error: 'network: ' + messageOf(error) }; }
  }
  async parseModelConfigFile(content: string): Promise<ModelConfigImportResult> {
    try {
      return await requestJson('/api/models/config/parse', { method: 'POST', body: { content } });
    } catch (error) { return { ok: false, error: 'network: ' + messageOf(error) }; }
  }
  async testCustomModel(entry: CustomModelEntry, prompt: string): Promise<ModelTestResult> {
    try {
      return await requestJson('/api/models/custom/test', { method: 'POST', body: { ...entry, prompt } });
    } catch (error) { return { ok: false, error: 'network: ' + messageOf(error) }; }
  }
  async testModel(providerId: string, modelId: string, benchmark = false, prompt = ''): Promise<ModelTestResult> {
    try {
      return await requestJson('/api/models/test', {
        method: 'POST', body: { providerId, modelId, benchmark, prompt },
      });
    } catch (error) { return { ok: false, error: 'network: ' + messageOf(error) }; }
  }
  async addCustomModel(entry: CustomModelEntry): Promise<{ ok: boolean; error?: string; entry?: CustomModelEntry }> {
    try {
      return await requestJson('/api/models/custom', { method: 'POST', body: entry });
    } catch (error) { return { ok: false, error: 'network: ' + messageOf(error) }; }
  }
  async updateModel(
    providerId: string,
    modelId: string,
    update: UpdateModelEntry,
  ): Promise<{ ok: boolean; error?: string; model?: string }> {
    try {
      return await requestJson('/api/models/custom', {
        method: 'PUT',
        body: { providerId, modelId, update },
      });
    } catch (error) { return { ok: false, error: 'network: ' + messageOf(error) }; }
  }
  async removeCustomModel(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      return await requestJson('/api/models/custom?id=' + encodeURIComponent(id), { method: 'DELETE' });
    } catch (error) { return { ok: false, error: 'network: ' + messageOf(error) }; }
  }
  async setActiveModel(sessionId: string, providerId: string, modelId: string): Promise<{ ok: boolean; error?: string; model?: string }> {
    try {
      const r = await requestJson<{ ok: boolean; error?: string; model?: string }>('/api/models/active', {
        method: 'POST', body: { sessionId, providerId, modelId },
      });
      await this.refreshHealth();   // update the active model shown in the topbar/drawer
      return r;
    } catch (error) { return { ok: false, error: 'network: ' + messageOf(error) }; }
  }

  /** Ask Core's SkillHarness to turn one completed Agent message plus its trajectory into a local Skill. */
  async createSkillFromTurn(sessionId: string, messageIndex: number): Promise<{ ok: boolean; error?: string; skill?: { id: string; name: string } }> {
    try {
      const result = await requestJson<ActionResult & { skill?: { id: string; name: string } }>('/api/skills/from-turn', {
        method: 'POST',
        body: { sessionId, messageIndex },
        errorMessage: '无法从本轮生成 Skill',
      });
      if (!result.ok) {
        const error = result.error || '无法从本轮生成 Skill';
        this.setSession(sessionId, { error });
        return { ok: false, error };
      }
      return { ok: true, skill: result.skill };
    } catch (cause) {
      const error = 'network: ' + messageOf(cause);
      this.setSession(sessionId, { error });
      return { ok: false, error };
    }
  }

  async saveFile(sessionId: string, path: string, content: string): Promise<{ ok: boolean; error?: string }> {
    const state = this.sessionState(sessionId);
    const hadPrevious = Object.prototype.hasOwnProperty.call(state.contents, path);
    const previous = state.contents[path];
    this.setSession(sessionId, { contents: { ...state.contents, [path]: content }, error: null });
    const rollback = (error: string) => {
      const contents = { ...this.sessionState(sessionId).contents };
      // Do not overwrite a newer live update that arrived while this request was in flight.
      if (contents[path] === content) {
        if (hadPrevious) contents[path] = previous;
        else delete contents[path];
      }
      this.setSession(sessionId, { contents });
      return { ok: false, error };
    };
    try {
      const result = await requestJson<ActionResult>('/api/file', {
        method: 'POST',
        body: { sessionId, path, content },
        errorMessage: '服务器未能写入文件',
      });
      if (!result.ok) return rollback(result.error || '服务器未能写入文件');
      return { ok: true };
    } catch (error) {
      return rollback(messageOf(error));
    }
  }

  async importFile(sessionId: string, path: string, data: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await requestJson<ActionResult>('/api/file/import', {
        method: 'POST',
        body: { sessionId, path, data },
        errorMessage: '服务器未能导入 Office 文件',
      });
      if (!result.ok) return { ok: false, error: result.error || '服务器未能导入 Office 文件' };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  async renameFile(sessionId: string, path: string, nextPath: string): Promise<{ ok: boolean; error?: string; path?: string }> {
    try {
      const result = await requestJson<ActionResult & { path?: string }>('/api/file/rename', {
        method: 'POST',
        body: { sessionId, path, nextPath },
        errorMessage: '重命名失败',
      });
      if (!result.ok) return { ok: false, error: result.error || '重命名失败' };
      const next = String(result.path || nextPath);
      const state = this.sessionState(sessionId);
      const fileList = state.fileList.map(f => (f.path || f.name) === path
        ? { ...f, name: next.replace(/\\/g, '/').split('/').pop() || f.name, path: next, type: fileTypeOf(next) }
        : f);
      const contents = { ...state.contents };
      if (Object.prototype.hasOwnProperty.call(contents, path)) {
        contents[next] = contents[path];
        delete contents[path];
      }
      this.setSession(sessionId, { fileList, contents });
      return { ok: true, path: next };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  async deleteFile(sessionId: string, path: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await requestJson<ActionResult>('/api/file?sessionId=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(path), {
        method: 'DELETE',
        errorMessage: '删除失败',
      });
      if (!result.ok) return { ok: false, error: result.error || '删除失败' };
      const state = this.sessionState(sessionId);
      const contents = { ...state.contents };
      delete contents[path];
      this.setSession(sessionId, {
        fileList: state.fileList.filter(f => (f.path || f.name) !== path),
        contents,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  /** Change the agent's working directory. The Core re-binds its session to the new cwd, so the
   *  current conversation/files (which belonged to the old workspace) are reset here too. */
  async setCwd(path: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await requestJson<ActionResult & {
        workspaceRoot?: string;
        cwd?: string;
        model?: string;
      }>('/api/cwd', { method: 'POST', body: { path } });
      if (!r.ok) return { ok: false, error: r.error };
      this.set({
        sessions: {},
        workspaceRoot: r.workspaceRoot ?? path,
        model: r.model ?? this.state.model,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  async inspectPiInheritance(): Promise<PiInheritancePreview> {
    return requestJson<PiInheritancePreview>('/api/pi/inheritance', {
      errorMessage: '无法检查本机 Pi 配置',
    });
  }

  async bootstrapRuntime(inheritPi: boolean): Promise<RuntimeBootstrapResult> {
    try {
      const result = await requestJson<RuntimeBootstrapResult>('/api/runtime/bootstrap', {
        method: 'POST',
        body: { inheritPi },
        errorMessage: '无法初始化 Pi Runtime',
      });
      await this.refreshHealth();
      return result;
    } catch (error) {
      return {
        ok: false,
        inherited: false,
        preview: {
          available: false,
          applied: false,
          sessionCount: 0,
          modelCount: 0,
          hasCredentials: false,
        },
        error: messageOf(error),
      };
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    try { return await requestJson('/api/sessions'); } catch { return []; }
  }
  async newSession(): Promise<{ ok: boolean; session?: SessionSummary; error?: string }> {
    try {
      const result = await requestJson<{ ok: boolean; session: SessionSummary }>('/api/session/new', {
        method: 'POST',
        errorMessage: '无法新建对话',
      });
      await this.getSession(result.session.id);
      return { ok: true, session: result.session };
    } catch (cause) {
      const error = messageOf(cause);
      return { ok: false, error };
    }
  }

  async getSession(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const event = await requestJson<AgentEvent>('/api/session?id=' + encodeURIComponent(id), {
        errorMessage: '无法切换会话',
      });
      this.reduce(event);
      return { ok: true };
    } catch (cause) {
      const error = messageOf(cause);
      this.setSession(id, { error });
      return { ok: false, error };
    }
  }

  /** Seed a realistic completed conversation so the Report + Canvas linkage is demoable
   *  and testable end-to-end without a live agent. UI-only — does not round-trip the Core. */
  async loadDemo(): Promise<void> {
    this.setSession('demo', {
      summary: { id: 'demo', title: 'PDF 检测报告分析', group: '今天', time: '刚刚', live: false, status: 'completed' },
      messages: DEMO_MESSAGES,
      streaming: null,
      fileList: DEMO_FILES,
      contents: DEMO_CONTENTS,
      error: null,
      loading: false,
      workspaceReady: true,
      workspaceMode: 'demo',
    });
  }
}

export const agentClient = new BrowserAgentClient();
