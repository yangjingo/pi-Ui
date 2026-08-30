/**
 * AIDA Canvas contract: the shared store shape and the injected face. The
 * canvas is AIDA's right-hand column (the frame's `details` track), so every
 * cross-domain read here goes through the framework session kit (the slot is
 * session-scoped) or the injected workspace-file callbacks.
 */

import type {
  WorkspaceFileListing,
  WorkspaceFileRead,
  WorkspaceFileWrite,
} from '../../workspace-protocol.ts'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ComponentType } from 'react'

/** One workspace panel tab. */
export type AidaCanvasTab = 'files' | 'canvas' | 'trajectory'

/** Per-session canvas viewing state, shared by the details column and the turn-tail chips. */
export interface AidaCanvasState {
  /** Whether the canvas is maximized to cover the whole conversation area. */
  maximized: boolean
  /** Active workspace tab inside the column. */
  tab: AidaCanvasTab
  /** Open canvas file tabs (relative POSIX paths, first-seen order). */
  openTabs: string[]
  /** Active file in the canvas tab. */
  activePath: string | null
  /** Path being edited in the canvas text area; null = read-only preview. */
  editPath: string | null
  /** Whether the edit buffer diverges from the saved content. */
  editDirty: boolean
  /** Paths of tree rows selected for batch actions (multi-select, file leaves only). */
  selected: string[]
  /** The anchor row of the last selection action (shift+click range start). */
  selectionAnchor: string | null
}

/** Declared action surface of the AIDA canvas store. */
export type AidaCanvasActions = {
  setMaximized: (draft: AidaCanvasState, maximized: boolean) => void
  setTab: (draft: AidaCanvasState, tab: AidaCanvasTab) => void
  openFile: (draft: AidaCanvasState, path: string) => void
  closeTab: (draft: AidaCanvasState, path: string) => void
  closeAllTabs: (draft: AidaCanvasState) => void
  setEditing: (draft: AidaCanvasState, path: string | null, dirty: boolean) => void
  renameTab: (draft: AidaCanvasState, from: string, to: string) => void
  toggleSelected: (draft: AidaCanvasState, path: string) => void
  selectRange: (draft: AidaCanvasState, anchor: string | null, target: string, order: readonly string[]) => void
  clearSelection: (draft: AidaCanvasState) => void
  reset: (draft: AidaCanvasState) => void
}

/** The workspace-file verbs the canvas needs, bound to ctx.workspaces in apply. */
export interface AidaCanvasFileOps {
  listFiles: (root: string, signal?: AbortSignal) => Promise<WorkspaceFileListing>
  readFile: (
    root: string,
    path: string,
    opts?: { offset?: number; maxBytes?: number },
    signal?: AbortSignal,
  ) => Promise<WorkspaceFileRead>
  writeFile: (
    root: string,
    path: string,
    input: { content?: string; base64?: string },
    signal?: AbortSignal,
  ) => Promise<WorkspaceFileWrite>
  renameFile: (root: string, path: string, nextName: string, signal?: AbortSignal) => Promise<WorkspaceFileWrite>
  moveFile: (root: string, path: string, targetPath: string, signal?: AbortSignal) => Promise<WorkspaceFileWrite>
  deleteFile: (root: string, path: string, signal?: AbortSignal) => Promise<WorkspaceFileWrite>
}

/** Injected face of the details-column registration: file verbs + column close. */
export interface AidaCanvasInjected extends AidaCanvasFileOps {
  /** Trajectory view contributed through DSH's public conversation.view slot. */
  trajectoryView: ComponentType<Record<string, unknown>>
  /** DSH TrajectoryView's original duration store, exposed as useTrajectoryDuration. */
  hooks: { trajectoryDuration: SnapshotStore<boolean> }
  /** DSH TrajectoryView's original history paging callback. */
  loadTrajectoryOlder: () => Promise<boolean>
  /** DSH TrajectoryView's original duration-mode setter. */
  setTrajectoryActualDuration: (actualDuration: boolean) => void
  /** DSH TrajectoryView's own locale binding. */
  trajectoryT: (key: string) => string
  /** Start the framework-owned Session log download flow for this session. */
  downloadSessionLog: () => Promise<void>
  /**
   * Close the right-hand column (the frame's details track).
   */
  closeCanvas: () => void
  /**
   * Insert a workspace-file mention chip (`@path`) at the end of the current
   * session's composer draft; the chip embeds the file content on submit.
   * @param path - POSIX-relative path within the session's workspace root.
   * @returns whether the input machine accepted the chip.
   */
  mentionFile(path: string): boolean
  /**
   * Inject a quoted selection (labeled with its source path) into the current
   * session's composer draft as literal text.
   * @param path - POSIX-relative source path of the selection.
   * @param text - the selected text, quoted verbatim.
   * @returns whether the draft accepted the write.
   */
  quoteSelection(path: string, text: string): boolean
}
