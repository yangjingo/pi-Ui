// Node-only. Wraps the Pi SDK and emits AgentEvent to subscribers.
// This is the heart of the Core layer — the UI never imports this.

import 'dotenv/config';
import { createAgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { join, basename, isAbsolute, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';

import type { AgentEvent } from '../agent';
import { mapPiTool, fileTypeOf } from '../agent';
import type { Artifact, CustomModelEntry, FileNode, Message, ModelOption, ModelTestResult, SessionSummary, TrajStep } from '../types';
import { loadRegistry, saveRegistry, toProviderConfig, validateEntry, slugify } from './custom-models';

const DEFAULT_CWD = process.env.PI_CWD || './workspace';
let CWD = loadCwd();   // runtime-configurable working directory (persisted in .pi-workspace/cwd.json)
const MODEL_SPEC = process.env.PI_MODEL || 'deepseek/deepseek-v4-flash';

/** Load the persisted working-directory override (falls back to PI_CWD / ./workspace). */
function loadCwd(): string {
  try {
    const f = join(process.cwd(), '.pi-workspace', 'cwd.json');
    if (existsSync(f)) {
      const v = JSON.parse(readFileSync(f, 'utf8'));
      if (typeof v?.cwd === 'string' && v.cwd.trim()) return v.cwd.trim();
    }
  } catch { /* ignore corrupt file */ }
  return DEFAULT_CWD;
}
/** Persist the working-directory choice so it survives restarts. */
function saveCwd(cwd: string): void {
  try {
    const dir = join(process.cwd(), '.pi-workspace');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cwd.json'), JSON.stringify({ cwd }, null, 2), 'utf8');
  } catch { /* non-fatal — stays in memory for this process */ }
}

type Listener = (e: AgentEvent) => void;

function nowTime(): string {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}
/** One-line preview of a reasoning run, for the compact traj row (full text lives on step.text). */
function thinkPreview(text: string): string {
  const one = (text || '').replace(/\s+/g, ' ').trim();
  return one.length > 60 ? one.slice(0, 60) + '…' : one;
}
function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 24 ? t.slice(0, 24) + '…' : t || '新对话';
}
function summarizeArgs(args: any): string {
  if (!args) return '';
  const p = args.path || args.file_path || args.filePath || args.pattern || args.command || args.query;
  if (p) return String(p);
  try { return JSON.stringify(args).slice(0, 120); } catch { return ''; }
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function summarizeResult(result: any, isError: boolean): string {
  if (isError) return '出错';
  if (!result) return '完成';
  const content = result.content;
  if (Array.isArray(content)) {
    const text = content.map((c: any) => c?.text || '').join('').trim();
    if (text) return text.split('\n')[0].slice(0, 120);
  }
  return '完成';
}

// Minimal title map for trajectory rows.
const TOOL_TITLE: Record<string, string> = {
  read: '读取文件', write: '写入文件', edit: '编辑文件', bash: '执行命令',
  grep: '搜索内容', find: '查找文件', ls: '列出目录',
};

export class PiRuntime {
  private listeners = new Set<Listener>();
  private modelRuntime: any;
  private session: any = null;
  private summary: SessionSummary = {
    id: 'pi-' + Date.now().toString(36), title: '新对话', group: '今天', time: nowTime(), live: true,
  };
  private steps: TrajStep[] = [];
  private textBuf = '';
  private thinkingLevel = 'off';
  private thinkingBuf = '';
  private files = new Map<string, string>();
  private pendingFiles = new Map<string, string>();
  private resolvedModel: string | undefined;
  private turnStart = 0;
  private firstTokenAt = 0;
  // user-defined model endpoints, persisted in .pi-workspace/custom-models.json
  private customModels: CustomModelEntry[] = loadRegistry();
  private activeSpec: string = MODEL_SPEC;     // provider/modelId the session should use
  private runtimeReady = false;
  private initError: string | undefined;

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: AgentEvent) { for (const l of this.listeners) l(e); }

  /** Finalize a trailing in-progress 'think' step (mark done + emit) so a tool call or the
   *  turn end closes the reasoning run at the right point in the interleaved trajectory. */
  private closeRunningThink() {
    const last = this.steps[this.steps.length - 1];
    if (last && last.t === 'think' && last.status === 'running') {
      last.status = 'done';
      this.emit({ type: 'tool_end', step: { ...last } });
    }
  }

  /** Pull the provider id from a Pi model object (provider may be a string or {id}). */
  private providerIdOf(m: any): string {
    return ((m?.provider?.id ?? m?.provider) ?? '').toString();
  }

  get health() {
    return {
      model: this.resolvedModel || this.activeSpec,
      cwd: CWD,
      hasKey: !!this.resolvedModel,
      ready: !!this.session,
      error: this.initError,
    };
  }

  /** Bring up ModelRuntime + register custom models, but do NOT create a session yet. */
  private async ensureRuntime() {
    if (this.runtimeReady) return;
    mkdirSync(CWD, { recursive: true });
    this.modelRuntime = await ModelRuntime.create();
    // Only register a real Anthropic API key. Pi's built-in anthropic provider
    // hardcodes api.anthropic.com and ignores ANTHROPIC_BASE_URL, so a Claude/GLM
    // proxy token (ANTHROPIC_AUTH_TOKEN) cannot be used there — registering it would
    // only trick getAvailable() into picking anthropic and then failing. Instead, leave
    // auth to providers configured via `pi login` (e.g. deepseek in ~/.pi/agent/auth.json).
    if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
      this.modelRuntime.setRuntimeApiKey('anthropic', process.env.ANTHROPIC_API_KEY);
    }
    // Register every persisted custom model so they appear in the list and are usable.
    for (const e of this.customModels) {
      try { this.modelRuntime.registerProvider(e.id, toProviderConfig(e)); } catch { /* duplicate/invalid — skip */ }
    }
    try { await this.modelRuntime.refresh({ allowNetwork: false }); } catch { /* offline catalog refresh — best effort */ }
    this.runtimeReady = true;
  }

  /** Resolve a `provider/modelId` spec to a Pi model object (sync, post-refresh). */
  private resolveModel(spec: string): any {
    const at = spec.indexOf('/');
    if (at < 0) return undefined;
    const providerId = spec.slice(0, at);
    const modelId = spec.slice(at + 1);
    const direct = this.modelRuntime.getModel?.(providerId, modelId);
    if (direct) return direct;
    const snap = this.modelRuntime.getAvailableSnapshot?.() ?? [];
    return snap.find((m: any) => this.providerIdOf(m) + '/' + m.id === spec);
  }

  /** (Re)create the agent session bound to `model`. Disposes any prior session. */
  private async createSession(model: any) {
    try { this.session?.dispose?.(); } catch { /* ignore */ }
    this.session = null;
    const { session } = await createAgentSession({
      cwd: CWD,
      model,
      modelRuntime: this.modelRuntime,
      sessionManager: SessionManager.inMemory(CWD),
      thinkingLevel: this.thinkingLevel as any,
      tools: ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'],
    });
    this.session = session;
    session.subscribe((ev: any) => this.handle(ev));
  }

  async init() {
    if (this.session) return;
    await this.ensureRuntime();
    const model = this.resolveModel(this.activeSpec) || this.modelRuntime.getAvailableSnapshot?.()?.[0];
    if (!model) {
      // No model yet (no pi login, no ANTHROPIC_API_KEY, no custom model). Don't throw —
      // the user can still add a custom model in the drawer; prompt() will surface this.
      this.initError = '未找到可用模型。请 pi login、设置 ANTHROPIC_API_KEY，或在模型配置中添加自定义模型。';
      return;
    }
    this.initError = undefined;
    this.resolvedModel = this.providerIdOf(model) + '/' + model.id;
    this.activeSpec = this.resolvedModel;
    console.log('[pi] using model:', this.resolvedModel);
    await this.createSession(model);
    this.emit({ type: 'session_start', session: this.summary });
  }

  private handle(ev: any) {
    switch (ev?.type) {
      case 'message_update': {
        const ame = ev.assistantMessageEvent;
        if (ame?.type === 'thinking_delta' && ame.delta) {
          if (!this.firstTokenAt) this.firstTokenAt = Date.now();
          // Reasoning is interleaved into the trajectory as a 'think' step at the position it
          // occurs relative to tool calls (and streamed live), not bucketed into a separate block.
          const last = this.steps[this.steps.length - 1];
          if (last && last.t === 'think' && last.status === 'running') {
            last.text = (last.text || '') + ame.delta;
            last.det = thinkPreview(last.text);
            this.emit({ type: 'tool_update', step: { ...last } });
          } else {
            const step: TrajStep = { t: 'think', title: '思考', det: thinkPreview(ame.delta), text: ame.delta, status: 'running', time: nowTime() };
            this.steps.push(step);
            this.emit({ type: 'tool_start', step });
          }
        } else if (ame?.type === 'text_delta' && ame.delta) {
          if (!this.firstTokenAt) this.firstTokenAt = Date.now();
          this.textBuf += ame.delta;
          this.emit({ type: 'text_delta', delta: ame.delta });
        }
        break;
      }
      case 'tool_execution_start': {
        this.closeRunningThink();
        const step: TrajStep = {
          t: mapPiTool(ev.toolName),
          title: TOOL_TITLE[ev.toolName] || ev.toolName || '工具',
          det: summarizeArgs(ev.args),
          in: (() => { try { return JSON.stringify(ev.args); } catch { return undefined; } })(),
          status: 'running',
          time: nowTime(),
          file: ev.args?.path || ev.args?.file_path || ev.args?.filePath,
        };
        this.steps.push(step);
        // remember the target path: tool_execution_end carries no args, only a result
        if ((ev.toolName === 'write' || ev.toolName === 'edit') && step.file) {
          this.pendingFiles.set(ev.toolCallId, step.file);
        }
        this.emit({ type: 'tool_start', step });
        break;
      }
      case 'tool_execution_end': {
        const step = this.steps[this.steps.length - 1];
        if (step) {
          step.status = 'done';
          step.out = summarizeResult(ev.result, ev.isError);
          this.emit({ type: 'tool_end', step });
        }
        const pending = this.pendingFiles.get(ev.toolCallId);
        this.pendingFiles.delete(ev.toolCallId);
        if (pending) this.captureFile(pending);
        break;
      }
      case 'agent_end': {
        this.closeRunningThink();
        const artifacts: Artifact[] = [...this.files.keys()].map(p => ({
          name: basename(p), type: fileTypeOf(p), label: '文件',
        }));
        // TTFT / TPOT from the timing markers; token counts from the assistant usage.
        let input = 0, output = 0;
        for (const m of (ev.messages || [])) {
          if (m?.role === 'assistant') { input += m?.usage?.input || 0; output += m?.usage?.output || 0; }
        }
        const now = Date.now();
        const ttft = this.firstTokenAt && this.turnStart ? this.firstTokenAt - this.turnStart : 0;
        const duration = this.turnStart ? now - this.turnStart : 0;
        const genTime = this.firstTokenAt ? now - this.firstTokenAt : duration;
        const message: Message = {
          role: 'agent',
          status: 'done',
          intro: this.textBuf.trim() || undefined,
          traj: this.steps.slice(),
          artifacts,
          stats: { ttft, tpot: output > 0 ? genTime / output : 0, duration, input, output },
        };
        this.emit({ type: 'agent_end', message });
        // reset per-turn accumulators; the finalized message is now the UI's record
        this.steps = [];
        this.textBuf = '';
        this.turnStart = 0;
        this.firstTokenAt = 0;
        this.summary = { ...this.summary, live: false, time: nowTime() };
        break;
      }
      default: break;
    }
  }

  private captureFile(rawPath: string) {
    try {
      const rawStr = String(rawPath).replace(/\\/g, '/');
      const abs = isAbsolute(rawStr) ? rawStr : join(CWD, rawStr);
      const content = readFileSync(abs, 'utf8');
      const st = statSync(abs);
      // Display path: relative to CWD if inside it, else the basename.
      const cwdAbs = resolve(CWD).replace(/\\/g, '/');
      let rel: string;
      if (isAbsolute(rawStr)) {
        rel = rawStr.toLowerCase().startsWith(cwdAbs.toLowerCase())
          ? rawStr.slice(cwdAbs.length).replace(/^\/+/, '')
          : basename(rawStr);
      } else {
        rel = rawStr.replace(/^\.?\//, '');
      }
      const file: FileNode = {
        name: basename(rel), path: rel, type: fileTypeOf(rel), size: formatSize(st.size),
      };
      this.files.set(rel, content);
      this.emit({ type: 'file', file, content });
    } catch {
      /* file not readable yet — ignore */
    }
  }

  async prompt(text: string) {
    try {
      this.turnStart = Date.now();
      this.firstTokenAt = 0;
      await this.init();
      if (!this.session) {
        this.emit({ type: 'error', message: this.initError || '未配置可用模型。' });
        return;
      }
      if (!this.summary.title || this.summary.title === '新对话') {
        this.summary = { ...this.summary, title: titleFrom(text), time: nowTime() };
        this.emit({ type: 'session_start', session: this.summary });
      }
      await this.session.prompt(text);
    } catch (e: any) {
      this.emit({ type: 'error', message: e?.message || String(e) });
    }
  }

  async setThinking(on: boolean) {
    this.thinkingLevel = on ? 'medium' : 'off';
    try { if (this.session) this.session.setThinkingLevel(this.thinkingLevel); } catch { /* ignore */ }
  }

  /** All selectable models: custom entries first, then builtin available. */
  listModels(): ModelOption[] {
    const active = this.resolvedModel || this.activeSpec;
    const opts: ModelOption[] = [];
    const seen = new Set<string>();
    const push = (providerId: string, modelId: string, label: string, custom: boolean) => {
      const id = providerId + '/' + modelId;
      if (!providerId || seen.has(id)) return;
      seen.add(id);
      opts.push({ id, provider: providerId, modelId, label, custom, active: id === active });
    };
    for (const e of this.customModels) push(e.id, e.modelId, e.label || e.modelId, true);
    try {
      const snap = this.modelRuntime?.getAvailableSnapshot?.() ?? [];
      for (const m of snap) push(this.providerIdOf(m), m.id, m.name || m.id, false);
    } catch { /* runtime not ready yet */ }
    if (opts.length === 0 && this.activeSpec.includes('/')) {
      const at = this.activeSpec.indexOf('/');
      push(this.activeSpec.slice(0, at), this.activeSpec.slice(at + 1), this.activeSpec, false);
    }
    return opts;
  }

  /** Probe a custom model with a one-token prompt without persisting it. */
  async testCustomModel(entry: CustomModelEntry): Promise<ModelTestResult> {
    const err = validateEntry(entry);
    if (err) return { ok: false, error: err };
    try {
      await this.ensureRuntime();
      this.modelRuntime.registerProvider(entry.id, toProviderConfig(entry));
      const model = this.modelRuntime.getModel(entry.id, entry.modelId);
      if (!model) return { ok: false, error: '模型未能注册（检查格式 / 模型 ID）' };
      const ctx = { messages: [{ role: 'user', content: 'Reply with exactly: ok', timestamp: Date.now() }] };
      const t0 = Date.now();
      const res: any = await this.modelRuntime.completeSimple(model, ctx as any, { apiKey: entry.apiKey, maxTokens: 16 } as any);
      const latencyMs = Date.now() - t0;
      const text = (res?.content || []).map((c: any) => c?.text || '').join('').trim();
      const output = res?.usage?.output;
      return { ok: true, latencyMs, reply: text.slice(0, 80) || '(空回复)', outputTokens: typeof output === 'number' ? output : undefined };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  /** Validate, register, and persist a custom model. Does not auto-activate. */
  async addCustomModel(entry: CustomModelEntry): Promise<{ ok: boolean; error?: string; entry?: CustomModelEntry }> {
    const err = validateEntry(entry);
    if (err) return { ok: false, error: err };
    await this.ensureRuntime();
    let id = entry.id || slugify(entry.label);
    if (this.customModels.some(e => e.id === id)) {
      id = id + '-' + Math.random().toString(36).slice(2, 6);
    }
    const full: CustomModelEntry = { ...entry, id };
    try { this.modelRuntime.registerProvider(id, toProviderConfig(full)); }
    catch (e: any) { return { ok: false, error: '注册失败：' + (e?.message || e) }; }
    this.customModels.push(full);
    saveRegistry(this.customModels);
    return { ok: true, entry: full };
  }

  /** Remove a custom model; if it was active, fall back to the first available. */
  async removeCustomModel(id: string): Promise<void> {
    this.customModels = this.customModels.filter(e => e.id !== id);
    saveRegistry(this.customModels);
    try { this.modelRuntime?.unregisterProvider?.(id); } catch { /* ignore */ }
    if (this.resolvedModel?.startsWith(id + '/')) {
      this.resolvedModel = undefined;
      this.activeSpec = MODEL_SPEC;
      this.session = null;        // force init() to rebuild with a fallback model
      try { await this.init(); } catch { /* surfaced via initError */ }
    }
  }

  /** Switch the active model — recreates the session bound to the new model. */
  async setActiveModel(providerId: string, modelId: string): Promise<{ ok: boolean; error?: string; model?: string }> {
    await this.ensureRuntime();
    const model = this.resolveModel(providerId + '/' + modelId);
    if (!model) return { ok: false, error: '未找到该模型' };
    this.activeSpec = providerId + '/' + modelId;
    this.resolvedModel = this.providerIdOf(model) + '/' + model.id;
    try { await this.createSession(model); }
    catch (e: any) { return { ok: false, error: '切换失败：' + (e?.message || e) }; }
    console.log('[pi] switched model:', this.resolvedModel);
    this.emit({ type: 'session_start', session: this.summary });
    return { ok: true, model: this.resolvedModel };
  }

  /** Change the agent's working directory (persisted). Re-binds the session to the new workspace
   *  and resets per-session state — the old conversation/files belonged to the previous cwd. */
  async setCwd(path: string): Promise<{ ok: boolean; error?: string; cwd?: string }> {
    const p = (path || '').trim();
    if (!p) return { ok: false, error: '请填写工作目录' };
    try { mkdirSync(p, { recursive: true }); }
    catch (e: any) { return { ok: false, error: '无法访问该目录：' + (e?.message || e) }; }
    CWD = p;
    saveCwd(CWD);
    this.steps = [];
    this.textBuf = '';
    this.files.clear();
    this.pendingFiles.clear();
    this.summary = { id: 'pi-' + Date.now().toString(36), title: '新对话', group: '今天', time: nowTime(), live: true };
    try {
      await this.ensureRuntime();
      const model = this.resolveModel(this.activeSpec) || this.modelRuntime?.getAvailableSnapshot?.()?.[0];
      if (model) await this.createSession(model);
    } catch (e: any) {
      return { ok: false, error: '切换工作目录失败：' + (e?.message || e) };
    }
    console.log('[pi] cwd set:', CWD);
    return { ok: true, cwd: CWD };
  }

  async saveFile(path: string, content: string) {
    const rawStr = String(path).replace(/\\/g, '/');
    const abs = isAbsolute(rawStr) ? rawStr : join(CWD, rawStr.replace(/^\.?\//, ''));
    const rel = rawStr.replace(/^\.?\//, '');
    try {
      writeFileSync(abs, content, 'utf8');
      this.files.set(rel, content);
      const file: FileNode = {
        name: basename(rel), path: rel, type: fileTypeOf(rel), size: formatSize(Buffer.byteLength(content)),
      };
      this.emit({ type: 'file', file, content });
    } catch (e: any) {
      this.emit({ type: 'error', message: 'saveFile: ' + (e?.message || String(e)) });
    }
  }

  listSessions(): SessionSummary[] { return [this.summary]; }

  async newSession() {
    try { this.session?.dispose?.(); } catch { /* ignore */ }
    this.session = null;
    this.steps = [];
    this.textBuf = '';
    this.files.clear();
    this.summary = { id: 'pi-' + Date.now().toString(36), title: '新对话', group: '今天', time: nowTime(), live: true };
    this.emit({ type: 'session_start', session: this.summary });
  }
}

export const runtime = new PiRuntime();
