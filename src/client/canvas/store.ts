/**
 * AIDA Canvas store: the shared viewing state of the details-column panel and
 * the turn-tail chips. Created once in apply and handed to the three
 * session-scoped registrations, so opening a produced file from the chat tail
 * lands in the column. Editing buffers and fetched contents stay
 * component-local; the store carries only navigation state and the edit dirty
 * flag (plain JSON data, per the client stack rules). Column open/close is the
 * frame's details-track state (`ctx.layout`), not this store's.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { AidaCanvasActions, AidaCanvasState } from './contract.ts'

/** Empty canvas state (the panel resets to it on session switch). */
export const EMPTY_CANVAS_STATE: AidaCanvasState = {
  maximized: false,
  tab: 'files',
  openTabs: [],
  activePath: null,
  editPath: null,
  editDirty: false,
  selected: [],
  selectionAnchor: null,
}

/**
 * Declares the per-session AIDA canvas state and write surface.
 * @returns the store handle shared by the details column, the header toggle, and the turn-tail chips.
 */
export function createAidaCanvasStore(): EngineStoreHandle<AidaCanvasState, AidaCanvasActions> {
  return defineStore({
    init: (): AidaCanvasState => ({ ...EMPTY_CANVAS_STATE }),
    persist: 'dsh.aida.canvas',
    actions: {
      setMaximized: (draft, maximized) => { draft.maximized = maximized },
      setTab: (draft, tab) => { draft.tab = tab },
      openFile: (draft, path) => {
        if (!draft.openTabs.includes(path)) draft.openTabs = [...draft.openTabs, path]
        draft.activePath = path
        draft.tab = 'canvas'
        draft.editPath = null
        draft.editDirty = false
      },
      closeTab: (draft, path) => {
        const index = draft.openTabs.indexOf(path)
        const remaining = draft.openTabs.filter(tab => tab !== path)
        draft.openTabs = remaining
        if (draft.activePath === path) {
          draft.activePath = remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null
        }
        if (draft.editPath === path) {
          draft.editPath = null
          draft.editDirty = false
        }
      },
      closeAllTabs: (draft) => {
        draft.openTabs = []
        draft.activePath = null
        draft.editPath = null
        draft.editDirty = false
      },
      setEditing: (draft, path, dirty) => {
        draft.editPath = path
        draft.editDirty = dirty
      },
      renameTab: (draft, from, to) => {
        draft.openTabs = draft.openTabs.map(tab => tab === from ? to : tab)
        if (draft.activePath === from) draft.activePath = to
        if (draft.editPath === from) draft.editPath = to
      },
      toggleSelected: (draft, path) => {
        const selected = Array.isArray(draft.selected) ? draft.selected : []
        draft.selected = selected.includes(path)
          ? selected.filter(selectedPath => selectedPath !== path)
          : [...selected, path]
        draft.selectionAnchor = path
      },
      selectRange: (draft, anchor, target, order) => {
        const end = order.indexOf(target)
        if (end === -1) {
          draft.selected = []
          draft.selectionAnchor = null
          return
        }
        const start = anchor === null ? -1 : order.indexOf(anchor)
        const [from, to] = start === -1 ? [end, end] : [Math.min(start, end), Math.max(start, end)]
        draft.selected = order.slice(from, to + 1)
        draft.selectionAnchor = target
      },
      clearSelection: (draft) => {
        draft.selected = []
        draft.selectionAnchor = null
      },
      reset: (draft) => {
        draft.maximized = EMPTY_CANVAS_STATE.maximized
        draft.tab = EMPTY_CANVAS_STATE.tab
        draft.openTabs = []
        draft.activePath = null
        draft.editPath = null
        draft.editDirty = false
        draft.selected = []
        draft.selectionAnchor = null
      },
    },
  })
}
