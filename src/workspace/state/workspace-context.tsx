// UI/UX layer — view-state context. Owns ONLY presentation state (which drawer is
// open, edit mode, active tab, workspace width, open tabs). Session data, messages,
// and files come from the Core via the `agentClient` external store.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { agentClient, initialAgentState, type FileNode, type Message, type Session, type SessionSummary } from '../../core/agent';
import { basename, buildFileTree, findFileInSession } from '../files/workspace';
import { isOfficeFile } from '../../harness/file';
import type { PendingAgentChange, StepRef, TurnRef, View, WorkspaceCtx, WorkspaceTab } from './types';
import { hasWorkspaceUi, readWorkspaceUi, writeWorkspaceUi } from './persistence';
import { workspaceChangeContext } from './pending-changes';
import { piInheritanceService } from '../pi-inheritance/service';

export type { View, WorkspaceCtx } from './types';

const Ctx = createContext<WorkspaceCtx | null>(null);
export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return v;
}

const editable = (f?: FileNode | null) => !!f && !isOfficeFile(f.name) && (f.type === 'md' || f.type === 'sheet' || f.type === 'html' || f.type === 'code' || f.type === 'json' || f.type === 'mermaid' || f.type === 'excalidraw');

function sessionIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/sessions\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function writeSessionLocation(id: string | null, replace = false) {
  const path = id ? `/sessions/${encodeURIComponent(id)}` : '/';
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
}

