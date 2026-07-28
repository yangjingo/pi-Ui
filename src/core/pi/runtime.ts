// Node-only. Wraps the Pi SDK and emits AgentEvent to subscribers.
// This is the heart of the Core layer — the UI never imports this.

import 'dotenv/config';
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent';
import { join, basename, resolve } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

import {
  fileTypeOf,
  mapPiTool,
  type AgentContentBlock,
  type AgentEvent,
  type Artifact,
  type CustomModelEntry,
  type FileNode,
  type Message,
  type ModelConfigFile,
  type ModelOption,
  type ModelTestResult,
  type PiInheritancePreview,
  type RuntimeBootstrapResult,
  type SessionSummary,
  type SteerItem,
  type TrajStep,
  type WorkspaceChange,
} from '../agent/protocol';
import { CoreModelConfiguration, DEFAULT_MODEL_SPEC } from './model-configuration';
import { FileHarness } from '../../harness/file/runtime';
import {
  ContextHarness,
  type ContextPrefixSnapshot,
  type ContextUsage,
} from '../../harness/context';
import { GoalHarness } from '../../harness/goal';
import { SkillHarness } from '../../harness/skill';
import { createContextExtension } from './context-extension';
import {
  inheritedWorkingDirectory,
  inspectPiInstallation,
  isSessionFile,
  loadPiSessionMessages,
  type ManagedSessionSummary,
  type PiInstallationInspection,
} from './pi-installation-reader';

const DEFAULT_CWD = process.env.PI_CWD || '.workspace';
const CWD_STORE_DIR = join(process.cwd(), '.workspace', '.agentcore');
const CWD_STORE_PATH = join(CWD_STORE_DIR, 'cwd.json');
let WORKSPACE_ROOT = loadCwd();   // persisted base working directory (not per-session)
let CWD = resolve(process.cwd(), WORKSPACE_ROOT, newSessionId());   // active session directory path
const MODEL_SPEC = DEFAULT_MODEL_SPEC;
const SESSION_INDEX_FILE = '.sessions.json';
const SESSION_RECORD_FILE = '.session.json';
const MAX_SESSION_RECORD_BYTES = 8 * 1024 * 1024;
const CODING_TOOL_NAMES = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'] as const;

interface PersistedSessionRecord {
  version: 1;
  summary: SessionSummary;
  messages: Message[];
  updatedAt: string;
}

interface QueuedSteer {
  item: SteerItem;
  /** Expanded input passed to Pi; retained only until Pi consumes this queue item. */
  modelText: string;
  message: Message;
}

/** Load the persisted working-directory override (falls back to PI_CWD / .workspace). */
function loadCwd(): string {
  try {
    if (existsSync(CWD_STORE_PATH)) {
      const v = JSON.parse(readFileSync(CWD_STORE_PATH, 'utf8'));
      const raw = typeof v?.cwd === 'string' ? v.cwd.trim() : '';
      if (raw) return raw === './workspace' ? '.workspace' : raw;
    }
  } catch { /* ignore corrupt file */ }
  return DEFAULT_CWD;
}
/** Persist the working-directory choice so it survives restarts. */
function saveCwd(cwd: string): void {
  try {
    mkdirSync(CWD_STORE_DIR, { recursive: true });
    writeFileSync(CWD_STORE_PATH, JSON.stringify({ cwd }, null, 2), 'utf8');
  } catch { /* non-fatal — stays in memory for this process */ }
}

function newSessionId(): string {
  return createHash('sha256')
    .update(`${Date.now()}-${Math.random()}-${randomBytes(8).toString('hex')}`)
    .digest('hex')
    .slice(0, 18);
}

/** Server-side counterpart of the browser's visible prompt projection. Persisting the compact
 * UI transcript avoids storing expanded @file contents in every session record. */
function transcriptPrompt(source: string): { text: string; attachments: Artifact[] } {
  const attachments: Artifact[] = [];
  const seen = new Set<string>();
  const cleaned = source.replace(/@(?:"([^"]+)"|([\w一-龥.\/\\-]+))/g, (_full, quoted: string | undefined, bare: string | undefined) => {
    const path = quoted || bare || '';
    if (path && !seen.has(path)) {
      seen.add(path);
      attachments.push({ name: path.replace(/\\/g, '/').split('/').pop() || path, path, type: fileTypeOf(path), label: '引用' });
    }
    return ' ';
  }).replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleaned || (attachments.length ? '引用工作区文件' : source), attachments };
}

type Listener = (e: AgentEvent) => void;
type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

