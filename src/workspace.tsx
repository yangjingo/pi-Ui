// UI/UX layer — view-state context. Owns ONLY presentation state (which drawer is
// open, edit mode, active tab, workspace width, open tabs). Session data, messages,
// and files come from the Core via `agentClient` (useAgentState).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FileNode, Message, Session, SessionSummary } from '../core/types';
import { buildFileTree, findFileInSession, finalArtifact } from '../core/util';
import { agentClient, useAgentState } from './agentClient';

type Tab = 'files' | 'canvas' | 'report';
/** Which full-page view the main area shows. 'chat' = normal conversation + workspace;
 *  the others are first-class config pages (no modal/overlay). */
export type View = 'chat' | 'sessions' | 'model' | 'skill';
interface StepRef { mi: number; si: number; }
interface TurnRef { mi: number; }

export interface WorkspaceCtx {
  active: Session;
  sessions: SessionSummary[];
  activeId: string;
  activeTab: Tab;
  canvasTab: string | null;
  activeStep: StepRef | null;
  activeTurn: TurnRef | null;
  wsOpen: boolean;
  editing: boolean;
  search: string;
  view: View;
  flashMsg: number | null;
  error: string | null;
  loading: boolean;
  thinking: boolean;
  model: string | null;
  cwd: string | null;
  // actions
  sendMessage(text: string): void;
  newChat(): void;
  switchSession(id: string): void;
  renameSession(id: string, title: string): void;
  delSession(id: string): void;
  setSearch(v: string): void;
  setView(v: View): void;
  setWsOpen(b: boolean): void;
  setActiveTab(t: Tab): void;
  openInCanvas(name: string): void;
  closeCanvasTab(name: string): void;
  showStep(mi: number, si: number): void;
  toggleFolder(node: FileNode): void;
  toggleThinking(): void;
  openTurn(mi: number): void;
  navCanvas(dir: -1 | 1): void;
  enterEdit(): void;
  exitEdit(): void;
  saveEdit(): void;
  setEditBuffer(v: string): void;
  getFileContent(path?: string): string;
  locateFileSource(name: string): void;
  setFlashMsg(idx: number | null): void;
}

const Ctx = createContext<WorkspaceCtx | null>(null);
export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return v;
}