function seenRunsStorageKey(workspaceRoot: string | null): string {
  return `pi.session.seen-runs:${workspaceRoot || 'default'}`;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const clientState = useSyncExternalStore(
    agentClient.storeSubscribe,
    agentClient.getSnapshot,
    agentClient.getSnapshot,
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionIdFromLocation);
  const st = activeSessionId
    ? (clientState.sessions[activeSessionId] ?? {
        ...initialAgentState,
        model: clientState.model,
        workspaceRoot: clientState.workspaceRoot,
        connectionStatus: clientState.connectionStatus,
      })
    : {
        ...initialAgentState,
        model: clientState.model,
        workspaceRoot: clientState.workspaceRoot,
        connectionStatus: clientState.connectionStatus,
        workspaceMode: 'disk' as const,
      };
  const activeSessionHydrated = !!activeSessionId && clientState.sessions[activeSessionId]?.workspaceReady === true;

  const [activeTab, setActiveTabState] = useState<WorkspaceTab>('files');
  const [canvasTab, setCanvasTab] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeStep, setActiveStep] = useState<StepRef | null>(null);
  const [activeTurn, setActiveTurn] = useState<TurnRef | null>(null);
  const [wsOpen, setWsOpenState] = useState(false);
  const [canvasFocused, setCanvasFocusedState] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [fileSelectionMode, setFileSelectionModeState] = useState(false);
  const [selectedFilePaths, setSelectedFilePathsState] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [view, setViewState] = useState<View>('chat');
  const [flashMsg, setFlashMsg] = useState<number | null>(null);
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const thinking = st.thinking;
  const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>({});
  const composerKey = activeSessionId || 'welcome';
  const composerDraft = composerDrafts[composerKey] || '';
  const setComposerDraft = useCallback((text: string) => {
    setComposerDrafts(current => ({ ...current, [composerKey]: text }));
  }, [composerKey]);
  const [pendingAgentChanges, setPendingAgentChanges] = useState<PendingAgentChange[]>([]);
  const [sessions, setSessionsState] = useState<SessionSummary[]>([]);
  const [seenRuns, setSeenRuns] = useState<Record<string, number>>({});
  const [piInheritanceRevision, setPiInheritanceRevision] = useState(0);

  const persistSeenRuns = useCallback((next: Record<string, number>) => {
    setSeenRuns(next);
    try {
      window.localStorage.setItem(seenRunsStorageKey(clientState.workspaceRoot), JSON.stringify(next));
    } catch { /* UI acknowledgement remains in memory */ }
  }, [clientState.workspaceRoot]);

  const markSessionSeen = useCallback((session: SessionSummary | undefined) => {
    if (!session?.completedRunId || (seenRuns[session.id] || 0) >= session.completedRunId) return;
    persistSeenRuns({ ...seenRuns, [session.id]: session.completedRunId });
  }, [persistSeenRuns, seenRuns]);

  const isSessionUnread = useCallback((id: string) => {
    const session = sessions.find(item => item.id === id);
    return !!session?.completedRunId && (seenRuns[id] || 0) < session.completedRunId;
  }, [seenRuns, sessions]);

  const hasUnreadCompletions = sessions.some(session => isSessionUnread(session.id));

  useEffect(() => {
    const key = seenRunsStorageKey(clientState.workspaceRoot);
    const read = () => {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) || '{}');
        setSeenRuns(parsed && typeof parsed === 'object' ? parsed : {});
      } catch { setSeenRuns({}); }
    };
    read();
    const onStorage = (event: StorageEvent) => { if (event.key === key) read(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [clientState.workspaceRoot]);

  const refreshSessions = useCallback(async () => {
    const list = await agentClient.listSessions();
    if (Array.isArray(list)) setSessionsState(list);
  }, []);

  const toggleThinking = useCallback(() => {
    if (activeSessionId) void agentClient.setThinking(activeSessionId, !thinking);
  }, [activeSessionId, thinking]);

  const bufferRef = useRef<string | null>(null);
  const originalRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const pendingAgentChangesRef = useRef<PendingAgentChange[]>([]);
  const hydratedWorkspaceRef = useRef<string | null>(null);
  const skipWorkspacePersistRef = useRef(false);

  // Derive the active Session from the Core state + view state.
  const files = useMemo(() => {
    const tree = buildFileTree(st.fileList);
    const apply = (nodes: FileNode[]) => {
      for (const n of nodes) {
        if (n.type === 'folder') {
          n.open = !closedFolders.has(n.path || n.name);
          if (n.children) apply(n.children);
        }
      }
    };
    apply(tree);
    return tree;
  }, [st.fileList, closedFolders]);

  const summary: SessionSummary = titleOverride && st.summary
    ? { ...st.summary, title: titleOverride }
    : (st.summary ?? { id: '', title: '新对话', group: '今天', time: '刚刚', live: false, status: 'idle' });

  useEffect(() => {
    let active = true;
    void refreshSessions();
    void piInheritanceService.bootstrap().then(async () => {
      if (!active) return;
      setPiInheritanceRevision(revision => revision + 1);
      await refreshSessions();
    }).catch(() => undefined);
    return () => { active = false; };
  }, [refreshSessions]);

  useEffect(() => {
    if (!activeSessionId || activeSessionHydrated) return;
    let active = true;
    void agentClient.getSession(activeSessionId).then(result => {
      if (!result.ok && active) {
        setActiveSessionId(null);
        writeSessionLocation(null, true);
      }
    });
    return () => { active = false; };
  }, [activeSessionId, activeSessionHydrated]);

  useEffect(() => {
    const onPopState = () => {
      const id = sessionIdFromLocation();
      setActiveSessionId(id);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const messages = useMemo<Message[]>(() => {
    // prompt() sets streaming synchronously with loading, so the live agent placeholder
    // is injected in the same render frame — no blink, no placeholder–restore journey.
    if (!st.streaming) return st.messages;
    const live: Message = {
      role: 'agent', status: 'running',
      intro: st.streaming.text || undefined,
      thinking: st.streaming.thinking || undefined,
      traj: st.streaming.steps,
      blocks: st.streaming.blocks,
    };
    return [...st.messages, live];
  }, [st.messages, st.streaming]);

  const active: Session = useMemo(() => ({
    id: summary.id, title: summary.title, group: summary.group, time: summary.time,
    live: !!st.loading, messages, files, openTabs,
  }), [summary, st.loading, messages, files, openTabs]);

  useEffect(() => {
    setFileSelectionModeState(false);
    setSelectedFilePathsState([]);
  }, [activeSessionId]);

  useEffect(() => {
    const available = new Set(st.fileList.map(file => file.path || file.name));
    setSelectedFilePathsState(current => {
      const next = current.filter(path => available.has(path));
      return next.length === current.length ? current : next;
    });
  }, [st.fileList]);

  const setFileSelectionMode = useCallback((on: boolean) => {
    setFileSelectionModeState(on);
    if (!on) setSelectedFilePathsState([]);
  }, []);

  const setSelectedFilePaths = useCallback((paths: string[]) => {
    setSelectedFilePathsState([...new Set(paths.filter(Boolean))]);
  }, []);

  const toggleFileSelection = useCallback((paths: string[]) => {
    const normalized = [...new Set(paths.filter(Boolean))];
    setSelectedFilePathsState(current => {
      const next = new Set(current);
      const everySelected = normalized.every(path => next.has(path));
      for (const path of normalized) {
        if (everySelected) next.delete(path);
        else next.add(path);
      }
      return [...next];
    });
  }, []);

  const clearFileSelection = useCallback(() => setSelectedFilePathsState([]), []);

  const getFileContent = useCallback((path?: string) => (path ? (st.contents[path] ?? '') : ''), [st.contents]);
  const getEditBuffer = useCallback((path?: string) => bufferRef.current ?? getFileContent(path), [getFileContent]);

  const updatePendingAgentChanges = useCallback((update: (current: PendingAgentChange[]) => PendingAgentChange[]) => {
    setPendingAgentChanges(current => {
      const next = update(current);
      pendingAgentChangesRef.current = next;
      return next;
    });
  }, []);

  const queueCanvasEdit = useCallback((path: string, content: string) => {
    updatePendingAgentChanges(current => [
      ...current.filter(change => change.path !== path),
      { id: Date.now() + Math.random(), path, kind: 'edit', content },
    ]);
  }, [updatePendingAgentChanges]);

  const commitEdit = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false;
    const content = bufferRef.current;
    const f = canvasTab ? findFileInSession(active, canvasTab) : null;
    const path = content != null ? f?.path : undefined;
    if (content == null) return true;
    if (content === originalRef.current) {
      setEditing(false);
      setEditDirty(false);
      setEditSaveError(null);
      bufferRef.current = null;
      originalRef.current = null;
      return true;
    }
    if (!path) {
      setEditSaveError('当前文件已不可用，修改尚未保存');
      return false;
    }
    savingRef.current = true;
    setEditSaving(true);
    setEditSaveError(null);
    if (!activeSessionId) return false;
    const result = await agentClient.saveFile(activeSessionId, path, content);
    savingRef.current = false;
    setEditSaving(false);
    if (!result.ok) {
      setEditSaveError(result.error || '无法写入当前文件');
      return false;
    }
    setEditing(false);
    setEditDirty(false);
    bufferRef.current = null;
    originalRef.current = null;
    queueCanvasEdit(path, content);
    return true;
  }, [activeSessionId, canvasTab, active, queueCanvasEdit]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditDirty(false);
    setEditSaving(false);
    setEditSaveError(null);
    savingRef.current = false;
    bufferRef.current = null;
    originalRef.current = null;
  }, []);

  const restoreWorkspaceUi = useCallback((cwd: string, fileList: FileNode[], previewPath?: string) => {
    const available = new Set(fileList.map(file => file.path || file.name));
    const saved = readWorkspaceUi(cwd, available);
    // A user's saved Canvas choice always wins. For a session opened on this browser for the
    // first time, select its last generated artifact without turning the workspace into the
    // landing page.
    const shouldPreview = !!previewPath && available.has(previewPath) && !hasWorkspaceUi(cwd);
    const openTabs = shouldPreview ? [previewPath!] : saved.openTabs;
    const canvasTab = shouldPreview ? previewPath! : saved.canvasTab;
    skipWorkspacePersistRef.current = true;
    hydratedWorkspaceRef.current = cwd;
    setOpenTabs(openTabs);
    setCanvasTab(canvasTab);
    setActiveTabState(shouldPreview ? 'canvas' : saved.activeTab);
    setClosedFolders(new Set(saved.closedFolders));
    setWsOpenState(false);
    setCanvasFocusedState(false);
    setActiveStep(null);
    setActiveTurn(null);
  }, []);

  // Restore navigation only after the Core has supplied one complete disk snapshot. Health can
  // resolve earlier than SSE, so cwd alone is not sufficient evidence that file paths are ready.
  useEffect(() => {
    if (!st.workspaceReady || st.workspaceMode !== 'disk' || !st.cwd) return;
    if (hydratedWorkspaceRef.current === st.cwd) return;
    restoreWorkspaceUi(st.cwd, st.fileList);
  }, [st.workspaceReady, st.workspaceMode, st.cwd, st.fileList, restoreWorkspaceUi]);

  useEffect(() => {
    if (!st.workspaceReady || st.workspaceMode !== 'disk' || !st.cwd) return;
    if (hydratedWorkspaceRef.current !== st.cwd) return;
    if (skipWorkspacePersistRef.current) {
      skipWorkspacePersistRef.current = false;
      return;
    }
    writeWorkspaceUi(st.cwd, {
      activeTab, canvasTab, openTabs, closedFolders: [...closedFolders], wsOpen,
    });
  }, [st.workspaceReady, st.workspaceMode, st.cwd, activeTab, canvasTab, openTabs, closedFolders, wsOpen]);

  useEffect(() => {
    if (!editDirty && !editSaving) return;
    const guardUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guardUnload);
    return () => window.removeEventListener('beforeunload', guardUnload);
  }, [editDirty, editSaving]);

  // File lifecycle events are shared across every connected browser. Keep open tabs and the
  // active editor aligned when another window renames or removes a Workspace file.
  useEffect(() => agentClient.subscribe((event) => {
    if (event.type === 'session_start') {
      setSessionsState(current => [
        event.session,
        ...current.filter(session => session.id !== event.sessionId),
      ]);
      if (event.sessionId === activeSessionId && event.session.status === 'completed') {
        markSessionSeen(event.session);
      }
    }
    if (event.sessionId !== activeSessionId) return;
    if (event.type === 'session_snapshot') {
      cancelEdit();
      // A workspace switch replaces the entire session set, so re-fetch the list from Core
      // instead of keeping the previous workspace's conversations on screen.
      if (event.reason === 'cwd') void refreshSessions();
      const previewPath = event.reason === 'session'
        ? [...event.messages].reverse().find(message => message.role === 'agent' && message.artifacts?.length)
          ?.artifacts?.find(artifact => !!artifact.path)?.path
        : undefined;
      restoreWorkspaceUi(event.cwd, event.files.map(item => item.file), previewPath);
      updatePendingAgentChanges(() => []);
      setTitleOverride(null);
      return;
    }
    if (event.type === 'workspace_snapshot') {
      const files = event.files.map(item => item.file);
      if (hydratedWorkspaceRef.current !== event.cwd) {
        restoreWorkspaceUi(event.cwd, files);
        return;
      }
      const available = new Set(files.map(file => file.path || file.name));
      if (canvasTab && !available.has(canvasTab) && editing) cancelEdit();
      setOpenTabs(prev => prev.filter(path => available.has(path)));
      setCanvasTab(cur => cur && available.has(cur) ? cur : null);
      return;
    }
    if (event.type === 'workspace_reset') {
      cancelEdit();
      restoreWorkspaceUi(event.cwd, event.files.map(item => item.file));
      updatePendingAgentChanges(() => []);
      setTitleOverride(null);
      return;
    }
    if (event.type === 'goal_report') {
      const path = event.file.path || event.file.name;
      setOpenTabs(prev => prev.includes(path) ? prev : [...prev, path]);
      if (!editing) {
        setWsOpenState(true);
        setCanvasFocusedState(false);
        setActiveStep(null);
        setActiveTurn(null);
        setCanvasTab(path);
        setActiveTabState('canvas');
      }
      return;
    }
    if (event.type === 'file_rename') {
      const nextPath = event.file.path || event.file.name;
      setOpenTabs(prev => prev.map(tab => tab === event.path ? nextPath : tab));
      setCanvasTab(cur => cur === event.path ? nextPath : cur);
      updatePendingAgentChanges(current => current.map(change => change.path === event.path ? { ...change, path: nextPath } : change));
      return;
    }
    if (event.type !== 'file_delete') return;
    updatePendingAgentChanges(current => current.filter(change => change.path !== event.path));
    const wasActive = canvasTab === event.path;
    if (wasActive && editing) cancelEdit();
    setOpenTabs(prev => {
      const index = prev.indexOf(event.path);
      const remaining = prev.filter(tab => tab !== event.path);
      if (wasActive) {
        setCanvasTab(remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null);
      }
      return remaining;
    });
  }), [activeSessionId, canvasTab, editing, cancelEdit, restoreWorkspaceUi, updatePendingAgentChanges, refreshSessions, markSessionSeen]);

  const locateFileSource = useCallback((name: string) => {
    const leaf = basename(name);
    const idx = active.messages.findIndex(m =>
      m.role === 'agent' &&
      ((m.artifacts || []).some(a => a.name === name || a.name === leaf) ||
        (m.traj || []).some(s => s.file === name || (!!s.file && basename(s.file) === leaf))));
    if (idx >= 0) setFlashMsg(idx);
  }, [active.messages]);

  const openInCanvas = useCallback(async (name: string): Promise<boolean> => {
    if (editing && !(await commitEdit())) return false;
    const file = findFileInSession(active, name) || findFileInSession(active, basename(name));
    setWsOpenState(true);
    setCanvasFocusedState(false);
    if (!file) {
      setActiveStep(null);
      setActiveTurn(null);
      setActiveTabState('files');
      return false;
    }
    const key = file.path || file.name;
    setActiveStep(null);
    setActiveTurn(null);
    setOpenTabs(prev => prev.includes(key) ? prev : [...prev, key]);
    setCanvasTab(key);
    setActiveTabState('canvas');
    locateFileSource(key);
    return true;
  }, [active, editing, commitEdit, locateFileSource]);

  const closeCanvasTab = useCallback(async (name: string): Promise<boolean> => {
    if (editing && canvasTab === name && !(await commitEdit())) return false;
    const index = openTabs.indexOf(name);
    const remaining = openTabs.filter(n => n !== name);
    setOpenTabs(remaining);
    setCanvasTab(cur => cur === name
      ? (remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null)
      : cur);
    return true;
  }, [editing, canvasTab, commitEdit, openTabs]);

  const closeOtherCanvasTabs = useCallback(async (name: string): Promise<boolean> => {
    if (editing && canvasTab !== name && !(await commitEdit())) return false;
    setOpenTabs([name]);
    setCanvasTab(name);
    setActiveStep(null);
    setActiveTurn(null);
    return true;
  }, [editing, canvasTab, commitEdit]);

  const closeAllCanvasTabs = useCallback(async (): Promise<boolean> => {
    if (editing && !(await commitEdit())) return false;
    setOpenTabs([]);
    setCanvasTab(null);
    setActiveStep(null);
    setActiveTurn(null);
    return true;
  }, [editing, commitEdit]);

  const renameWorkspaceFile = useCallback(async (path: string, nextName: string) => {
    const name = nextName.trim();
    if (!name || name === '.' || name === '..' || /[\u0000-\u001f<>:"/\\|?*]/.test(name) || /[. ]$/.test(name)) {
      return { ok: false, error: '文件名不能包含 \\ / : * ? " < > |，也不能以空格或句点结尾' };
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
      return { ok: false, error: '该名称是系统保留名称，请换一个文件名' };
    }
    if (editing && canvasTab === path && !(await commitEdit())) {
      return { ok: false, error: '当前修改尚未保存，已取消重命名' };
    }
    const slash = path.replace(/\\/g, '/').lastIndexOf('/');
    const nextPath = slash >= 0 ? path.slice(0, slash + 1) + name : name;
    if (nextPath === path) return { ok: true, path };
    if (!activeSessionId) return { ok: false, error: '请先创建 Session' };
    const result = await agentClient.renameFile(activeSessionId, path, nextPath);
    if (!result.ok) return result;
    const resolved = result.path || nextPath;
    setOpenTabs(prev => prev.map(tab => tab === path ? resolved : tab));
    setCanvasTab(cur => cur === path ? resolved : cur);
    setSelectedFilePathsState(current => current.map(item => item === path ? resolved : item));
    return { ok: true, path: resolved };
  }, [activeSessionId, editing, canvasTab, commitEdit]);

  const deleteWorkspaceFile = useCallback(async (path: string) => {
    if (editing && canvasTab === path) cancelEdit();
    const index = openTabs.indexOf(path);
    if (!activeSessionId) return { ok: false, error: '请先创建 Session' };
    const result = await agentClient.deleteFile(activeSessionId, path);
    if (!result.ok) return result;
    const remaining = openTabs.filter(tab => tab !== path);
    setSelectedFilePathsState(current => current.filter(item => item !== path));
    setOpenTabs(remaining);
    setCanvasTab(cur => cur === path
      ? (remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null)
      : cur);
    return { ok: true };
  }, [activeSessionId, editing, canvasTab, cancelEdit, openTabs]);

  const refreshWorkspaceFiles = useCallback(async (): Promise<boolean> => {
    if (!activeSessionId) return false;
    const result = await agentClient.getSession(activeSessionId);
    return result.ok;
  }, [activeSessionId]);

  const showStep = useCallback(async (mi: number, si: number): Promise<boolean> => {
    if (editing && !(await commitEdit())) return false;
    setWsOpenState(true);
    setCanvasFocusedState(false);
    const msg = active.messages[mi];
    if (!msg?.traj) return false;
    setActiveTurn(null);
    setActiveStep({ mi, si });
    setCanvasTab(null);
    setActiveTabState('canvas');
    return true;
  }, [active, editing, commitEdit]);

  // Open the message-level execution report for an agent turn in the Canvas.
  const openTurn = useCallback(async (mi: number): Promise<boolean> => {
    if (editing && !(await commitEdit())) return false;
    setActiveTurn({ mi });
    setActiveStep(null);
    setCanvasTab(null);
    setWsOpenState(true);
    setCanvasFocusedState(false);
    setActiveTabState('canvas');
    return true;
  }, [editing, commitEdit]);

  const setActiveTab = useCallback(async (tab: WorkspaceTab): Promise<boolean> => {
    if (tab !== activeTab && editing && !(await commitEdit())) return false;
    setActiveTabState(tab);
    setCanvasFocusedState(false);
    return true;
  }, [activeTab, editing, commitEdit]);

  const setView = useCallback(async (nextView: View): Promise<boolean> => {
    if (nextView === view) return true;
    if (editing && !(await commitEdit())) return false;
    setViewState(nextView);
    return true;
  }, [view, editing, commitEdit]);

  const setWsOpen = useCallback(async (open: boolean): Promise<boolean> => {
    if (open === wsOpen) return true;
    if (!open && editing && !(await commitEdit())) return false;
    setWsOpenState(open);
    if (!open) setCanvasFocusedState(false);
    return true;
  }, [wsOpen, editing, commitEdit]);

  const revealInFiles = useCallback(async (path: string): Promise<boolean> => {
    if (editing && !(await commitEdit())) return false;
    const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = normalized.split('/').filter(Boolean);
    const parents = new Set(parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/')));
    setClosedFolders(prev => {
      const next = new Set([...prev].filter(folder => !parents.has(folder.replace(/\\/g, '/'))));
      return next.size === prev.size ? prev : next;
    });
    setActiveStep(null);
    setActiveTurn(null);
    setWsOpenState(true);
    setCanvasFocusedState(false);
    setActiveTabState('files');
    return true;
  }, [editing, commitEdit]);

  const toggleFolder = useCallback((node: FileNode) => {
    const key = node.path || node.name;
    setClosedFolders(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const enterEdit = useCallback(() => {
    if (!canvasTab) return;
    const f = findFileInSession(active, canvasTab);
    if (!editable(f)) return;
    const text = f?.path ? getFileContent(f.path) : '';
    originalRef.current = text;
    bufferRef.current = text;
    setEditDirty(false);
    setEditSaveError(null);
    setEditing(true);
  }, [canvasTab, active, getFileContent]);

  const exitEdit = cancelEdit;

  const saveEdit = commitEdit;

  const setEditBuffer = useCallback((v: string) => {
    bufferRef.current = v;
    setEditSaveError(null);
    setEditDirty(v !== (originalRef.current ?? ''));
  }, []);

  // Expand "@filename" references to the file's content so the agent actually receives
  // the referenced workspace file.
  const prepareAgentMessage = useCallback((text: string) => {
    const expanded = text.replace(/@(?:"([^"]+)"|([\w一-龥.\/\\-]+))/g, (full, quoted: string | undefined, bare: string | undefined) => {
      const name = quoted || bare || '';
      const f = findFileInSession(active, name);
      if (!f?.path) return full;
      const content = getFileContent(f.path);
      return content ? `\n\n（引用文件 ${name}）\n${content}\n` : full;
    });
    const changes = pendingAgentChangesRef.current;
    const modelInput = expanded + workspaceChangeContext(changes);
    const references = changes.map(({ path, kind }) => ({ path, kind }));
    return { modelInput, references, sentIds: new Set(changes.map(change => change.id)) };
  }, [active, getFileContent]);

  const clearSentChanges = useCallback((sentIds: Set<number>) => {
    if (sentIds.size) updatePendingAgentChanges(current => current.filter(change => !sentIds.has(change.id)));
  }, [updatePendingAgentChanges]);

  const sendMessage = useCallback((text: string) => {
    const { modelInput, references, sentIds } = prepareAgentMessage(text);
    void (async () => {
      let sessionId = activeSessionId;
      let createdSession = false;
      if (!sessionId) {
        const created = await agentClient.newSession();
        if (!created.ok || !created.session) return;
        sessionId = created.session.id;
        createdSession = true;
        setActiveSessionId(sessionId);
        writeSessionLocation(sessionId);
      }
      const accepted = await agentClient.prompt(sessionId, modelInput, text, references);
      if (accepted) clearSentChanges(sentIds);
      if (createdSession) void refreshSessions();
    })();
  }, [activeSessionId, prepareAgentMessage, clearSentChanges, refreshSessions]);

  const steerMessage = useCallback((text: string) => {
    if (!activeSessionId) return;
    const { modelInput, references, sentIds } = prepareAgentMessage(text);
    void agentClient.steer(activeSessionId, modelInput, text, references).then(accepted => {
      if (accepted) clearSentChanges(sentIds);
    });
  }, [activeSessionId, prepareAgentMessage, clearSentChanges]);

  const interruptWithSteer = useCallback((text: string) => {
    if (!activeSessionId) return;
    const { modelInput, references, sentIds } = prepareAgentMessage(text);
    void agentClient.interruptAndSteer(activeSessionId, modelInput, text, references).then(accepted => {
      if (accepted) clearSentChanges(sentIds);
    });
  }, [activeSessionId, prepareAgentMessage, clearSentChanges]);

  const confirmIntent = useCallback(async (replaceExisting = false) => {
    const intent = st.intent;
    if (!activeSessionId || !intent?.contractHash) return { ok: false, error: '没有可确认的 Goal Contract' };
    return agentClient.confirmIntent(activeSessionId, {
      intentId: intent.intentId,
      revision: intent.revision,
      contractHash: intent.contractHash,
      replaceExisting,
    });
  }, [activeSessionId, st.intent]);

  const dismissIntent = useCallback(async () => {
    const intent = st.intent;
    if (!activeSessionId || !intent) return { ok: false, error: '没有可取消的 Goal Contract' };
    return agentClient.dismissIntent(activeSessionId, intent.intentId);
  }, [activeSessionId, st.intent]);

  const newChat = useCallback(async (): Promise<boolean> => {
    if (editing && !(await commitEdit())) return false;
    const result = await agentClient.newSession();
    if (!result.ok || !result.session) return false;
    setActiveSessionId(result.session.id);
    writeSessionLocation(result.session.id);
    await refreshSessions();
    setTitleOverride(null);
    setComposerDraft('');
    setViewState('chat');
    return true;
  }, [editing, commitEdit, refreshSessions, setComposerDraft]);

  const switchSession = useCallback(async (id: string): Promise<boolean> => {
    if (editing && !(await commitEdit())) return false;
    const result = await agentClient.getSession(id);
    if (!result.ok) return false;
    setActiveSessionId(id);
    writeSessionLocation(id);
    markSessionSeen(sessions.find(session => session.id === id));
    void refreshSessions();
    setTitleOverride(null);
    setViewState('chat');
    return true;
  }, [editing, commitEdit, refreshSessions, markSessionSeen, sessions]);
  const renameSession = useCallback((_id: string, title: string) => {
    if (title.trim()) setTitleOverride(title.trim());
  }, []);
  const delSession = useCallback(async (id: string): Promise<{ ok: boolean; error?: string }> => {
    const result = await agentClient.deleteSession(id);
    if (!result.ok) return result;

    const list = await agentClient.listSessions();
    setSessionsState(list);
    setComposerDrafts(current => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (id in seenRuns) {
      const nextSeen = { ...seenRuns };
      delete nextSeen[id];
      persistSeenRuns(nextSeen);
    }

    if (activeSessionId === id) {
      cancelEdit();
      setTitleOverride(null);
      setCanvasTab(null);
      setOpenTabs([]);
      setActiveStep(null);
      setActiveTurn(null);
      setPendingAgentChanges([]);
      pendingAgentChangesRef.current = [];
      hydratedWorkspaceRef.current = null;

      const next = list[0];
      if (next) {
        const opened = await agentClient.getSession(next.id);
        if (opened.ok) {
          setActiveSessionId(next.id);
          writeSessionLocation(next.id, true);
        } else {
          setActiveSessionId(null);
          writeSessionLocation(null, true);
        }
      } else {
        setActiveSessionId(null);
        writeSessionLocation(null, true);
      }
    }
    return { ok: true };
  }, [activeSessionId, cancelEdit, persistSeenRuns, seenRuns]);

  const value: WorkspaceCtx = {
    active,
    sessions,
    activeId: activeSessionId,
    activeTab, canvasTab, activeStep, activeTurn, wsOpen, canvasFocused, editing, editDirty, editSaving, editSaveError, fileSelectionMode, selectedFilePaths, search, view, flashMsg, composerDraft, pendingAgentChanges,
    error: st.error, loading: !!st.loading, connectionStatus: clientState.connectionStatus, steerQueue: st.steerQueue, goal: st.goal, intent: st.intent, thinking, model: clientState.model, workspaceRoot: clientState.workspaceRoot, cwd: st.cwd, piInheritanceRevision,
    hasUnreadCompletions, isSessionUnread,
    sendMessage, steerMessage, interruptWithSteer, newChat, switchSession, renameSession, delSession,
    setSearch, setView, setWsOpen, setCanvasFocused: setCanvasFocusedState, setActiveTab, revealInFiles,
    openInCanvas, closeCanvasTab, closeOtherCanvasTabs, closeAllCanvasTabs,
    renameWorkspaceFile, deleteWorkspaceFile, refreshWorkspaceFiles, showStep, toggleFolder, toggleThinking, confirmIntent, dismissIntent,
    setFileSelectionMode, setSelectedFilePaths, toggleFileSelection, clearFileSelection,
    openTurn,
    enterEdit, exitEdit, saveEdit, setEditBuffer, getEditBuffer, getFileContent,
    locateFileSource, setFlashMsg, setComposerDraft,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