function nowTime(): string {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}
function sessionTimestamp(value: Date | string | number = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  return [
    valid.getFullYear(),
    String(valid.getMonth() + 1).padStart(2, '0'),
    String(valid.getDate()).padStart(2, '0'),
  ].join('-') + ` ${String(valid.getHours()).padStart(2, '0')}:${String(valid.getMinutes()).padStart(2, '0')}`;
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
  private workspaceRoot: string = resolve(WORKSPACE_ROOT);
  private activeSessionId: string = basename(CWD);
  private sessions: ManagedSessionSummary[] = [];
  private summary: ManagedSessionSummary = {
    id: this.activeSessionId, title: '新对话', group: '今天', time: sessionTimestamp(), live: true,
  };
  private createdFallbackSession = false;
  private piInheritanceApplied = false;
  private piInspection: {
    inspection: PiInstallationInspection;
    sessions: ManagedSessionSummary[];
  } | null = null;
  private bootstrapLoading: Promise<RuntimeBootstrapResult> | null = null;
  /** Finalized UI transcript, persisted alongside this session's generated files. */
  private messages: Message[] = [];
  private steps: TrajStep[] = [];
  private blocks: AgentContentBlock[] = [];
  private textBuf = '';
  private thinkingLevel: ThinkingLevel = 'off';
  private thinkingBuf = '';
  /** UI-visible mirror of Pi's native steering queue. Pi remains the source of loop ordering. */
  private steerQueue: QueuedSteer[] = [];
  /** The active Pi branch before the current user prompt, used for a clean interrupt rollback. */
  private turnParentId: string | null = null;
  /** First UI transcript item belonging to the currently running Pi loop (including delivered steers). */
  private turnMessageStartIndex = -1;
  private interrupting = false;
  // The filesystem-facing policy is intentionally replaceable. PiRuntime only coordinates
  // agent events and delegates session Files / artifact accounting to this harness.
  private fileHarness = new FileHarness(() => CWD);
  private contextHarness = new ContextHarness();
  private skillHarness = new SkillHarness(() => resolve(this.workspaceRoot, 'skills'));
  private goalHarness = new GoalHarness();
  private contextPrefixBaseline: ContextPrefixSnapshot | null = null;
  private pendingFiles = new Map<string, string>();
  private resolvedModel: string | undefined;
  private turnStart = 0;
  private firstTokenAt = 0;
  private modelConfiguration = new CoreModelConfiguration();
  private activeSpec: string = MODEL_SPEC;     // provider/modelId the session should use
  private runtimeReady = false;
  private initError: string | undefined;

  constructor() {
    this.loadSessions();
    this.fileHarness.reload();
    this.messages = this.loadSessionMessages(this.activeSessionId);
  }

  listSkills() {
    return this.skillHarness.list();
  }

  saveSkill(input: any) {
    return this.skillHarness.save(input);
  }

  deleteSkill(id: string) {
    return this.skillHarness.remove(id);
  }

  /** Persist a reviewable local Skill from one completed message and its recorded trajectory.
   * The projection itself lives in SkillHarness so this runtime remains only the session/persistence bridge. */
  createSkillFromTurn(messageIndex: number) {
    const index = Number.isInteger(messageIndex) ? messageIndex : -1;
    const agent = this.messages[index];
    if (!agent || agent.role !== 'agent' || agent.status === 'running') return { ok: false, error: '只能从已完成的 Agent 回复生成 Skill' };
    let user: Message | null = null;
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      if (this.messages[cursor]?.role === 'user') { user = this.messages[cursor]; break; }
    }
    return this.skillHarness.saveFromTurn({ user, agent });
  }

  private sessionIndexPath(): string {
    return join(this.workspaceRoot, SESSION_INDEX_FILE);
  }

  private nextSessionSummary(overrides: Partial<ManagedSessionSummary> = {}): ManagedSessionSummary {
    return {
      id: overrides.id || newSessionId(),
      title: overrides.title || '新对话',
      group: overrides.group || '今天',
      time: overrides.time || sessionTimestamp(),
      live: overrides.live ?? false,
    };
  }

  /** Upgrade older HH:mm-only indexes from their durable record/source modification time. */
  private normalizedSessionTimestamp(id: string, value: unknown, sourcePath = '', updatedAt?: unknown): string {
    const current = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(current)) return current;
    const updated = new Date(typeof updatedAt === 'string' || typeof updatedAt === 'number' ? updatedAt : '');
    if (!Number.isNaN(updated.getTime())) return sessionTimestamp(updated);
    for (const path of [this.sessionRecordPath(id), sourcePath, this.resolveSessionPath(id)]) {
      if (!path || !existsSync(path)) continue;
      try { return sessionTimestamp(statSync(path).mtime); } catch { /* try the next source */ }
    }
    return sessionTimestamp();
  }

  private publicSessionSummary(summary: ManagedSessionSummary): SessionSummary {
    return {
      id: summary.id,
      ...(summary.pi?.sourceId ? { sourceId: summary.pi.sourceId } : {}),
      title: summary.title,
      group: summary.group,
      time: summary.time,
      live: summary.live,
    };
  }

  private persistSessions() {
    try {
      mkdirSync(this.workspaceRoot, { recursive: true });
      writeFileSync(this.sessionIndexPath(), JSON.stringify({
        activeSessionId: this.activeSessionId,
        sessions: this.sessions,
      }, null, 2), 'utf8');
    } catch { /* non-fatal */ }
  }

  private resolveActiveSessionPath(): string {
    return resolve(this.workspaceRoot, this.activeSessionId);
  }

  private resolveActiveWorkingDirectory(): string {
    const session = this.sessions.find(item => item.id === this.activeSessionId);
    return session
      ? inheritedWorkingDirectory(session, this.resolveActiveSessionPath())
      : this.resolveActiveSessionPath();
  }

  private resolveSessionPath(id: string): string {
    return resolve(this.workspaceRoot, id);
  }

  private sessionRecordPath(id = this.activeSessionId): string {
    return join(this.resolveSessionPath(id), SESSION_RECORD_FILE);
  }

  /** Read only the durable, UI-safe transcript. Corrupt or oversized records never prevent
   * a session's files from opening. */
  private loadSessionMessages(id: string): Message[] {
    try {
      const recordPath = this.sessionRecordPath(id);
      if (!existsSync(recordPath) || statSync(recordPath).size > MAX_SESSION_RECORD_BYTES) {
        const inherited = this.sessions.find(session => session.id === id)?.pi;
        return inherited ? loadPiSessionMessages(inherited.forkPath || inherited.sourcePath) : [];
      }
      const record = JSON.parse(readFileSync(recordPath, 'utf8')) as Partial<PersistedSessionRecord>;
      if (record.version !== 1 || !Array.isArray(record.messages)) return [];
      return record.messages
        .filter((message): message is Message => !!message &&
          (message.role === 'user' || message.role === 'agent'))
        .map(message => this.fileHarness.projectMessage(message));
    } catch {
      return [];
    }
  }

  /** The root index is a fast list, while each session folder remains self-describing. If the
   * index is lost or interrupted during a write, recover every durable transcript from its own
   * `.session.json` rather than orphaning the user's work. */
  private discoverSessionSummaries(): SessionSummary[] {
    try {
      const found: Array<{ summary: SessionSummary; modified: number }> = [];
      for (const entry of readdirSync(this.workspaceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const path = this.sessionRecordPath(entry.name);
        if (!existsSync(path) || statSync(path).size > MAX_SESSION_RECORD_BYTES) continue;
        try {
          const record = JSON.parse(readFileSync(path, 'utf8')) as Partial<PersistedSessionRecord>;
          const source = record?.summary;
          if (record.version !== 1 || !source || source.id !== entry.name) continue;
          const modified = statSync(path).mtimeMs;
          found.push({
            summary: {
              id: entry.name,
              title: String(source.title || '').trim() || '新对话',
              group: String(source.group || '').trim() || '今天',
              time: this.normalizedSessionTimestamp(
                entry.name,
                source.time,
                '',
                record.updatedAt,
              ),
              live: false,
            },
            modified,
          });
        } catch { /* keep scanning other session folders */ }
      }
      return found.sort((a, b) => b.modified - a.modified).map(item => item.summary);
    } catch {
      return [];
    }
  }

  private persistSessionRecord(): void {
    try {
      const dir = this.resolveActiveSessionPath();
      mkdirSync(dir, { recursive: true });
      const record: PersistedSessionRecord = {
        version: 1,
        summary: { ...this.publicSessionSummary(this.summary), live: false },
        messages: this.messages,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(this.sessionRecordPath(), JSON.stringify(record, null, 2), 'utf8');
    } catch { /* a transcript is recoverable metadata; never fail the agent turn for it */ }
  }

  /** One event deliberately carries the transcript and file snapshot together. This avoids a
   * visible intermediate state where old messages briefly render with a new session's files. */
  sessionSnapshot(reason: 'initial' | 'session' | 'cwd' = 'initial'): Extract<AgentEvent, { type: 'session_snapshot' }> {
    // A browser reconnect is also a reconciliation point for files created directly by tools.
    this.fileHarness.reload();
    this.markActiveSession();
    return {
      type: 'session_snapshot',
      session: { ...this.publicSessionSummary(this.summary), live: !!this.session },
      messages: this.messages.slice(),
      steers: this.steerQueue.map(entry => ({ ...entry.item })),
      goal: this.goalHarness.snapshot(this.session),
      thinking: this.thinkingLevel !== 'off',
      cwd: CWD,
      files: this.fileSnapshot(),
      reason,
    };
  }

  private emitGoalSnapshot(): void {
    this.emitGoalBudgetReport();
    this.emit({ type: 'goal_updated', goal: this.goalHarness.snapshot(this.session) });
  }

  private responseUsageForReport(current?: ContextUsage): ContextUsage | undefined {
    const responses = this.messages.flatMap(message => {
      if (message.role !== 'agent' || !message.stats) return [];
      return [{
        role: 'assistant',
        usage: {
          input: message.stats.input,
          output: message.stats.output,
          cacheRead: message.stats.cacheRead,
          cacheWrite: message.stats.cacheWrite,
          cacheWrite1h: message.stats.cacheWrite1h,
          totalTokens: message.stats.totalTokens,
        },
      }];
    });
    if (current) responses.push({ role: 'assistant', usage: current });
    const usage = this.contextHarness.responseUsage(responses);
    return usage.totalTokens > 0 || usage.input > 0 || usage.output > 0 ||
      usage.cacheRead > 0 || usage.cacheWrite > 0 ? usage : undefined;
  }

  private emitGoalBudgetReport(currentUsage?: ContextUsage): void {
    const report = this.goalHarness.budgetReport(this.session, {
      model: this.resolvedModel || this.activeSpec,
      responseUsage: this.responseUsageForReport(currentUsage),
    });
    if (!report) return;
    const saved = this.fileHarness.saveText(report.path, report.content);
    if (!saved.ok) return;
    const captured = this.fileHarness.capture(report.path);
    if (!captured) return;
    this.goalHarness.markReportGenerated(this.session, report);
    this.emit({ type: 'goal_report', goalId: report.goalId, ...captured });
  }

  private markActiveSession(): void {
    const id = this.activeSessionId;
    this.sessions = this.sessions.map(s => ({ ...s, live: s.id === id }));
    const active = this.sessions.find(s => s.id === id);
    if (active) this.summary = active;
  }

  private loadSessions() {
    const fallback = () => {
      const summary = this.nextSessionSummary({ id: newSessionId(), live: true });
      this.createdFallbackSession = true;
      this.activeSessionId = summary.id;
      this.sessions = [summary];
      CWD = this.resolveActiveSessionPath();
      this.summary = summary;
      this.persistSessions();
      return;
    };

    try {
      const raw = readFileSync(this.sessionIndexPath(), 'utf8');
      const data = JSON.parse(raw);
      const list = Array.isArray(data?.sessions) ? data.sessions : [];
      const sessions: ManagedSessionSummary[] = [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const id = String(item.id || '').trim();
        const title = String(item.title || '').trim() || '新对话';
        const group = String(item.group || '').trim() || '今天';
        if (!id) continue;
        const sourcePath = typeof item?.pi?.sourcePath === 'string' ? item.pi.sourcePath.trim() : '';
        const sourceCwd = typeof item?.pi?.sourceCwd === 'string' ? item.pi.sourceCwd.trim() : '';
        const sourceId = typeof item?.pi?.sourceId === 'string' ? item.pi.sourceId.trim() : '';
        const forkPath = typeof item?.pi?.forkPath === 'string' ? item.pi.forkPath.trim() : '';
        const time = this.normalizedSessionTimestamp(id, item.time, sourcePath);
        sessions.push({
          id, title, group, time, live: false,
          ...(sourcePath && sourceCwd && sourceId ? {
            pi: {
              sourcePath: resolve(sourcePath),
              sourceCwd: resolve(sourceCwd),
              sourceId,
              ...(forkPath ? { forkPath: resolve(forkPath) } : {}),
            },
          } : {}),
        });
      }
      if (!sessions.length) {
        const recovered = this.discoverSessionSummaries();
        if (!recovered.length) return fallback();
        this.activeSessionId = recovered[0].id;
        this.sessions = recovered;
        CWD = this.resolveActiveWorkingDirectory();
        this.markActiveSession();
        this.persistSessions();
        return;
      }
      const activeSessionId = String(data?.activeSessionId || '').trim() || sessions[0].id;
      if (!sessions.some(s => s.id === activeSessionId)) {
        return fallback();
      }
      this.activeSessionId = activeSessionId;
      this.sessions = sessions;
      CWD = this.resolveActiveWorkingDirectory();
      this.markActiveSession();
      mkdirSync(CWD, { recursive: true });
    } catch {
      const recovered = this.discoverSessionSummaries();
      if (!recovered.length) {
        fallback();
        return;
      }
      this.activeSessionId = recovered[0].id;
      this.sessions = recovered;
      CWD = this.resolveActiveWorkingDirectory();
      this.markActiveSession();
      this.persistSessions();
    }
  }

  private switchSessionInternal(nextSessionId: string, reason: 'session' | 'cwd') {
    const target = this.sessions.find(s => s.id === nextSessionId);
    if (!target) return;

    try { this.session?.dispose?.(); } catch { /* ignore */ }
    this.session = null;
    this.activeSessionId = nextSessionId;
    CWD = this.resolveActiveWorkingDirectory();
    this.markActiveSession();
    this.steps = [];
    this.blocks = [];
    this.textBuf = '';
    this.thinkingBuf = '';
    this.pendingFiles.clear();
    this.fileHarness.clearTurn();
    this.fileHarness.reload();
    this.messages = this.loadSessionMessages(nextSessionId);
    this.persistSessions();
    this.emit(this.sessionSnapshot(reason));
  }

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
      workspaceRoot: this.workspaceRoot,
      cwd: CWD,
      hasKey: !!this.resolvedModel,
      ready: !!this.session,
      error: this.initError,
    };
  }

  /** Current Workspace files for a newly connected browser. Reusing the regular file-event
   *  shape keeps initial hydration and live updates on the same reducer path. */
  fileSnapshot(): Array<{ file: FileNode; content: string }> {
    return this.fileHarness.snapshot();
  }

  /** Bridge harness diffs into Core events. The harness itself is intentionally UI-agnostic. */
  private syncWorkspaceFilesAfterTool(): void {
    const changes = this.fileHarness.sync();
    for (const path of changes.deleted) this.emit({ type: 'file_delete', path });
    for (const change of changes.files) this.emit({ type: 'file', ...change });
  }

  private mergeInstalledPiSessions(discovered: ManagedSessionSummary[]): void {
    const localCwds = new Set(
      this.sessions
        .filter(session => !session.pi)
        .map(session => resolve(this.workspaceRoot, session.id).toLowerCase()),
    );
    const candidates = discovered.filter(session =>
      !localCwds.has(resolve(session.pi?.sourceCwd || '').toLowerCase()));
    const bySource = new Map(
      this.sessions
        .filter((session): session is ManagedSessionSummary & { pi: NonNullable<ManagedSessionSummary['pi']> } => Boolean(session.pi))
        .map(session => [resolve(session.pi.sourcePath).toLowerCase(), session]),
    );
    const inherited = candidates.map(session => {
      const existing = bySource.get(resolve(session.pi!.sourcePath).toLowerCase());
      return existing?.pi?.forkPath
        ? { ...session, pi: { ...session.pi!, forkPath: existing.pi.forkPath } }
        : session;
    });

    if (this.createdFallbackSession && inherited.length) {
      this.sessions = inherited;
      this.activeSessionId = inherited[0].id;
      this.createdFallbackSession = false;
    } else {
      const known = new Set(this.sessions.flatMap(session =>
        session.pi ? [resolve(session.pi.sourcePath).toLowerCase()] : []));
      this.sessions.push(...inherited.filter(session =>
        !known.has(resolve(session.pi!.sourcePath).toLowerCase())));
    }

    this.markActiveSession();
    CWD = this.resolveActiveWorkingDirectory();
    this.fileHarness.reload();
    this.messages = this.loadSessionMessages(this.activeSessionId);
    this.persistSessions();
  }

  /** Read-only gateway. Workspace uses the safe metadata to make the bootstrap decision. */
  async inspectPiInheritance(): Promise<PiInheritancePreview> {
    if (!this.piInspection) this.piInspection = await inspectPiInstallation(getAgentDir());
    return {
      ...this.piInspection.inspection,
      applied: this.piInheritanceApplied,
    };
  }

  /** Execute the bootstrap choice made by the browser Workspace. */
  async bootstrapRuntime(inheritPi: boolean): Promise<RuntimeBootstrapResult> {
    if (this.bootstrapLoading) return this.bootstrapLoading;
    this.bootstrapLoading = (async () => {
      const preview = await this.inspectPiInheritance();
      const shouldApply = inheritPi && preview.available && !this.piInheritanceApplied;
      if (shouldApply) {
        if (this.session?.isStreaming) {
          return {
            ok: false,
            inherited: false,
            preview,
            error: 'Agent 正在执行，暂时不能继承 Pi 配置',
          };
        }
        this.mergeInstalledPiSessions(this.piInspection?.sessions || []);
        try { this.session?.dispose?.(); } catch { /* ignore */ }
        this.session = null;
        this.modelConfiguration = new CoreModelConfiguration({ inheritPi: true });
        this.modelRuntime = undefined;
        this.runtimeReady = false;
        this.resolvedModel = undefined;
        this.activeSpec = MODEL_SPEC;
        this.initError = undefined;
        this.piInheritanceApplied = true;
      }

      await this.init();
      if (this.session) this.emit(this.sessionSnapshot(shouldApply ? 'session' : 'initial'));
      const currentPreview = await this.inspectPiInheritance();
      return {
        ok: Boolean(this.session),
        inherited: this.piInheritanceApplied,
        preview: currentPreview,
        model: this.resolvedModel || this.activeSpec || undefined,
        error: this.initError,
      };
    })().finally(() => {
      this.bootstrapLoading = null;
    });
    return this.bootstrapLoading;
  }

  /** Bring up the Core-owned pi-ai Models runtime, but do NOT create a session yet. */
  private async ensureRuntime() {
    if (this.runtimeReady) return;
    mkdirSync(CWD, { recursive: true });
    this.modelRuntime = await this.modelConfiguration.ensureRuntime();
    this.activeSpec = this.modelConfiguration.activeSpec;
    const inheritedThinking = this.modelConfiguration.inheritedThinkingLevel as ThinkingLevel | undefined;
    if (this.thinkingLevel === 'off' && inheritedThinking &&
      ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(inheritedThinking)) {
      this.thinkingLevel = inheritedThinking;
    }
    this.runtimeReady = true;
  }

  /** (Re)create the agent session bound to `model`. Disposes any prior session. */
  private async createSession(model: any) {
    try { this.session?.dispose?.(); } catch { /* ignore */ }
    this.session = null;
    // Goal state is written as Pi session custom entries, so it follows the same history,
    // resume, fork, and compaction lifecycle as the agent transcript.
    const active = this.sessions.find(item => item.id === this.activeSessionId);
    let sessionManager: SessionManager;
    if (active?.pi) {
      const forkDirectory = join(
        process.cwd(),
        '.workspace',
        '.agentcore',
        'inherited-sessions',
        active.id,
      );
      if (active.pi.forkPath && await isSessionFile(active.pi.forkPath)) {
        sessionManager = SessionManager.open(active.pi.forkPath, forkDirectory, CWD);
      } else {
        if (!await isSessionFile(active.pi.sourcePath)) {
          throw new Error('原 Pi 会话文件已不存在，无法继续该会话');
        }
        sessionManager = SessionManager.forkFrom(active.pi.sourcePath, CWD, forkDirectory);
        active.pi.forkPath = sessionManager.getSessionFile();
        this.persistSessions();
      }
    } else {
      sessionManager = SessionManager.continueRecent(CWD);
    }
    const restoredGoalLevel = this.goalHarness.thinkingLevelForGoal(
      this.goalHarness.snapshot({ sessionManager }),
    );
    if (restoredGoalLevel) this.thinkingLevel = restoredGoalLevel;
    const toolNames = this.contextHarness.stableToolNames(
      CODING_TOOL_NAMES,
      this.goalHarness.toolNames,
    );
    const resourceLoader = new DefaultResourceLoader({
      cwd: CWD,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      additionalExtensionPaths: [this.goalHarness.extensionPath],
      extensionFactories: [createContextExtension(this.contextHarness)],
      appendSystemPrompt: [this.contextHarness.systemPrompt],
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: CWD,
      model,
      modelRuntime: this.modelRuntime,
      // The Pi transcript lives under this session's own CWD. `continueRecent` creates a
      // fresh one for a new hash directory and resumes it when the user returns later.
      sessionManager,
      thinkingLevel: this.thinkingLevel as any,
      tools: toolNames,
      resourceLoader,
    });
    this.session = session;
    this.contextPrefixBaseline = this.contextPrefixSnapshot();
    session.subscribe((ev: any) => this.handle(ev));
  }

  async init() {
    if (this.session) return;
    await this.ensureRuntime();
    const model = this.modelConfiguration.resolveModel(this.activeSpec) || this.modelConfiguration.fallbackModel();
    if (!model) {
      this.initError = '尚未配置模型。请通过模型配置页面添加模型，或编辑 Core models.json。';
      return;
    }
    const selected = await this.modelConfiguration.selectModel(this.providerIdOf(model), model.id);
    if (!selected.ok || !selected.model || !selected.spec) {
      this.initError = selected.error || '模型凭据不可用';
      return;
    }
    this.initError = undefined;
    this.resolvedModel = selected.spec;
    this.activeSpec = selected.spec;
    console.log('[pi] using model:', this.resolvedModel);
    await this.createSession(selected.model);
    this.emit({ type: 'session_start', session: this.publicSessionSummary(this.summary) });
    this.emitGoalSnapshot();
  }

  private handle(ev: any) {
    switch (ev?.type) {
      case 'message_start': {
        if (ev.message?.role !== 'user') break;
        const index = this.steerQueue.findIndex(entry => entry.modelText === this.piMessageText(ev.message));
        if (index < 0) break;
        const [entry] = this.steerQueue.splice(index, 1);
        this.messages.push(entry.message);
        this.persistSessionRecord();
        this.emit({ type: 'steer_delivered', id: entry.item.id, message: entry.message });
        break;
      }
      case 'message_update': {
        const ame = ev.assistantMessageEvent;
        if (ame?.type === 'thinking_delta' && ame.delta) {
          if (!this.firstTokenAt) this.firstTokenAt = Date.now();
          this.thinkingBuf += ame.delta;
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
            this.blocks.push({ kind: 'step', step: this.steps.length - 1 });
            this.emit({ type: 'tool_start', step });
          }
        } else if (ame?.type === 'text_delta' && ame.delta) {
          if (!this.firstTokenAt) this.firstTokenAt = Date.now();
          this.textBuf += ame.delta;
          const last = this.blocks[this.blocks.length - 1];
          if (last?.kind === 'text') last.text += ame.delta;
          else this.blocks.push({ kind: 'text', text: ame.delta });
          this.emit({ type: 'text_delta', delta: ame.delta });
        }
        break;
      }
      case 'tool_execution_start': {
        this.closeRunningThink();
        const goalTrajectory = this.goalHarness.trajectoryStart(ev.toolName, ev.args);
        const step: TrajStep = {
          id: ev.toolCallId,
          t: goalTrajectory ? 'goal' : mapPiTool(ev.toolName),
          title: goalTrajectory?.title || TOOL_TITLE[ev.toolName] || ev.toolName || '工具',
          det: goalTrajectory?.detail || summarizeArgs(ev.args),
          in: goalTrajectory?.input || (() => { try { return JSON.stringify(ev.args); } catch { return undefined; } })(),
          status: 'running',
          time: nowTime(),
          file: ev.args?.path || ev.args?.file_path || ev.args?.filePath,
        };
        this.steps.push(step);
        this.blocks.push({ kind: 'step', step: this.steps.length - 1 });
        // remember the target path: tool_execution_end carries no args, only a result
        if ((ev.toolName === 'write' || ev.toolName === 'edit') && step.file) {
          this.pendingFiles.set(ev.toolCallId, step.file);
        }
        this.emit({ type: 'tool_start', step });
        break;
      }
      case 'tool_execution_end': {
        const step = (ev.toolCallId && this.steps.find(item => item.id === ev.toolCallId))
          || this.steps[this.steps.length - 1];
        if (step) {
          const goalTrajectory = this.goalHarness.trajectoryEnd(ev.toolName, ev.result, ev.isError);
          step.status = 'done';
          step.det = goalTrajectory?.detail || step.det;
          step.out = goalTrajectory?.output || summarizeResult(ev.result, ev.isError);
          this.emit({ type: 'tool_end', step });
        }
        const pending = this.pendingFiles.get(ev.toolCallId);
        this.pendingFiles.delete(ev.toolCallId);
        if (pending) this.captureFile(pending);
        // write/edit are captured precisely above; bash may create, rewrite, rename, or remove
        // any number of workspace files, so reconcile the bounded session root after it ends.
        if (step?.t === 'write' || step?.t === 'code') this.syncWorkspaceFilesAfterTool();
        break;
      }
      case 'agent_end': {
        if (this.interrupting) {
          // The previous prompt is intentionally abandoned. Its partial response must not
          // become the user-visible answer or contaminate the new active branch.
          if (this.turnMessageStartIndex >= 0) this.messages.splice(this.turnMessageStartIndex);
          this.resetTurnAccumulators();
          this.turnMessageStartIndex = -1;
          this.summary = { ...this.summary, live: false, time: sessionTimestamp() };
          this.sessions = this.sessions.map(s => s.id === this.summary.id ? this.summary : s);
          this.persistSessions();
          this.persistSessionRecord();
          this.emit({ type: 'turn_interrupted' });
          break;
        }
        this.closeRunningThink();
        // The final filesystem state is the source of truth for a turn's output list. This
        // catches deletion/rename work performed by shell tools immediately before the turn
        // closes, even if the tool's individual completion event was incomplete.
        this.syncWorkspaceFilesAfterTool();
        const responseUsage = this.contextHarness.responseUsage(ev.messages || []);
        this.goalHarness.recordAgentLoop(this.session, Math.floor(Date.now() / 1000), {
          thinkingSteps: this.steps.filter(step => step.t === 'think').length,
          toolCalls: this.steps.filter(step => step.t !== 'think').length,
        });
        this.emitGoalBudgetReport(responseUsage);
        const artifacts: Artifact[] = this.fileHarness.finalArtifacts();
        const presentedOutput = this.fileHarness.projectAgentOutput(this.textBuf, this.blocks, artifacts);
        const completedGoal = this.goalHarness.snapshot(this.session);
        const trajectory = completedGoal?.status === 'complete'
          ? this.goalHarness.projectCompletedTrajectory(
              this.steps,
              completedGoal,
              this.goalHarness.executionMetrics(this.session, completedGoal.goalId),
            )
          : this.steps.slice();
        // TTFT / TPOT use local timing; every token field comes directly from pi-ai's
        // normalized assistant response metadata.
        const { input, output, cacheRead, cacheWrite, cacheWrite1h, totalTokens } = responseUsage;
        const currentPrefix = this.contextPrefixSnapshot();
        const contextMetrics = this.contextHarness.turnMetrics(
          { input, cacheRead, cacheWrite },
          currentPrefix,
          this.contextPrefixBaseline || currentPrefix,
        );
        const now = Date.now();
        const ttft = this.firstTokenAt && this.turnStart ? this.firstTokenAt - this.turnStart : 0;
        const duration = this.turnStart ? now - this.turnStart : 0;
        const genTime = this.firstTokenAt ? now - this.firstTokenAt : duration;
        const message: Message = {
          role: 'agent',
          status: 'done',
          intro: presentedOutput.text.trim() || undefined,
          thinking: this.thinkingBuf || undefined,
          traj: trajectory,
          blocks: presentedOutput.blocks,
          artifacts,
          stats: {
            ttft,
            tpot: output > 0 ? genTime / output : 0,
            duration,
            input,
            output,
            cacheWrite1h,
            totalTokens,
            ...contextMetrics,
          },
        };
        this.messages.push(message);
        this.persistSessionRecord();
        this.emit({ type: 'agent_end', message });
        this.emitGoalSnapshot();
        // reset per-turn accumulators; the finalized message is now the UI's record
        this.resetTurnAccumulators();
        this.turnParentId = null;
        this.turnMessageStartIndex = -1;
        this.summary = { ...this.summary, live: false, time: sessionTimestamp() };
        this.sessions = this.sessions.map(s => s.id === this.summary.id ? this.summary : s);
        this.persistSessions();
        this.persistSessionRecord();
        break;
      }
      default: break;
    }
  }

  private captureFile(rawPath: string) {
    const captured = this.fileHarness.capture(rawPath);
    if (captured) this.emit({ type: 'file', ...captured });
  }

  private visibleUserMessage(text: string, presentation: { displayText?: string; workspaceChanges?: WorkspaceChange[] }): Message {
    const visible = transcriptPrompt(presentation.displayText || text);
    const workspaceChanges = Array.isArray(presentation.workspaceChanges) && presentation.workspaceChanges.length
      ? presentation.workspaceChanges.map(change => ({ path: String(change.path || ''), kind: 'edit' as const })).filter(change => !!change.path)
      : undefined;
    return {
      role: 'user', text: visible.text, attachments: visible.attachments,
      workspaceChanges, when: nowTime(),
    };
  }

  private piMessageText(message: any): string {
    if (typeof message?.content === 'string') return message.content;
    if (!Array.isArray(message?.content)) return '';
    return message.content.filter((part: any) => part?.type === 'text').map((part: any) => String(part.text || '')).join('');
  }

  private contextPrefixSnapshot(): ContextPrefixSnapshot {
    const activeNames = this.session?.getActiveToolNames?.() || [];
    const tools = activeNames
      .map((name: string) => this.session?.getToolDefinition?.(name))
      .filter((tool: any) => !!tool);
    return this.contextHarness.prefixSnapshot(
      this.contextHarness.stabilizeSystemPrompt(this.session?.systemPrompt || ''),
      tools,
    );
  }

  private modelPrompt(text: string): string {
    // SkillHarness performs explicit, just-in-time disclosure. ContextHarness then keeps the
    // resulting dynamic user turn free of timestamps and other prefix-breaking metadata.
    return this.contextHarness.assembleUserTurn(this.skillHarness.inject(text));
  }

  private resetTurnAccumulators() {
    this.steps = [];
    this.blocks = [];
    this.textBuf = '';
    this.thinkingBuf = '';
    this.pendingFiles.clear();
    this.fileHarness.clearTurn();
    this.turnStart = 0;
    this.firstTokenAt = 0;
  }

  async prompt(text: string, presentation: { displayText?: string; workspaceChanges?: WorkspaceChange[] } = {}) {
    // This is a safety net for callers racing a just-started turn. The browser normally uses
    // steer() explicitly so it can render the queue immediately.
    if (this.session?.isStreaming) {
      if (this.goalHarness.isCommand(text)) {
        this.ensureGoalThinking(text);
        await this.session.prompt(this.contextHarness.assembleUserTurn(text));
        this.emitGoalSnapshot();
        return;
      }
      await this.steer(text, presentation);
      return;
    }
    await this.startPrompt(text, presentation);
  }

  private async startPrompt(text: string, presentation: { displayText?: string; workspaceChanges?: WorkspaceChange[] } = {}, replacement = false) {
    try {
      // A failed provider turn may not emit agent_end. Always start the next turn with clean
      // chronological accumulators so partial output cannot leak into a later response.
      this.steps = [];
      this.blocks = [];
      this.textBuf = '';
      this.thinkingBuf = '';
      this.pendingFiles.clear();
      this.fileHarness.clearTurn();
      this.turnStart = Date.now();
      this.firstTokenAt = 0;

      // Persist the user-visible prompt rather than the expanded model input, which can contain
      // large file bodies and Canvas context. Attachments retain the references users saw.
      const userMessage = this.visibleUserMessage(text, presentation);
      this.turnMessageStartIndex = this.messages.length;
      this.messages.push(userMessage);
      this.ensureGoalThinking(text);
      await this.init();
      if (!this.session) {
        this.turnMessageStartIndex = -1;
        this.persistSessionRecord();
        this.emit({ type: 'error', message: this.initError || '未配置可用模型。' });
        return;
      }
      if (this.session.isStreaming) {
        // This should only be reachable through a racing non-browser caller. Do not append a
        // duplicate transcript entry; hand the exact request to Pi's steering queue instead.
        this.messages.pop();
        this.turnMessageStartIndex = -1;
        await this.steer(text, presentation);
        return;
      }
      if (!this.summary.title || this.summary.title === '新对话') {
        this.summary = { ...this.summary, title: titleFrom(text), time: sessionTimestamp() };
        this.sessions = this.sessions.map(s => s.id === this.summary.id ? this.summary : s);
        this.persistSessions();
        this.persistSessionRecord();
        this.emit({ type: 'session_start', session: this.publicSessionSummary(this.summary) });
      }
      this.turnParentId = this.session.sessionManager.getLeafId();
      this.persistSessionRecord();
      if (replacement) this.emit({ type: 'turn_replaced', message: userMessage });
      await this.session.prompt(this.modelPrompt(text));
      this.emitGoalSnapshot();
    } catch (e: any) {
      this.persistSessionRecord();
      this.emit({ type: 'error', message: e?.message || String(e) });
    }
  }

  /** Queue a high-priority user instruction into Pi's native steering loop. */
  async steer(text: string, presentation: { displayText?: string; workspaceChanges?: WorkspaceChange[] } = {}): Promise<{ ok: boolean; item?: SteerItem; error?: string }> {
    try {
      await this.init();
      if (!this.session) return { ok: false, error: this.initError || '未配置可用模型。' };
      if (!this.session.isStreaming) return { ok: false, error: 'Agent 当前没有可插入的执行循环。' };
      const item: SteerItem = { id: newSessionId(), text: this.visibleUserMessage(text, presentation).text || text, when: nowTime() };
      const entry: QueuedSteer = {
        item,
        modelText: this.modelPrompt(text),
        message: this.visibleUserMessage(text, presentation),
      };
      this.steerQueue.push(entry);
      this.emit({ type: 'steer_queued', item });
      await this.session.steer(entry.modelText);
      return { ok: true, item };
    } catch (e: any) {
      this.steerQueue = [];
      this.emit({ type: 'steer_cleared' });
      const error = e?.message || String(e);
      this.emit({ type: 'error', message: error });
      return { ok: false, error };
    }
  }

  /** Stop the active turn, discard its branch from context, and start a replacement instruction. */
  async interruptAndSteer(text: string, presentation: { displayText?: string; workspaceChanges?: WorkspaceChange[] } = {}): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.init();
      if (!this.session) return { ok: false, error: this.initError || '未配置可用模型。' };
      if (!this.session.isStreaming) {
        void this.startPrompt(text, presentation, true);
        return { ok: true };
      }
      this.interrupting = true;
      this.session.clearQueue();
      this.steerQueue = [];
      this.emit({ type: 'steer_cleared' });
      await this.session.abort();

      // Pi persists sessions as an append-only tree. Navigating back to the leaf that preceded
      // this turn removes its user input and partial work from the active model context while
      // retaining the abandoned branch for local audit/recovery.
      if (this.turnParentId) await this.session.navigateTree(this.turnParentId, { summarize: false });
      else {
        this.session.sessionManager.resetLeaf();
        this.session.agent.state.messages = [];
      }
      this.turnParentId = null;
      this.interrupting = false;
      void this.startPrompt(text, presentation, true);
      return { ok: true };
    } catch (e: any) {
      this.interrupting = false;
      const error = e?.message || String(e);
      this.emit({ type: 'error', message: error });
      return { ok: false, error };
    }
  }

  private applyThinkingLevel(level: ThinkingLevel): void {
    const changed = this.thinkingLevel !== level;
    this.thinkingLevel = level;
    try { if (this.session) this.session.setThinkingLevel(level); } catch { /* ignore */ }
    if (changed) this.emit({ type: 'thinking_updated', thinking: level !== 'off' });
  }

  private ensureGoalThinking(text: string): void {
    const level = this.goalHarness.thinkingLevelForCommand(text);
    if (level) this.applyThinkingLevel(level);
  }

  async setThinking(on: boolean) {
    this.applyThinkingLevel(on ? 'medium' : 'off');
  }

  async listModels(): Promise<ModelOption[]> {
    await this.ensureRuntime();
    return this.modelConfiguration.listModels(this.resolvedModel || this.activeSpec);
  }

  async getModelConfigFile(): Promise<ModelConfigFile> {
    return this.modelConfiguration.getConfigFile();
  }

  async saveModelConfigFile(content: string): Promise<{ ok: boolean; error?: string; file?: ModelConfigFile }> {
    await this.ensureRuntime();
    return this.modelConfiguration.saveConfigFile(content);
  }

  parseModelConfigFile(content: string) {
    return this.modelConfiguration.parseImportedConfig(content);
  }

  async testCustomModel(entry: CustomModelEntry, prompt: string): Promise<ModelTestResult> {
    return this.modelConfiguration.testCustomModel(entry, prompt);
  }

  async testModel(providerId: string, modelId: string, benchmark = false, prompt = ''): Promise<ModelTestResult> {
    return this.modelConfiguration.testModel(providerId, modelId, benchmark, prompt);
  }

  async addCustomModel(entry: CustomModelEntry): Promise<{ ok: boolean; error?: string; entry?: CustomModelEntry }> {
    return this.modelConfiguration.addCustomModel(entry);
  }

  async updateModel(providerId: string, modelId: string, update: Parameters<CoreModelConfiguration['updateModel']>[2]) {
    const result = await this.modelConfiguration.updateModel(providerId, modelId, update);
    if (result.ok && result.model && this.resolvedModel === `${providerId}/${modelId}`) {
      this.activeSpec = result.model;
      this.resolvedModel = result.model;
      const next = this.modelConfiguration.resolveModel(result.model);
      if (next) await this.createSession(next);
    }
    return result;
  }

  async removeCustomModel(id: string): Promise<{ ok: boolean; error?: string }> {
    const wasActive = this.resolvedModel?.startsWith(`${id}/`) || false;
    const result = await this.modelConfiguration.removeCustomModel(id);
    if (!result.ok) return result;
    if (wasActive) {
      this.resolvedModel = undefined;
      this.activeSpec = result.active || MODEL_SPEC;
      this.session = null;
      try { await this.init(); } catch { /* surfaced via initError */ }
    }
    return { ok: true };
  }

  /** Switch the active model — recreates the session bound to the SDK model. */
  async setActiveModel(providerId: string, modelId: string): Promise<{ ok: boolean; error?: string; model?: string }> {
    await this.ensureRuntime();
    const selected = await this.modelConfiguration.selectModel(providerId, modelId);
    if (!selected.ok || !selected.model || !selected.spec) return { ok: false, error: selected.error || '未找到该模型' };
    this.activeSpec = selected.spec;
    this.resolvedModel = selected.spec;
    try { await this.createSession(selected.model); }
    catch (e: any) { return { ok: false, error: '切换失败：' + (e?.message || e) }; }
    console.log('[pi] switched model:', this.resolvedModel);
    this.emit({ type: 'session_start', session: this.publicSessionSummary(this.summary) });
    return { ok: true, model: this.resolvedModel };
  }

  /** Change the agent's working directory (persisted). Re-binds the session to the new workspace
   *  and resets per-session state — the old conversation/files belonged to the previous cwd. */
  async setCwd(path: string): Promise<{ ok: boolean; error?: string; workspaceRoot?: string; cwd?: string }> {
    const p = (path || '').trim();
    if (!p) return { ok: false, error: '请填写工作目录' };
    try { mkdirSync(p, { recursive: true }); }
    catch (e: any) { return { ok: false, error: '无法访问该目录：' + (e?.message || e) }; }
    WORKSPACE_ROOT = resolve(p);
    saveCwd(WORKSPACE_ROOT);
    this.steps = [];
    this.textBuf = '';
    this.pendingFiles.clear();
    this.fileHarness.clear();
    // Keep the active session id and continue isolation under the new root.
    this.workspaceRoot = resolve(WORKSPACE_ROOT);
    CWD = this.resolveActiveSessionPath();
    this.markActiveSession();
    this.fileHarness.reload();
    this.messages = this.loadSessionMessages(this.activeSessionId);
    try {
      await this.ensureRuntime();
      const model = this.modelConfiguration.resolveModel(this.activeSpec) || this.modelConfiguration.fallbackModel();
      if (model) await this.createSession(model);
    } catch (e: any) {
      return { ok: false, error: '切换工作目录失败：' + (e?.message || e) };
    }
    this.persistSessions();
    this.emit(this.sessionSnapshot('cwd'));
    console.log('[pi] workspace root set:', WORKSPACE_ROOT);
    return { ok: true, workspaceRoot: this.workspaceRoot, cwd: CWD };
  }

  async saveFile(path: string, content: string): Promise<{ ok: boolean; error?: string }> {
    const result = this.fileHarness.saveText(path, content);
    if (result.ok && result.file) this.emit({ type: 'file', file: result.file, content: result.content || '' });
    return { ok: result.ok, error: result.error };
  }

  async importFile(path: string, data: string): Promise<{ ok: boolean; error?: string }> {
    const result = this.fileHarness.importOffice(path, data);
    if (result.ok && result.file) this.emit({ type: 'file', file: result.file, content: result.content || '' });
    return { ok: result.ok, error: result.error };
  }

  async renameFile(path: string, nextPath: string): Promise<{ ok: boolean; error?: string; path?: string }> {
    const result = this.fileHarness.renameFile(path, nextPath);
    if (result.ok && result.file && result.previousPath) {
      this.emit({ type: 'file_rename', path: result.previousPath, file: result.file, content: result.content || '' });
    }
    return { ok: result.ok, path: result.path, error: result.error };
  }

  async deleteFile(path: string): Promise<{ ok: boolean; error?: string }> {
    const result = this.fileHarness.deleteFile(path);
    if (result.ok && result.tracked && result.path) this.emit({ type: 'file_delete', path: result.path });
    return { ok: result.ok, error: result.error };
  }

  /** Read an inline-previewable binary from the active session only. The transport never accepts
   * absolute paths outside CWD, hidden files, directories, or payloads above the Canvas limit. */
  readCanvasBinary(path: string): { ok: boolean; data?: Buffer; contentType?: string; error?: string } {
    return this.fileHarness.readCanvasBinary(path);
  }

  listSessions(): SessionSummary[] {
    this.markActiveSession();
    return this.sessions.map(session => this.publicSessionSummary(session));
  }

  async switchSession(id: string): Promise<boolean> {
    const target = this.sessions.find(s => s.id === id);
    if (!target) return false;
    this.switchSessionInternal(id, 'session');
    return true;
  }

  async newSession() {
    const next = this.nextSessionSummary({ id: newSessionId(), live: true, time: sessionTimestamp() });
    this.sessions.unshift(next);
    this.persistSessions();
    this.switchSessionInternal(next.id, 'session');
  }
}

export const runtime = new PiRuntime();