const editable = (f?: FileNode | null) => !!f && (f.type === 'md' || f.type === 'sheet' || f.type === 'html');

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const st = useAgentState();

  const [activeTab, setActiveTab] = useState<Tab>('files');
  const [canvasTab, setCanvasTab] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeStep, setActiveStep] = useState<StepRef | null>(null);
  const [activeTurn, setActiveTurn] = useState<TurnRef | null>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('chat');
  const [flashMsg, setFlashMsg] = useState<number | null>(null);
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [thinking, setThinkingState] = useState(false);

  const toggleThinking = useCallback(() => {
    setThinkingState(prev => {
      const next = !prev;
      void agentClient.setThinking(next);
      return next;
    });
  }, []);

  const bufferRef = useRef<string | null>(null);
  const originalRef = useRef<string | null>(null);
  // last finalized agent message index auto-opened in the Canvas (auto-open guard)
  const lastOpenedMiRef = useRef<number>(-1);

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
    : (st.summary ?? { id: 'session', title: '新对话', group: '今天', time: '刚刚', live: false });

  const messages = useMemo<Message[]>(() => {
    if (!st.streaming) return st.messages;
    const live: Message = {
      role: 'agent', status: 'running',
      intro: st.streaming.text || undefined,
      thinking: st.streaming.thinking || undefined,
      traj: st.streaming.steps,
    };
    return [...st.messages, live];
  }, [st.messages, st.streaming]);

  const active: Session = useMemo(() => ({
    id: summary.id, title: summary.title, group: summary.group, time: summary.time,
    live: !!st.loading, messages, files, openTabs,
  }), [summary, st.loading, messages, files, openTabs]);

  const getFileContent = useCallback((path?: string) => (path ? (st.contents[path] ?? '') : ''), [st.contents]);

  const locateFileSource = useCallback((name: string) => {
    const idx = active.messages.findIndex(m =>
      m.role === 'agent' &&
      ((m.artifacts || []).some(a => a.name === name) || (m.traj || []).some(s => s.file === name)));
    if (idx >= 0) setFlashMsg(idx);
  }, [active.messages]);

  const openInCanvas = useCallback((name: string) => {
    if (editing && canvasTab) {
      const cur = findFileInSession(active, canvasTab);
      if (cur?.path && bufferRef.current != null) void agentClient.saveFile(cur.path, bufferRef.current);
    }
    setEditing(false); bufferRef.current = null; originalRef.current = null;
    setWsOpen(true);
    setActiveStep(null);
    setActiveTurn(null);
    setOpenTabs(prev => prev.includes(name) ? prev : [...prev, name]);
    setCanvasTab(name);
    setActiveTab('canvas');
    locateFileSource(name);
  }, [editing, canvasTab, active, locateFileSource]);

  const closeCanvasTab = useCallback((name: string) => {
    setOpenTabs(prev => prev.filter(n => n !== name));
    setCanvasTab(cur => (cur === name ? (openTabs.filter(n => n !== name).slice(-1)[0] ?? null) : cur));
  }, [openTabs]);

  const showStep = useCallback((mi: number, si: number) => {
    setWsOpen(true);
    const msg = active.messages[mi];
    if (!msg?.traj) return;
    setActiveTurn(null);
    if (si === msg.traj.length - 1) {
      const fa = finalArtifact(active);
      if (fa) { openInCanvas(fa); return; }
    }
    setActiveStep({ mi, si });
    setCanvasTab(null);
    setActiveTab('canvas');
  }, [active, openInCanvas]);

  // Open the message-level execution report for an agent turn in the Canvas.
  const openTurn = useCallback((mi: number) => {
    setActiveTurn({ mi });
    setActiveStep(null);
    setCanvasTab(null);
    setWsOpen(true);
    setActiveTab('canvas');
  }, []);

  // Context-aware ← →: between agent turns, between steps of a turn, or between open files.
  const navCanvas = useCallback((dir: -1 | 1) => {
    if (activeTurn) {
      const agentIdx = active.messages
        .map((m, i) => (m.role === 'agent' ? i : -1)).filter(i => i >= 0);
      const cur = agentIdx.indexOf(activeTurn.mi);
      const next = cur + dir;
      if (next >= 0 && next < agentIdx.length) setActiveTurn({ mi: agentIdx[next] });
      return;
    }
    if (activeStep) {
      const traj = active.messages[activeStep.mi]?.traj ?? [];
      if (!traj.length) return;
      const si = Math.max(0, Math.min(traj.length - 1, activeStep.si + dir));
      setActiveStep({ mi: activeStep.mi, si });
      return;
    }
    if (openTabs.length > 1 && canvasTab) {
      const i = openTabs.indexOf(canvasTab);
      const next = (i + dir + openTabs.length) % openTabs.length;
      setCanvasTab(openTabs[next]);
    }
  }, [activeTurn, activeStep, active.messages, openTabs, canvasTab]);

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
    setEditing(true);
  }, [canvasTab, active, getFileContent]);

  const exitEdit = useCallback(() => { setEditing(false); bufferRef.current = null; originalRef.current = null; }, []);

  const saveEdit = useCallback(() => {
    if (!canvasTab) return;
    const f = findFileInSession(active, canvasTab);
    if (f?.path && bufferRef.current != null) void agentClient.saveFile(f.path, bufferRef.current);
    setEditing(false); bufferRef.current = null; originalRef.current = null;
  }, [canvasTab, active]);

  const setEditBuffer = useCallback((v: string) => { bufferRef.current = v; }, []);

  // Expand "@filename" references to the file's content so the agent actually receives
  // the referenced workspace file. ("/" skill bodies are already inlined by the composer.)
  const sendMessage = useCallback((text: string) => {
    const expanded = text.replace(/@([\w一-龥.\-]+)/g, (full, name: string) => {
      const f = findFileInSession(active, name);
      if (!f?.path) return full;
      const content = getFileContent(f.path);
      return content ? `\n\n（引用文件 ${name}）\n${content}\n` : full;
    });
    void agentClient.prompt(expanded);
  }, [active, getFileContent]);

  const newChat = useCallback(() => {
    void agentClient.newSession();
    setOpenTabs([]); setCanvasTab(null); setActiveStep(null); setActiveTurn(null); setActiveTab('files');
    setWsOpen(false); setTitleOverride(null); lastOpenedMiRef.current = -1;
  }, []);

  const switchSession = useCallback((_id: string) => { /* single live session */ }, []);
  const renameSession = useCallback((_id: string, title: string) => {
    if (title.trim()) setTitleOverride(title.trim());
  }, []);
  const delSession = useCallback((_id: string) => { /* single live session — no-op */ }, []);

  // Auto-open the most recent finalized agent turn's report in the Canvas — once per turn.
  useEffect(() => {
    const msgs = active.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'agent' && msgs[i].status === 'done') {
        if (i !== lastOpenedMiRef.current) {
          lastOpenedMiRef.current = i;
          setActiveTurn({ mi: i });
          setActiveStep(null);
          setWsOpen(true);
          setActiveTab('canvas');
        }
        break;
      }
    }
  }, [active.messages]);

  const value: WorkspaceCtx = {
    active,
    sessions: [summary],
    activeId: summary.id,
    activeTab, canvasTab, activeStep, activeTurn, wsOpen, editing, search, view, flashMsg,
    error: st.error, loading: !!st.loading, thinking, model: st.model, cwd: st.cwd,
    sendMessage, newChat, switchSession, renameSession, delSession,
    setSearch, setView, setWsOpen, setActiveTab,
    openInCanvas, closeCanvasTab, showStep, toggleFolder, toggleThinking,
    openTurn, navCanvas,
    enterEdit, exitEdit, saveEdit, setEditBuffer, getFileContent,
    locateFileSource, setFlashMsg,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
