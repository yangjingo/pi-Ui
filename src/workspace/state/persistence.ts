import type { PersistedWorkspaceUi, WorkspaceTab } from './types';

const WORKSPACE_UI_KEY = 'pi.workspace.ui.v1:';

/** Whether this exact session workspace already has an explicit user navigation choice. */
export function hasWorkspaceUi(cwd: string): boolean {
  try {
    const raw = JSON.parse(window.localStorage.getItem(WORKSPACE_UI_KEY + cwd) || 'null');
    return !!raw && typeof raw === 'object';
  } catch {
    return false;
  }
}

export function readWorkspaceUi(cwd: string, available: Set<string>): PersistedWorkspaceUi {
  const fallback: PersistedWorkspaceUi = {
    activeTab: 'files', canvasTab: null, openTabs: [], closedFolders: [], wsOpen: false,
  };
  try {
    const raw = JSON.parse(window.localStorage.getItem(WORKSPACE_UI_KEY + cwd) || 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    const openTabs = Array.isArray(raw.openTabs)
      ? raw.openTabs.filter((path: unknown): path is string => typeof path === 'string' && available.has(path)).slice(0, 50)
      : [];
    const canvasTab = typeof raw.canvasTab === 'string' && openTabs.includes(raw.canvasTab) ? raw.canvasTab : null;
    // Older builds persisted `report`; trajectory detail now opens directly in Canvas.
    const requestedTab: WorkspaceTab = raw.activeTab === 'canvas' ? 'canvas' : 'files';
    return {
      activeTab: requestedTab === 'canvas' && !canvasTab ? 'files' : requestedTab,
      canvasTab,
      openTabs,
      closedFolders: Array.isArray(raw.closedFolders)
        ? raw.closedFolders.filter((path: unknown): path is string => typeof path === 'string').slice(0, 200)
        : [],
      // Always enter through the conversation. The workspace remains available from the
      // top-bar toggle, but a previously open drawer must not become the landing page.
      wsOpen: false,
    };
  } catch {
    return fallback;
  }
}

export function writeWorkspaceUi(cwd: string, value: PersistedWorkspaceUi) {
  try {
    window.localStorage.setItem(WORKSPACE_UI_KEY + cwd, JSON.stringify({ ...value, wsOpen: false }));
  }
  catch { /* storage can be disabled or full; UI state persistence is best-effort */ }
}
