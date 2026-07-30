import type { AgentEvent } from './contracts';
import type { AgentContentBlock, FileNode, LongRunningGoal, Message, SessionSummary, SteerItem, TrajStep } from './types';

export interface StreamingTurn {
  text: string;
  thinking: string;
  steps: TrajStep[];
  blocks: AgentContentBlock[];
}

export interface AgentState {
  summary: SessionSummary | null;
  messages: Message[];
  streaming: StreamingTurn | null;
  fileList: FileNode[];
  contents: Record<string, string>;
  error: string | null;
  loading: boolean;
  model: string | null;
  /** Persisted Workspace root. Agent session files live in a child directory under this root. */
  workspaceRoot: string | null;
  /** Active session directory used by Files and trajectory state. */
  cwd: string | null;
  workspaceReady: boolean;
  workspaceMode: 'loading' | 'disk' | 'demo';
  /** SSE delivery is separate from a model turn: an in-flight turn can survive a browser reconnect. */
  connectionStatus: 'connecting' | 'connected' | 'reconnecting';
  steerQueue: SteerItem[];
  goal: LongRunningGoal | null;
  thinking: boolean;
}

/** Browser-wide store. Session data is keyed, while connection/model/workspace metadata is
 * shared by every Session displayed in this browser Tab. */
export interface AgentClientState {
  sessions: Record<string, AgentState>;
  model: string | null;
  workspaceRoot: string | null;
  connectionStatus: 'connecting' | 'connected' | 'reconnecting';
}

export const initialAgentState: AgentState = {
  summary: null, messages: [], streaming: null, fileList: [], contents: {}, error: null, loading: false,
  model: null, workspaceRoot: null, cwd: null, workspaceReady: false, workspaceMode: 'loading',
  connectionStatus: 'connecting',
  steerQueue: [],
  goal: null,
  thinking: true,
};

export const initialAgentClientState: AgentClientState = {
  sessions: {},
  model: null,
  workspaceRoot: null,
  connectionStatus: 'connecting',
};

export const emptyStreamingTurn = (): StreamingTurn => ({ text: '', thinking: '', steps: [], blocks: [] });

function appendStreamingText(blocks: AgentContentBlock[], delta: string): AgentContentBlock[] {
  const next = blocks.slice();
  const last = next[next.length - 1];
  if (last?.kind === 'text') next[next.length - 1] = { ...last, text: last.text + delta };
  else next.push({ kind: 'text', text: delta });
  return next;
}

function snapshotFiles(files: Array<{ file: FileNode; content: string }>) {
  const contents: Record<string, string> = {};
  const fileList = files.map(item => {
    const path = item.file.path || item.file.name;
    contents[path] = item.content;
    return item.file;
  });
  return { fileList, contents };
}

/** Pure SSE reducer: transport owns delivery, this module owns state transitions. */
export function reduceAgentEvent(state: AgentState, event: AgentEvent): Partial<AgentState> | null {
  switch (event.type) {
    case 'session_start':
      return { summary: event.session };
    case 'session_snapshot': {
      const { fileList, contents } = snapshotFiles(event.files);
      // During a dropped SSE connection the Pi loop continues on the server. Preserve the
      // local in-progress turn until a new delta or terminal event catches us up.
      const reconnecting = state.connectionStatus === 'reconnecting';
      return {
        summary: event.session,
        messages: event.messages,
        steerQueue: event.steers,
        goal: event.goal,
        thinking: event.thinking,
        streaming: reconnecting ? state.streaming : null,
        cwd: event.cwd,
        fileList,
        contents,
        error: null,
        loading: reconnecting ? state.loading : false,
        workspaceReady: true,
        workspaceMode: 'disk',
      };
    }
    case 'thinking_delta': {
      const streaming = state.streaming ?? emptyStreamingTurn();
      return { streaming: { ...streaming, thinking: streaming.thinking + event.delta }, loading: true };
    }
    case 'text_delta': {
      const streaming = state.streaming ?? emptyStreamingTurn();
      return { streaming: { ...streaming, text: streaming.text + event.delta, blocks: appendStreamingText(streaming.blocks, event.delta) }, loading: true };
    }
    case 'tool_start': {
      const streaming = state.streaming ?? emptyStreamingTurn();
      return {
        streaming: {
          ...streaming,
          steps: [...streaming.steps, event.step],
          blocks: [...streaming.blocks, { kind: 'step', step: streaming.steps.length }],
        },
        loading: true,
      };
    }
    case 'tool_update':
    case 'tool_end': {
      const streaming = state.streaming;
      if (!streaming) return null;
      const steps = streaming.steps.slice();
      const index = event.step.id ? steps.findIndex(step => step.id === event.step.id) : steps.length - 1;
      if (index >= 0) steps[index] = { ...steps[index], ...event.step };
      return { streaming: { ...streaming, steps } };
    }
    case 'file':
    case 'goal_report': {
      const path = event.file.path || event.file.name;
      return {
        fileList: [...state.fileList.filter(file => (file.path || file.name) !== path), event.file],
        contents: { ...state.contents, [path]: event.content },
      };
    }
    case 'file_rename': {
      const nextPath = event.file.path || event.file.name;
      const fileList = state.fileList.filter(file => {
        const path = file.path || file.name;
        return path !== event.path && path !== nextPath;
      });
      fileList.push(event.file);
      const contents = { ...state.contents, [nextPath]: event.content };
      delete contents[event.path];
      return { fileList, contents };
    }
    case 'file_delete': {
      const contents = { ...state.contents };
      delete contents[event.path];
      return { fileList: state.fileList.filter(file => (file.path || file.name) !== event.path), contents };
    }
    case 'workspace_snapshot': {
      const { fileList, contents } = snapshotFiles(event.files);
      return { cwd: event.cwd, fileList, contents, workspaceReady: true, workspaceMode: 'disk' };
    }
    case 'workspace_reset': {
      const { fileList, contents } = snapshotFiles(event.files);
      return {
        cwd: event.cwd, fileList, contents, messages: [], streaming: null,
        error: null, loading: false, workspaceReady: true, workspaceMode: 'disk',
      };
    }
    case 'steer_queued':
      return { steerQueue: [...state.steerQueue.filter(item => item.id !== event.item.id), event.item] };
    case 'steer_delivered':
      return {
        messages: [...state.messages, event.message],
        steerQueue: state.steerQueue.filter(item => item.id !== event.id),
      };
    case 'steer_cleared':
      return { steerQueue: [] };
    case 'goal_updated':
      // Slash goal commands (pause/resume/clear) can complete without producing an assistant
      // message. End the optimistic composer state here; a continuation will set loading again
      // as soon as its first streaming event arrives.
      return { goal: event.goal, loading: false, streaming: null };
    case 'thinking_updated':
      return { thinking: event.thinking };
    case 'turn_interrupted': {
      const messages = state.messages.slice();
      if (messages[messages.length - 1]?.role === 'user') messages.pop();
      return { messages, streaming: null, loading: false, steerQueue: [] };
    }
    case 'turn_replaced':
      return {
        messages: [...state.messages, event.message], streaming: emptyStreamingTurn(), loading: true,
        error: null, steerQueue: [],
      };
    case 'agent_end': {
      const message = event.message.blocks || !state.streaming
        ? event.message
        : { ...event.message, blocks: state.streaming.blocks };
      return { messages: [...state.messages, message], streaming: null, loading: false, steerQueue: [] };
    }
    case 'error':
      return { error: event.message, streaming: null, loading: false };
  }
}
