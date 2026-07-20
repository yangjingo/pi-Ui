// Core domain types. Runtime-agnostic: no React, no Node, no Pi.
// These are the shapes the UI renders and the agent runtime produces.

export type FileType = 'md' | 'sheet' | 'fig' | 'png' | 'html' | 'code' | 'folder';

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

export interface Artifact { name: string; type: FileType; label: string; }

export interface TurnStats {
  ttft: number;      // time-to-first-token, ms (prompt → first output token)
  tpot: number;      // time-per-output-token, ms (generation time / output tokens)
  duration: number;  // total turn time, ms
  input: number;     // input tokens
  output: number;    // output tokens
}

export interface Message {
  role: 'user' | 'agent';
  text?: string;
  when?: string;
  status?: 'running' | 'done';
  intro?: string;
  thinking?: string;   // reasoning tokens (extended thinking)
  traj?: TrajStep[];
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

/** Lightweight session descriptor for lists/drawers (no message bodies). */
export interface SessionSummary {
  id: string;
  title: string;
  group: string;
  time: string;
  live: boolean;
}

/**
 * A user-defined model endpoint, added through the model drawer. Persisted in
 * `.pi-workspace/custom-models.json` (gitignored, server-side only — the key
 * never reaches the browser bundle beyond what the user typed into the form).
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

/** Result of probing a custom model with a one-shot test prompt. */
export interface ModelTestResult {
  ok: boolean;
  latencyMs?: number;                      // round-trip of the test call
  reply?: string;                          // first line of the model's reply
  outputTokens?: number;
  error?: string;
}

/** A model the user can select as active (builtin or custom). */
export interface ModelOption {
  id: string;                              // provider/modelId
  provider: string;
  modelId: string;
  label: string;
  custom: boolean;
  active: boolean;
}

export interface AppData {
  sessions: Session[];
  contents: Record<string, string>;
  projectOrder: string[];
  generatedAt: string;
}
