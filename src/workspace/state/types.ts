import type { FileNode, IntentDraft, LongRunningGoal, Session, SessionSummary, SteerItem, WorkspaceChange } from '../../core/agent';

/** The right-side workspace has one home for artifacts and one for focused context.
 * Shared Agent Core settings belong to the model configuration Canvas. */
export type WorkspaceTab = 'files' | 'canvas';
export type View = 'chat' | 'sessions' | 'model' | 'skill';
export interface StepRef { mi: number; si: number; }
export interface TurnRef { mi: number; }

export interface WorkspaceCtx {
  active: Session;
  sessions: SessionSummary[];
  activeId: string | null;
  activeTab: WorkspaceTab;
  canvasTab: string | null;
  activeStep: StepRef | null;
  activeTurn: TurnRef | null;
  wsOpen: boolean;
  canvasFocused: boolean;
  editing: boolean;
  editDirty: boolean;
  editSaving: boolean;
  editSaveError: string | null;
  fileSelectionMode: boolean;
  selectedFilePaths: string[];
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
  intent: IntentDraft | null;
  thinking: boolean;
  model: string | null;
  workspaceRoot: string | null;
  cwd: string | null;
  /** Increments after the browser-owned Pi inheritance bootstrap completes. */
  piInheritanceRevision: number;
  hasUnreadCompletions: boolean;
  isSessionUnread(id: string): boolean;
  sendMessage(text: string): void;
  steerMessage(text: string): void;
  interruptWithSteer(text: string): void;
  newChat(): Promise<boolean>;
  switchSession(id: string): Promise<boolean>;
  renameSession(id: string, title: string): void;
  delSession(id: string): Promise<{ ok: boolean; error?: string }>;
  setSearch(v: string): void;
  setView(v: View): Promise<boolean>;
  setWsOpen(b: boolean): Promise<boolean>;
  setCanvasFocused(focused: boolean): void;
  setActiveTab(t: WorkspaceTab): Promise<boolean>;
  revealInFiles(path: string): Promise<boolean>;
  openInCanvas(name: string): Promise<boolean>;
  closeCanvasTab(name: string): Promise<boolean>;
  closeOtherCanvasTabs(name: string): Promise<boolean>;
  closeAllCanvasTabs(): Promise<boolean>;
  renameWorkspaceFile(path: string, nextName: string): Promise<{ ok: boolean; error?: string; path?: string }>;
  deleteWorkspaceFile(path: string): Promise<{ ok: boolean; error?: string }>;
  refreshWorkspaceFiles(): Promise<boolean>;
  setFileSelectionMode(on: boolean): void;
  setSelectedFilePaths(paths: string[]): void;
  toggleFileSelection(paths: string[]): void;
  clearFileSelection(): void;
  showStep(mi: number, si: number): Promise<boolean>;
  toggleFolder(node: FileNode): void;
  toggleThinking(): void;
  confirmIntent(replaceExisting?: boolean): Promise<{ ok: boolean; error?: string }>;
  dismissIntent(): Promise<{ ok: boolean; error?: string }>;
  openTurn(mi: number): Promise<boolean>;
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
