// Browser-side AgentClient. Streams AgentEvent from the Node Core over SSE and reduces
// them into a live session model. It deliberately has no React dependency.

import { fileTypeOf, type AgentClient, type AgentEvent } from './contracts';
import type {
  CustomModelEntry,
  FileNode,
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
import { emptyStreamingTurn, initialAgentState, reduceAgentEvent, type AgentState } from './state';

type ActionResult = { ok: boolean; error?: string };

class BrowserAgentClient implements AgentClient {
  private state: AgentState = initialAgentState;
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

  /** Pull model configuration root and active session cwd from Core. */
  async refreshHealth() {
    try {
      const h = await requestJson<{ model?: string; workspaceRoot?: string; cwd?: string }>('/api/health');
      this.set({
        model: h.model ?? null,
        workspaceRoot: h.workspaceRoot ?? null,
        cwd: h.cwd ?? null,
      });
    } catch { /* server not ready yet — retry on next interaction */ }
  }

  private connect() {
    if (this.es) return;
    try {
      const stream = new EventSource('/api/events');
      this.es = stream;
      stream.onopen = () => {
        // A reconnect is not complete until its authoritative snapshot arrives.
        if (this.state.connectionStatus !== 'reconnecting') this.set({ connectionStatus: 'connected' });
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
  getSnapshot = (): AgentState => this.state;
  private emit() { for (const l of this.listeners) l(); }
  private set(patch: Partial<AgentState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private reduce(e: AgentEvent) {
    for (const l of this.eventListeners) l(e);
    const patch = reduceAgentEvent(this.state, e);
    if (patch) this.set(patch);
    if (e.type === 'session_snapshot' && this.state.connectionStatus === 'reconnecting') {
      this.set({ connectionStatus: 'connected' });
    }
  }

  // ---- AgentClient methods (HTTP) ----
  async prompt(text: string, displayText?: string, workspaceChanges: WorkspaceChange[] = []): Promise<boolean> {
    const visible = visiblePrompt(displayText || text);
    const userMsg: Message = {
      role: 'user', text: visible.text, attachments: visible.attachments,
      workspaceChanges: workspaceChanges.length ? workspaceChanges : undefined, when: '刚刚',
    };
    this.set({
      messages: [...this.state.messages, userMsg],
      streaming: emptyStreamingTurn(),
      loading: true,
      error: null,
    });
    try {
      await requestJson('/api/prompt', {
        method: 'POST',
        body: { text, displayText: displayText || text, workspaceChanges },
        errorMessage: '服务器未接受本轮任务',
      });
      return true;
    } catch (error) {
      this.set({ error: 'network: ' + messageOf(error), loading: false });
      return false;
    }
  }

  async steer(text: string, displayText?: string, workspaceChanges: WorkspaceChange[] = []): Promise<boolean> {
    try {
      const result = await requestJson<{ ok?: boolean; error?: string }>('/api/steer', {
        method: 'POST',
        body: { text, displayText: displayText || text, workspaceChanges },
        errorMessage: 'Agent 无法插入当前指令',
      });
      if (!result.ok) throw new Error(result.error || 'Agent 无法插入当前指令');
      return true;
    } catch (error) {
      this.set({ error: 'network: ' + messageOf(error) });
      return false;
    }
  }

  async interruptAndSteer(text: string, displayText?: string, workspaceChanges: WorkspaceChange[] = []): Promise<boolean> {
    try {
      const result = await requestJson<{ ok?: boolean; error?: string }>('/api/interrupt', {
        method: 'POST',
        body: { text, displayText: displayText || text, workspaceChanges },
        errorMessage: 'Agent 中断失败',
      });
      if (!result.ok) throw new Error(result.error || 'Agent 中断失败');
      return true;
    } catch (error) {
      // Keep the current live turn intact: this can be a transient transport loss and the SSE
      // reconnect path will reconcile it instead of incorrectly presenting the turn as finished.
      this.set({ error: 'network: ' + messageOf(error) });
      return false;
    }
  }

  async setThinking(on: boolean): Promise<void> {
    try {
      await requestJson('/api/thinking', { method: 'POST', body: { on } });
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
  async setActiveModel(providerId: string, modelId: string): Promise<{ ok: boolean; error?: string; model?: string }> {
    try {
      const r = await requestJson<{ ok: boolean; error?: string; model?: string }>('/api/models/active', {
        method: 'POST', body: { providerId, modelId },
      });
      await this.refreshHealth();   // update the active model shown in the topbar/drawer
      return r;
    } catch (error) { return { ok: false, error: 'network: ' + messageOf(error) }; }
  }

  /** Ask Core's SkillHarness to turn one completed Agent message plus its trajectory into a local Skill. */
  async createSkillFromTurn(messageIndex: number): Promise<{ ok: boolean; error?: string; skill?: { id: string; name: string } }> {
    try {
      const result = await requestJson<ActionResult & { skill?: { id: string; name: string } }>('/api/skills/from-turn', {
        method: 'POST',
        body: { messageIndex },
        errorMessage: '无法从本轮生成 Skill',
      });
      if (!result.ok) {
        const error = result.error || '无法从本轮生成 Skill';
        this.set({ error });
        return { ok: false, error };
      }
      return { ok: true, skill: result.skill };
    } catch (cause) {
      const error = 'network: ' + messageOf(cause);
      this.set({ error });
      return { ok: false, error };
    }
  }

  async saveFile(path: string, content: string): Promise<{ ok: boolean; error?: string }> {
    const hadPrevious = Object.prototype.hasOwnProperty.call(this.state.contents, path);
    const previous = this.state.contents[path];
    this.set({ contents: { ...this.state.contents, [path]: content }, error: null });
    const rollback = (error: string) => {
      const contents = { ...this.state.contents };
      // Do not overwrite a newer live update that arrived while this request was in flight.
      if (contents[path] === content) {
        if (hadPrevious) contents[path] = previous;
        else delete contents[path];
      }
      this.set({ contents });
      return { ok: false, error };
    };
    try {
      const result = await requestJson<ActionResult>('/api/file', {
        method: 'POST',
        body: { path, content },
        errorMessage: '服务器未能写入文件',
      });
      if (!result.ok) return rollback(result.error || '服务器未能写入文件');
      return { ok: true };
    } catch (error) {
      return rollback(messageOf(error));
    }
  }

  async importFile(path: string, data: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await requestJson<ActionResult>('/api/file/import', {
        method: 'POST',
        body: { path, data },
        errorMessage: '服务器未能导入 Office 文件',
      });
      if (!result.ok) return { ok: false, error: result.error || '服务器未能导入 Office 文件' };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  async renameFile(path: string, nextPath: string): Promise<{ ok: boolean; error?: string; path?: string }> {
    try {
      const result = await requestJson<ActionResult & { path?: string }>('/api/file/rename', {
        method: 'POST',
        body: { path, nextPath },
        errorMessage: '重命名失败',
      });
      if (!result.ok) return { ok: false, error: result.error || '重命名失败' };
      const next = String(result.path || nextPath);
      const state = this.state;
      const fileList = state.fileList.map(f => (f.path || f.name) === path
        ? { ...f, name: next.replace(/\\/g, '/').split('/').pop() || f.name, path: next, type: fileTypeOf(next) }
        : f);
      const contents = { ...state.contents };
      if (Object.prototype.hasOwnProperty.call(contents, path)) {
        contents[next] = contents[path];
        delete contents[path];
      }
      this.set({ fileList, contents });
      return { ok: true, path: next };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  async deleteFile(path: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await requestJson<ActionResult>('/api/file?path=' + encodeURIComponent(path), {
        method: 'DELETE',
        errorMessage: '删除失败',
      });
      if (!result.ok) return { ok: false, error: result.error || '删除失败' };
      const contents = { ...this.state.contents };
      delete contents[path];
      this.set({
        fileList: this.state.fileList.filter(f => (f.path || f.name) !== path),
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
        files?: Array<{ file: FileNode; content: string }>;
      }>('/api/cwd', { method: 'POST', body: { path } });
      if (!r.ok) return { ok: false, error: r.error };
      const contents: Record<string, string> = {};
      const fileList = Array.isArray(r.files) ? r.files.map((item: { file: FileNode; content: string }) => {
        const filePath = item.file.path || item.file.name;
        contents[filePath] = item.content;
        return item.file;
      }) : [];
      this.set({
        messages: [], streaming: null, fileList, contents, error: null, loading: false,
        workspaceRoot: r.workspaceRoot ?? path,
        cwd: r.cwd ?? path,
        model: r.model ?? this.state.model,
        workspaceReady: true, workspaceMode: 'disk',
        summary: { id: 'cwd-' + Date.now().toString(36), title: '新对话', group: '今天', time: '刚刚', live: true },
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
  async newSession(): Promise<{ ok: boolean; error?: string }> {
    try {
      await requestJson('/api/session/new', { method: 'POST', errorMessage: '无法新建对话' });
    } catch (cause) {
      const error = messageOf(cause);
      this.set({ error });
      return { ok: false, error };
    }
    this.set({ messages: [], streaming: null, error: null, loading: false });
    return { ok: true };
  }
  async switchSession(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await requestJson<ActionResult>('/api/session/switch', {
        method: 'POST',
        body: { id },
        errorMessage: '无法切换会话',
      });
      if (!result.ok) {
        const error = result.error || '无法切换会话';
        this.set({ error });
        return { ok: false, error };
      }
      return { ok: true };
    } catch (cause) {
      const error = messageOf(cause);
      this.set({ error });
      return { ok: false, error };
    }
  }

  /** Seed a realistic completed conversation so the Report + Canvas linkage is demoable
   *  and testable end-to-end without a live agent. UI-only — does not round-trip the Core. */
  async loadDemo(): Promise<void> {
    this.set({
      summary: { id: 'demo', title: 'PDF 检测报告分析', group: '今天', time: '刚刚', live: false },
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
