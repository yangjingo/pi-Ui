import type { FileNode, LongRunningGoal, Session, SessionSummary, SteerItem, WorkspaceChange } from '../../core/agent';

/** The right-side workspace has one home for artifacts and one for focused context.
 * Shared Agent Core settings belong to the model configuration Canvas. */
export type WorkspaceTab = 'files' | 'canvas';
export type View = 'chat' | 'sessions' | 'model' | 'skill';
export interface StepRef { mi: number; si: number; }
export interface TurnRef { mi: number; }

export interface WorkspaceCtx {
  active: Session;
  sessions: SessionSummary[];
  activeId: string;
  activeTab: WorkspaceTab;
  canvasTab: string | null;
  activeStep: StepRef | null;
  activeTurn: TurnRef | null;
  wsOpen: boolean;
  editing: boolean;
  editDirty: boolean;
  editSaving: boolean;
  editSaveError: string | null;
  search: string;
  view: View;
  flashMsg: number | null;
  composerDraft: string;
  pendingAgentChanges: WorkspaceChange[];
  error: string | null;
  loading: boolean;
  connectionStatus: 'connecting' | 'connected' | 'reconnecting';
  steerQueue: SteerItem[];
  goal: LongRunningGoal | null;
  thinking: boolean;
  model: string | null;
  workspaceRoot: string | null;
  cwd: string | null;
  /** Increments after the browser-owned Pi inheritance bootstrap completes. */
  piInheritanceRevision: number;
  sendMessage(text: string): void;
  steerMessage(text: string): void;
  interruptWithSteer(text: string): void;
  newChat(): Promise<boolean>;
  switchSession(id: string): Promise<boolean>;
  renameSession(id: string, title: string): void;
  delSession(id: string): Promise<boolean>;
  setSearch(v: string): void;
  setView(v: View): Promise<boolean>;
  setWsOpen(b: boolean): Promise<boolean>;
  setActiveTab(t: WorkspaceTab): Promise<boolean>;
  revealInFiles(path: string): Promise<boolean>;
  openInCanvas(name: string): Promise<boolean>;
  closeCanvasTab(name: string): Promise<boolean>;
  closeOtherCanvasTabs(name: string): Promise<boolean>;
  closeAllCanvasTabs(): Promise<boolean>;
  renameWorkspaceFile(path: string, nextName: string): Promise<{ ok: boolean; error?: string; path?: string }>;
  deleteWorkspaceFile(path: string): Promise<{ ok: boolean; error?: string }>;
  showStep(mi: number, si: number): Promise<boolean>;
  toggleFolder(node: FileNode): void;
  toggleThinking(): void;
  openTurn(mi: number): Promise<boolean>;
  navCanvas(dir: -1 | 1): void;
  enterEdit(): void;
  exitEdit(): void;
  saveEdit(): Promise<boolean>;
  setEditBuffer(v: string): void;
  getEditBuffer(path?: string): string;
  getFileContent(path?: string): string;
  locateFileSource(name: string): void;
  setFlashMsg(idx: number | null): void;
  setComposerDraft(text: string): void;
}

export interface PersistedWorkspaceUi {
  activeTab: WorkspaceTab;
  canvasTab: string | null;
  openTabs: string[];
  closedFolders: string[];
  wsOpen: boolean;
}

export interface PendingAgentChange extends WorkspaceChange {
  id: number;
  content: string;
}
