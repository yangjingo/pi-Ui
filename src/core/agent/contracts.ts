// The single contract between the Core and the UI/UX layers.
// Browser-safe: no Node, no Pi, no React. Both sides import this.

import type {
  CustomModelEntry,
  FileType,
  FileNode,
  LongRunningGoal,
  Message,
  ModelConfigFile,
  ModelConfigImportResult,
  ModelOption,
  ModelTestResult,
  SessionSummary,
  SteerItem,
  TrajStep,
  UpdateModelEntry,
  WorkspaceChange,
} from './types';

/**
 * Everything the agent runtime emits to the UI flows as one of these events.
 * The UI reduces them into its live session model (messages, trajectory, files).
 */
export type AgentEvent =
  | { type: 'session_start'; session: SessionSummary }
  /** Complete persisted state for one session. Sent on initial connect and session switches so
   * the conversation transcript and its workspace always change together. */
  | { type: 'session_snapshot'; session: SessionSummary; messages: Message[]; steers: SteerItem[]; goal: LongRunningGoal | null; thinking: boolean; cwd: string; files: Array<{ file: FileNode; content: string }>; reason: 'initial' | 'session' | 'cwd' }
  | { type: 'text_delta'; delta: string }            // streaming assistant text
  | { type: 'thinking_delta'; delta: string }        // streaming reasoning tokens
  | { type: 'tool_start'; step: TrajStep }           // a trajectory step began
  | { type: 'tool_update'; step: TrajStep }          // streaming tool output
  | { type: 'tool_end'; step: TrajStep }             // step finished (status/time finalized)
  | { type: 'file'; file: FileNode; content: string } // agent wrote/edited a file
  | { type: 'file_rename'; path: string; file: FileNode; content: string }
  | { type: 'file_delete'; path: string }
  | { type: 'workspace_snapshot'; cwd: string; files: Array<{ file: FileNode; content: string }> }
  | { type: 'workspace_reset'; cwd: string; reason: 'cwd' | 'session'; files: Array<{ file: FileNode; content: string }> }
  | { type: 'steer_queued'; item: SteerItem }
  | { type: 'steer_delivered'; id: string; message: Message }
  | { type: 'steer_cleared' }
  /** The pi-codex-goal harness changed durable goal state for the active Pi session. */
  | { type: 'goal_updated'; goal: LongRunningGoal | null }
  /** GoalHarness generated a terminal report file that should be presented in Canvas. */
  | { type: 'goal_report'; goalId: string; file: FileNode; content: string }
  /** Core changed the effective reasoning mode, including the automatic /goal policy. */
  | { type: 'thinking_updated'; thinking: boolean }
  /** The current agent loop was stopped and its user input was removed from the active Pi branch. */
  | { type: 'turn_interrupted' }
  /** The replacement prompt for an interrupted turn, emitted before its new loop begins. */
  | { type: 'turn_replaced'; message: Message }
  | { type: 'agent_end'; message: Message }          // assistant turn finalized
  | { type: 'error'; message: string };

/**
 * The UI talks to the agent through this interface alone.
 * The browser implementation streams from the Node core over SSE; the Node core
 * wraps it around the Pi SDK. Either side can be swapped without touching the other.
 */
export interface AgentClient {
  /** Send expanded model input while optionally preserving the user's original composer text in the timeline. */
  prompt(text: string, displayText?: string, workspaceChanges?: WorkspaceChange[]): Promise<boolean>;
  /** Queue a message for Pi to inject before its next model call in the active loop. */
  steer(text: string, displayText?: string, workspaceChanges?: WorkspaceChange[]): Promise<boolean>;
  /** Abort the active loop, branch away from its input, then start a replacement prompt. */
  interruptAndSteer(text: string, displayText?: string, workspaceChanges?: WorkspaceChange[]): Promise<boolean>;
  /** Toggle extended thinking (reasoning tokens) for subsequent turns. */
  setThinking(on: boolean): Promise<void>;
  /** Save an edited file's content back into the agent's file store. */
  saveFile(path: string, content: string): Promise<{ ok: boolean; error?: string }>;
  /** Import an Office Open XML file. The original binary is persisted; Excel receives an extracted preview. */
  importFile(path: string, data: string): Promise<{ ok: boolean; error?: string }>;
  /** Rename a file inside the active workspace. */
  renameFile(path: string, nextPath: string): Promise<{ ok: boolean; error?: string; path?: string }>;
  /** Permanently delete a file inside the active workspace. */
  deleteFile(path: string): Promise<{ ok: boolean; error?: string }>;
  /** Change the agent's working directory (re-binds the session, resets conversation state). */
  setCwd(path: string): Promise<{ ok: boolean; error?: string }>;
  listModels(): Promise<ModelOption[]>;
  getModelConfigFile(): Promise<ModelConfigFile>;
  saveModelConfigFile(content: string): Promise<{ ok: boolean; error?: string; file?: ModelConfigFile; models?: ModelOption[] }>;
  parseModelConfigFile(content: string): Promise<ModelConfigImportResult>;
  testCustomModel(entry: CustomModelEntry, prompt: string): Promise<ModelTestResult>;
  testModel(providerId: string, modelId: string, benchmark?: boolean, prompt?: string): Promise<ModelTestResult>;
  addCustomModel(entry: CustomModelEntry): Promise<{ ok: boolean; error?: string; entry?: CustomModelEntry }>;
  updateModel(providerId: string, modelId: string, update: UpdateModelEntry): Promise<{ ok: boolean; error?: string; model?: string }>;
  removeCustomModel(id: string): Promise<{ ok: boolean; error?: string }>;
  setActiveModel(providerId: string, modelId: string): Promise<{ ok: boolean; error?: string; model?: string }>;
  listSessions(): Promise<SessionSummary[]>;
  newSession(): Promise<{ ok: boolean; error?: string }>;
  switchSession(id: string): Promise<{ ok: boolean; error?: string }>;
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
    case 'xlsx':
    case 'xlsm':
    case 'xltx':
    case 'xltm': return 'sheet';
    case 'docx':
    case 'docm':
    case 'dotx':
    case 'dotm': return 'doc';
    case 'pptx':
    case 'pptm':
    case 'ppsx':
    case 'ppsm':
    case 'potx':
    case 'potm': return 'slides';
    case 'pdf': return 'pdf';
    case 'html':
    case 'htm': return 'html';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp': return 'png';
    case 'json': return 'json';
    case 'mmd':
    case 'mermaid': return 'mermaid';
    case 'excalidraw': return 'excalidraw';
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
    default: return 'binary';
  }
}
