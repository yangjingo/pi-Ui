// The single contract between the Core and the UI/UX layers.
// Browser-safe: no Node, no Pi, no React. Both sides import this.

import type { FileType, FileNode, Message, SessionSummary, TrajStep } from './types';

/**
 * Everything the agent runtime emits to the UI flows as one of these events.
 * The UI reduces them into its live session model (messages, trajectory, files).
 */
export type AgentEvent =
  | { type: 'session_start'; session: SessionSummary }
  | { type: 'text_delta'; delta: string }            // streaming assistant text
  | { type: 'thinking_delta'; delta: string }        // streaming reasoning tokens
  | { type: 'tool_start'; step: TrajStep }           // a trajectory step began
  | { type: 'tool_update'; step: TrajStep }          // streaming tool output
  | { type: 'tool_end'; step: TrajStep }             // step finished (status/time finalized)
  | { type: 'file'; file: FileNode; content: string } // agent wrote/edited a file
  | { type: 'agent_end'; message: Message }          // assistant turn finalized
  | { type: 'error'; message: string };

/**
 * The UI talks to the agent through this interface alone.
 * The browser implementation streams from the Node core over SSE; the Node core
 * wraps it around the Pi SDK. Either side can be swapped without touching the other.
 */
export interface AgentClient {
  prompt(text: string): Promise<void>;
  /** Toggle extended thinking (reasoning tokens) for subsequent turns. */
  setThinking(on: boolean): Promise<void>;
  /** Save an edited file's content back into the agent's file store. */
  saveFile(path: string, content: string): Promise<void>;
  /** Change the agent's working directory (re-binds the session, resets conversation state). */
  setCwd(path: string): Promise<{ ok: boolean; error?: string }>;
  listSessions(): Promise<SessionSummary[]>;
  newSession(): Promise<void>;
  switchSession(id: string): Promise<void>;
  /** Stream of agent events. Returns an unsubscribe function. */
  subscribe(fn: (e: AgentEvent) => void): () => void;
}

/** Map a Pi tool name to a trajectory step kind (UI maps the kind to an icon). */
export function mapPiTool(name: string): string {
  switch (name) {
    case 'read': return 'read';
    case 'write':
    case 'edit': return 'write';
    case 'bash': return 'code';
    case 'grep':
    case 'find':
    case 'ls': return 'search';
    default: return 'think';
  }
}

/** Classify a filename into a renderable file type. */
export function fileTypeOf(name: string): FileType {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'md':
    case 'markdown':
    case 'txt': return 'md';
    case 'csv':
    case 'tsv': return 'sheet';
    case 'html':
    case 'htm': return 'html';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp': return 'png';
    case 'json': return 'fig';
    // Source code: render as a monospaced code block (NOT markdown — '#' comments and
    // indentation must survive). Previously these fell through to 'md' and got mangled.
    case 'py': case 'pyw': case 'pyi':
    case 'js': case 'mjs': case 'cjs':
    case 'ts': case 'jsx': case 'tsx': case 'mts': case 'cts':
    case 'sh': case 'bash': case 'zsh': case 'fish':
    case 'css': case 'scss': case 'less':
    case 'xml': case 'yml': case 'yaml': case 'toml':
    case 'ini': case 'cfg': case 'conf': case 'env':
    case 'java': case 'kt': case 'scala': case 'groovy':
    case 'c': case 'h': case 'cpp': case 'cc': case 'hpp': case 'cxx':
    case 'go': case 'rs': case 'rb': case 'php': case 'sql':
    case 'r': case 'lua': case 'pl': case 'pm':
    case 'swift': case 'dart': case 'vue': case 'svelte':
    case 'dockerfile': case 'makefile': case 'gradle':
      return 'code';
    default: return 'md';
  }
}
