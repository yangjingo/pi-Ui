// Agent protocol types. Runtime-agnostic: no React, no Node, no Pi.
// These are the shapes the UI renders and the agent runtime produces.

export type FileType = 'md' | 'doc' | 'sheet' | 'slides' | 'fig' | 'png' | 'html' | 'code' | 'json' | 'mermaid' | 'excalidraw' | 'pdf' | 'binary' | 'folder';

export interface FileNode {
  name: string;
  type: FileType;
  path?: string;
  size?: string;
  open?: boolean;
  children?: FileNode[];
  variant?: string;
  caption?: string;
  rows?: string[][];
  content?: string;
  totals?: number[];
}

export interface TrajStep {
  id?: string;      // stable tool-call id; absent for synthetic reasoning steps
  t: string;        // step kind, mapped to an icon: search|read|write|canvas|plan|sheet|query|analyze|code|think
  title: string;
  det: string;
  in?: string;
  out?: string;
  status: 'done' | 'running';
  time: string;
  file?: string;
  text?: string;    // full reasoning text for 'think' steps (det holds a one-line preview)
}

/** Chronological content emitted during one assistant turn. Step blocks reference `traj`
 *  by index so running tool state can update in place without duplicating the step payload. */
export type AgentContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'step'; step: number };

export interface Artifact {
  name: string;
  type: FileType;
  label: string;
  path?: string;
  /** File Harness projection: true when Canvas has an inline renderer for this format. */
  canvasPreview?: boolean;
}

/** A user-authored workspace mutation carried into the next Agent turn. */
export interface WorkspaceChange {
  path: string;
  kind: 'edit';
}

/** A user instruction waiting to be injected into Pi's current agent loop. */
export interface SteerItem {
  id: string;
  text: string;
  when: string;
}

/** Persistent long-running-task state supplied by the pi-codex-goal harness. */
export type GoalStatus = 'active' | 'paused' | 'budgetLimited' | 'complete';

export interface LongRunningGoal {
  goalId: string;
  objective: string;
  status: GoalStatus;
  tokenBudget: number | null;
  usage: { tokensUsed: number; activeSeconds: number };
  createdAt: number;
  updatedAt: number;
}

export interface TurnStats {
  ttft: number;      // time-to-first-token, ms (prompt → first output token)
  tpot: number;      // time-per-output-token, ms (generation time / output tokens)
  duration: number;  // total turn time, ms
  input: number;     // uncached input tokens
  output: number;    // output tokens
  cacheRead?: number;            // provider-reported prefix cache hits
  cacheWrite?: number;           // provider-reported prefix cache writes
  cacheWrite1h?: number;         // Anthropic subset written with one-hour retention
  totalTokens?: number;          // provider-reported total, including cached prompt tokens
  cacheHitRate?: number;         // cacheRead / total prompt tokens, 0..1
  contextPrefix?: string;        // short deterministic System + Tools fingerprint
  contextPrefixStable?: boolean; // unchanged from this Pi session's baseline
}

export interface Message {
  role: 'user' | 'agent';
  text?: string;
  when?: string;
  attachments?: Artifact[];
  workspaceChanges?: WorkspaceChange[];
  status?: 'running' | 'done';
  intro?: string;
  thinking?: string;   // reasoning tokens (extended thinking)
  traj?: TrajStep[];
  blocks?: AgentContentBlock[]; // text/tool/reasoning blocks in the order they occurred
  outro?: string;
  artifacts?: Artifact[];
  stats?: TurnStats;
}

export interface Session {
  id: string;
  title: string;
  group: string;
  time: string;
  live: boolean;
  messages: Message[];
  openTabs: string[];
  files: FileNode[];
}

export type SessionLifecycleStatus = 'idle' | 'running' | 'completed' | 'error';

/** Lightweight session descriptor for lists/drawers (no message bodies). */
export interface SessionSummary {
  id: string;
  /** Native provider session ID when `id` is an internal collision-safe key. */
  sourceId?: string;
  title: string;
  group: string;
  time: string;
  live: boolean;
  status: SessionLifecycleStatus;
  /** Monotonic completion marker. Browsers compare this with their per-workspace seen marker. */
  completedRunId?: number;
  completedAt?: string;
  error?: string;
}

/**
 * A user-defined model endpoint, added through the model drawer. Persisted in
 * Core-owned `.workspace/.agentcore/models.json` plus the pi-ai CredentialStore
 * (both gitignored). Canvas receives this plain request shape but never persists it.
 * `format` picks the wire protocol: openai → chat/completions (Bearer auth),
 * anthropic → messages (x-api-key + anthropic-version).
 */
export interface CustomModelEntry {
  id: string;                              // provider id (slug), unique
  label: string;                           // display name
  format: 'openai' | 'anthropic';
  baseUrl: string;                         // e.g. https://api.openai.com/v1
  apiKey: string;
  modelId: string;                         // e.g. gpt-4o-mini
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

/** Editable fields for one Core-managed provider/model pair. An omitted or blank
 * API key preserves the credential already held by pi-ai's CredentialStore. */
export interface UpdateModelEntry {
  label: string;
  format: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

/** Result of asking Core to interpret an uploaded model configuration. */
export interface ModelConfigImportResult {
  ok: boolean;
  entry?: Partial<CustomModelEntry>;
  missing?: string[];
  error?: string;
}

/** Result of probing a custom model with a one-shot test prompt. */
export interface ModelTestResult {
  ok: boolean;
  latencyMs?: number;                      // round-trip of the test call
  ttft?: number;                           // reuse the conversation timing model: first-response latency
  tpot?: number;                           // reuse the conversation timing model: output token speed
  reply?: string;                          // first line of the model's reply
  inputTokens?: number;
  outputTokens?: number;
  benchmarks?: ModelBenchmarkResult[];
  error?: string;
}

export interface ModelBenchmarkResult extends ModelTestResult {
  inputTarget: number;
  outputTarget: number;
  runs: number;
}

/** A model the user can select as active (builtin or custom). */
export interface ModelOption {
  id: string;                              // provider/modelId
  provider: string;
  modelId: string;
  label: string;
  custom: boolean;
  active: boolean;
  baseUrl?: string;
  /** Server-generated display value; the credential itself never leaves Core. */
  apiKeyMasked?: string;
  apiKeyConfigured?: boolean;
  /** Where Core obtained this model's provider definition. */
  configSource?: 'core' | 'runtime';
  /** Safe, human-readable source from Core (never includes credentials). */
  sourceLabel?: string;
  format?: 'openai' | 'anthropic';
}

export interface ModelConfigFile {
  path: string;
  /** Safe metadata only; Core never returns auth.json content to the browser. */
  authPath: string;
  content: string;
}

/** Safe metadata returned by the Node gateway. The browser decides whether to inherit it. */
export interface PiInheritancePreview {
  available: boolean;
  applied: boolean;
  sessionCount: number;
  modelCount: number;
  defaultModel?: string;
  hasCredentials: boolean;
}

export interface RuntimeBootstrapResult {
  ok: boolean;
  inherited: boolean;
  preview: PiInheritancePreview;
  model?: string;
  error?: string;
}

export interface AppData {
  sessions: Session[];
  contents: Record<string, string>;
  projectOrder: string[];
  generatedAt: string;
}
