/**
 * AIDA Canvas column: the right-hand details track of the frame, rendered
 * side-by-side with the conversation (the frame reflows the center column —
 * no floating layer). Three tabs — Files (workspace tree + search + import +
 * rename/delete), Canvas (open file tabs with preview and editing), and
 * Trajectory (the original DSH TrajectoryView, relocated without a fork).
 * All workspace file transport arrives through the injected
 * ctx.workspaces verbs; the session's conversation facts arrive through the
 * standard `useSession` kit (the slot is session-scoped).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import Ellipsis from 'lucide-react/dist/esm/icons/ellipsis.mjs'
import Download from 'lucide-react/dist/esm/icons/download.mjs'
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2.mjs'
import Minimize2 from 'lucide-react/dist/esm/icons/minimize-2.mjs'
import Search from 'lucide-react/dist/esm/icons/search.mjs'
import X from 'lucide-react/dist/esm/icons/x.mjs'
import Eye from 'lucide-react/dist/esm/icons/eye.mjs'
import FileUp from 'lucide-react/dist/esm/icons/file-up.mjs'
import FolderUp from 'lucide-react/dist/esm/icons/folder-up.mjs'
import PencilLine from 'lucide-react/dist/esm/icons/pencil-line.mjs'
import Quote from 'lucide-react/dist/esm/icons/quote.mjs'
import type { WorkspaceFileListing, WorkspaceFileNode, WorkspaceFileRead } from '../../workspace-protocol.ts'
import { NS } from '../locales.ts'
import type { AidaCanvasInjected } from './contract.ts'
import { createAidaCanvasStore } from './store.ts'
import { basename, bytesToBase64, base64ToText, countFiles, filterFileTree, isSourceEditable, listFiles as flattenTree, textToBase64, visiblePathsOf } from './files.ts'
import { FileTree, keepTreeRovingFocus, navigateFileTree, FILE_DRAG_TYPE } from './FileTree.tsx'
import { FilePreview } from './preview.tsx'
import { formatOf, isSvgName } from './formats.ts'
import css from './canvas.module.css'

/** Full composed props of the details-column registration. */
export type AidaCanvasPanelProps =
  & PropsRuntime<'details'>
  & PropsStore<ReturnType<typeof createAidaCanvasStore>>
  & InjectFace<AidaCanvasInjected>
  & PropsLocale<typeof NS>

/** Max bytes fetched for one text preview (mirrors the host text read cap). */
const PREVIEW_MAX_BYTES = 512 * 1024

/** Imported names kept as UTF-8 text; everything else uploads as base64 binary. */
const TEXT_EXTENSION_PATTERN = /\.(md|markdown|txt|log|csv|tsv|json|html?|xml|ya?ml|toml|ini|cfg|conf|py|js|m?js|cjs|ts|mts|cts|jsx|tsx|sh|bash|css|scss|less|java|kt|go|rs|rb|php|sql|swift|dart|vue|svelte)$/i

/** Extract the follow-along file paths of a settled tool call (mutation cards only). */
export function producedPathsOf(node: ToolResultNode): readonly string[] {
  const paths: string[] = []
  const add = (candidate?: string): void => {
    if (candidate !== undefined && !paths.includes(candidate)) paths.push(candidate)
  }
  const callView = node.callView
  if (callView !== null && (callView.card === 'generic' || callView.card === 'diff')) {
    for (const location of callView.locations ?? []) add(location.path)
  }
  const resultView = node.resultView
  if (resultView !== null) {
    if (resultView.card === 'diff') {
      for (const diff of resultView.diffs) add(diff.path)
    } else if (resultView.card === 'read') {
      add(resultView.path)
    }
  }
  return paths
}

/** The frame ancestor: the element carrying the inline grid-track style. */
function frameOf(panel: HTMLElement | null): HTMLElement | null {
  let frame = panel?.parentElement ?? null
  while (frame !== null && frame.style.gridTemplateColumns === '') frame = frame.parentElement
  return frame
}

/**
 * Toggle the frame's maximized grid override. Maximized rewrites the grid to
 * `<sidebar> 0 <rest>` (the center track collapses to zero and the details
 * track — the canvas — spans the rest); the override rides a data attribute +
 * CSS variable, so AppFrame's own inline grid keeps tracking drags/resizes
 * underneath and restore is instant.
 * @param panel - the canvas section (frame lookup anchor).
 * @param maximized - whether to apply or clear the override.
 */
export function applyMaximizedGrid(panel: HTMLElement | null, maximized: boolean): void {
  const frame = frameOf(panel)
  if (frame === null) return
  if (!maximized) {
    delete frame.dataset.aidaCanvasMaximized
    const first = frame.children[0] as HTMLElement | undefined
    const sidebar = first === undefined ? 280 : Math.round(first.getBoundingClientRect().width)
    const rest = Math.max(0, Math.round(frame.getBoundingClientRect().width) - sidebar)
    const center = Math.floor(rest / 2)
    frame.dataset.aidaCanvasBalanced = 'true'
    frame.style.setProperty('--aida-canvas-cols', `${sidebar}px ${center}px ${rest - center}px`)
    return
  }
  delete frame.dataset.aidaCanvasBalanced
  const first = frame.children[0] as HTMLElement | undefined
  const sidebar = first === undefined ? 280 : Math.round(first.getBoundingClientRect().width)
  const rest = Math.round(frame.getBoundingClientRect().width) - sidebar
  frame.dataset.aidaCanvasMaximized = 'true'
  frame.style.setProperty('--aida-canvas-cols', `${sidebar}px 0px ${rest}px`)
}

/** Render the Canvas column for the current session (the frame's details track). */
export function AidaCanvasPanel(props: AidaCanvasPanelProps) {
  const {
    useSession, useSessions, sessionId, useStore, actions, t,
    listFiles, readFile, writeFile, renameFile, moveFile, deleteFile, closeCanvas,
    trajectoryView: TrajectoryView,
    useTrajectoryDuration, loadTrajectoryOlder, setTrajectoryActualDuration, trajectoryT, downloadSessionLog,
    mentionFile, quoteSelection,
  } = props
  const snapshot = useSession(s => s)
  // The session hooks' types model a materialized session; a session-scoped
  // slot renders before one exists, so the runtime guards stay.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  const cwd = useSessions(s => sessionId !== undefined ? s.byId[sessionId]?.cwd : undefined)
  const state = useStore(s => s)

  const [tree, setTree] = useState<WorkspaceFileListing | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [read, setRead] = useState<WorkspaceFileRead | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [buffer, setBuffer] = useState('')
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState<{ completed: number; total: number; name: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const folderRef = useRef<HTMLInputElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const trajectoryContentRef = useRef<HTMLDivElement | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const [trajectoryActionHost, setTrajectoryActionHost] = useState<HTMLElement | null>(null)

  // A session switch resets both the shared navigation state and every local
  // browser projection. In-flight uploads are cancelled so an old session
  // cannot continue advancing progress or refresh the new session's tree.
  useEffect(() => {
    uploadAbortRef.current?.abort()
    uploadAbortRef.current = null
    actions.reset()
    setTree(null)
    setTreeError(null)
    setQuery('')
    setCollapsed(new Set())
    setRead(null)
    setReadError(null)
    setBuffer('')
    setSaving(false)
    setImporting(null)
    setNotice(null)
    setDragging(false)
    dragDepth.current = 0
    return () => { uploadAbortRef.current?.abort() }
  }, [sessionId, cwd, actions])

  // Maximize truly collapses the conversation: the frame grid becomes
  // `<sidebar> 0 <rest>` (the center track goes to zero) and the canvas stays
  // in-flow in the details track, which now spans the whole rest. The grid
  // override rides a data attribute + CSS variable on the frame, so AppFrame's
  // own inline grid keeps tracking drags/resizes beneath it and restore is
  // instant. While maximized, window resizes recompute the override from the
  // live frame geometry so balanced and maximized layouts both remain exact.
  useEffect(() => {
    applyMaximizedGrid(panelRef.current, state.maximized)
    const onResize = (): void => { applyMaximizedGrid(panelRef.current, state.maximized) }
    window.addEventListener('resize', onResize)
    return () =>{  window.removeEventListener('resize', onResize) }
  }, [state.maximized])

  useEffect(() => {
    if (state.tab !== 'trajectory') {
      setTrajectoryActionHost(null)
      return
    }
    const trajectorySeat = trajectoryContentRef.current?.firstElementChild
    const trajectoryRoot = trajectorySeat?.firstElementChild
    const controls = trajectoryRoot?.firstElementChild
    setTrajectoryActionHost(controls instanceof HTMLElement ? controls : null)
  }, [state.tab])

  const toggleMaximize = useCallback((): void => {
    actions.setMaximized(!state.maximized)
  }, [state.maximized, actions])

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    const timer = window.setTimeout(() =>{  setNotice(null) }, 2500)
    /* v8 ignore next -- callers fire-and-forget the notice; the timer callback (tested) clears it. */
    return () =>{  window.clearTimeout(timer) }
  }, [])

  // Mention the whole file into the composer as a `@path` chip.
  const handleMention = useCallback((path: string): void => {
    if (!mentionFile(path)) showNotice(t('canvas.mentionBusy'))
  }, [mentionFile, showNotice, t])

  // Quote the current preview selection (edit-area textarea selection, then
  // the rendered-preview selection) into the composer; without a selection,
  // fall back to a whole-file mention chip.
  const handleQuote = useCallback((path: string): void => {
    const quote = (text: string): boolean => {
      if (!quoteSelection(path, text)) { showNotice(t('canvas.mentionBusy')); return false }
      return true
    }
    const active = document.activeElement
    if (active instanceof HTMLTextAreaElement && active.dataset.testid === 'aida-canvas-edit') {
      // The DOM spec allows null selection bounds; the lib types do not model it.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      const start = active.selectionStart ?? 0
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      const end = active.selectionEnd ?? 0
      if (end > start && buffer.slice(start, end).trim() !== '') {
        quote(buffer.slice(start, end))
        return
      }
      handleMention(path)
      return
    }
    const selection = window.getSelection()
    // Read the range text directly: Chromium's Selection.toString() can be
    // empty for a programmatically-seated range even though the range itself
    // carries the text.
    const selected = selection !== null && selection.rangeCount > 0
      ? selection.getRangeAt(0).toString()
      : ''
    if (selected.trim() !== '') {
      const anchor = selection?.anchorNode
      if (anchor instanceof Node) {
        const panel = document.querySelector('[data-testid="aida-canvas-panel"]')
        if (panel?.contains(anchor)) {
          quote(selected)
          return
        }
      }
    }
    handleMention(path)
  }, [buffer, mentionFile, quoteSelection, showNotice, t, handleMention])

  // Workspace tree: refetch when the session workspace root changes.
  useEffect(() => {
    let active = true
    setTree(null)
    setTreeError(null)
    if (cwd === undefined) return
    const controller = new AbortController()
    void listFiles(cwd, controller.signal)
      .then((listing) => { if (active) setTree(listing) })
      .catch((error: unknown) => {
        if (active && !controller.signal.aborted) {
          setTreeError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => { active = false; controller.abort() }
  }, [cwd, listFiles])

  // Active file content: refetch when the active path changes.
  const activeNode = useMemo(() => {
    if (tree === null || state.activePath === null) return undefined
    const find = (nodes: readonly WorkspaceFileNode[]): WorkspaceFileNode | undefined => {
      for (const node of nodes) {
        if (node.path === state.activePath) return node
        if (node.kind === 'folder') {
          const found = find(node.children ?? [])
          if (found !== undefined) return found
        }
      }
      return undefined
    }
    return find(tree.files)
  }, [tree, state.activePath])

  useEffect(() => {
    let active = true
    setRead(null)
    setReadError(null)
    const path = state.activePath
    if (cwd === undefined || path === null || activeNode === undefined) return
    const controller = new AbortController()
    const opts = activeNode.kind === 'text' ? { maxBytes: PREVIEW_MAX_BYTES } : {}
    void readFile(cwd, path, opts, controller.signal)
      .then((value) => {
        if (active) {
          setRead(value)
          // SVG reads arrive as base64 (host image classification); the edit
          // buffer holds the decoded UTF-8 source.
          setBuffer(value.content ?? (isSvgName(path) ? base64ToText(value.base64 ?? '') : ''))
        }
      })
      .catch((error: unknown) => {
        if (active && !controller.signal.aborted) {
          setReadError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => { active = false; controller.abort() }
  }, [cwd, state.activePath, activeNode, readFile])

  // Save the edit buffer back through the host write verb.
  const saveEdit = useCallback(async (): Promise<void> => {
    const path = state.activePath
    const root = cwd
    /* v8 ignore next -- null-path / missing-workspace arms: the edit affordance
       only renders with an active file in a workspace; the saving arm is tested. */
    if (path === null || root === undefined || saving) return
    setSaving(true)
    try {
      await writeFile(root, path, { content: buffer })
      actions.setEditing(path, false)
      /* v8 ignore next -- the save affordance only renders with a loaded read of the same file. */
      setRead((current) => {
        if (current === null || current.path !== path) return current
        // An SVG preview consumes base64; re-encode the saved source so the
        // rendered image refreshes without a re-fetch.
        if (isSvgName(path)) return { ...current, base64: textToBase64(buffer), totalBytes: buffer.length }
        return { ...current, content: buffer, totalBytes: buffer.length }
      })
      setNotice(t('canvas.save'))
      /* v8 ignore next -- the edit affordance only renders with a loaded tree. */
      if (tree !== null) {
        const listing = await listFiles(root)
        if (listing.root === root) setTree(listing)
      }
    } catch (error: unknown) {
      setReadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }, [state.activePath, cwd, buffer, saving, writeFile, actions, t, tree, listFiles])

  // Import dropped or picked files (text or base64 binary) through writeFile.
  const ingestFiles = useCallback(async (files: File[]): Promise<void> => {
    const root = cwd
    /* v8 ignore next -- the drop/pick handlers and inputs only mount while the session has a workspace. */
    if (root === undefined) {
      showNotice(t('canvas.importSessionRequired'))
      return
    }
    if (files.length === 0) return
    uploadAbortRef.current?.abort()
    const controller = new AbortController()
    uploadAbortRef.current = controller
    let imported = 0
    let failed = 0
    /* v8 ignore next -- the empty-files arm returns above, so the first entry is always present. */
    setImporting({ completed: 0, total: files.length, name: files[0]?.name ?? '' })
    try {
      for (const [index, file] of files.entries()) {
        // The signal can abort while the previous await settles; the flow
        // analysis cannot see the async interleaving.
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        if (controller.signal.aborted) return
        setImporting({ completed: index, total: files.length, name: file.name })
        try {
          const relative = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
            .replace(/\\/g, '/').replace(/^\/+/, '')
          const bytes = new Uint8Array(await file.arrayBuffer())
          // oxlint-disable-next-line typescript/no-unnecessary-condition
          if (controller.signal.aborted) return
          const binary = bytes.some(byte => byte === 0) && !TEXT_EXTENSION_PATTERN.test(relative)
          const input = binary
            ? { base64: bytesToBase64(bytes) }
            : { content: new TextDecoder().decode(bytes) }
          await writeFile(root, relative, input, controller.signal)
          imported += 1
        } catch {
          // oxlint-disable-next-line typescript/no-unnecessary-condition
          if (controller.signal.aborted) return
          failed += 1
        }
      }
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (controller.signal.aborted) return
      showNotice([
        t('canvas.importDone', { imported: String(imported) }),
        ...(failed > 0 ? [t('canvas.importFailed', { failed: String(failed) })] : []),
      ].join(' · '))
      if (tree !== null) {
        const listing = await listFiles(root, controller.signal)
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        if (!controller.signal.aborted && listing.root === root) setTree(listing)
      }
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null
        if (!controller.signal.aborted) setImporting(null)
      }
    }
  }, [cwd, writeFile, listFiles, tree, showNotice, t])

  const toggleFolder = useCallback((node: WorkspaceFileNode) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(node.path)) next.delete(node.path)
      else next.add(node.path)
      return next
    })
  }, [])

  const refreshTree = useCallback(async (root: string): Promise<void> => {
    const listing = await listFiles(root)
    if (listing.root === root) setTree(listing)
  }, [listFiles])

  // Rename a workspace file; open tabs follow the new path.
  const renameWorkspaceFile = useCallback(async (path: string, nextName: string): Promise<{ ok: boolean; error?: string }> => {
    const root = cwd
    /* v8 ignore next -- the row-action menu only mounts while the session has a workspace. */
    if (root === undefined) return { ok: false, error: t('canvas.workspaceEmpty') }
    try {
      const result = await renameFile(root, path, nextName)
      actions.renameTab(path, result.path)
      await refreshTree(root)
      /* v8 ignore next -- split().pop() always yields a segment for a non-empty path. */
      showNotice(t('canvas.renamed', { name: result.path.split('/').pop() ?? result.path }))
      return { ok: true }
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }, [cwd, renameFile, actions, refreshTree, showNotice, t])

  // Move a file into a folder ('' = the workspace root) via drag-and-drop;
  // the open tab follows the new path.
  const moveWorkspaceFile = useCallback(async (path: string, targetDir: string): Promise<void> => {
    const root = cwd
    /* v8 ignore next -- the tree only mounts while the session has a workspace. */
    if (root === undefined) return
    const target = targetDir === '' ? basename(path) : `${targetDir}/${basename(path)}`
    if (target === path) return
    try {
      const result = await moveFile(root, path, target)
      actions.renameTab(path, result.path)
      await refreshTree(root)
      showNotice(t('canvas.moved', { name: basename(result.path) }))
    } catch (error: unknown) {
      showNotice(error instanceof Error ? error.message : String(error))
    }
  }, [cwd, moveFile, actions, refreshTree, showNotice, t])

  // Delete a workspace file; the open tab closes with it.
  const deleteWorkspaceFile = useCallback(async (path: string): Promise<{ ok: boolean; error?: string }> => {
    const root = cwd
    /* v8 ignore next -- the row-action menu only mounts while the session has a workspace. */
    if (root === undefined) return { ok: false, error: t('canvas.workspaceEmpty') }
    try {
      await deleteFile(root, path)
      actions.closeTab(path)
      await refreshTree(root)
      /* v8 ignore next -- split().pop() always yields a segment for a non-empty path. */
      showNotice(t('canvas.deleted', { name: path.split('/').pop() ?? path }))
      return { ok: true }
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }, [cwd, deleteFile, actions, refreshTree, showNotice, t])

  // ── Batch actions for multi-selected rows ───────────────────────────────

  const batchOpen = useCallback((paths: readonly string[]): void => {
    for (const path of paths) actions.openFile(path)
    actions.clearSelection()
  }, [actions])

  const batchMention = useCallback((paths: readonly string[]): void => {
    for (const path of paths) mentionFile(path)
    actions.clearSelection()
  }, [mentionFile, actions])

  const batchDelete = useCallback(async (paths: readonly string[]): Promise<void> => {
    const root = cwd
    /* v8 ignore next -- the batch bar only mounts while the session has a workspace. */
    if (root === undefined) return
    let failed = 0
    for (const path of paths) {
      try {
        await deleteFile(root, path)
        actions.closeTab(path)
      } catch {
        failed += 1
      }
    }
    await refreshTree(root)
    actions.clearSelection()
    showNotice(failed === 0
      ? t('canvas.deletedMany', { count: String(paths.length) })
      : t('canvas.deletedManyFailed', { count: String(paths.length - failed), failed: String(failed) }))
  }, [cwd, deleteFile, actions, refreshTree, showNotice, t])

  const filtered = useMemo(() => filterFileTree(tree?.files ?? [], query), [tree, query])
  const fileCount = useMemo(() => countFiles(tree?.files ?? []), [tree])
  const editing = state.editPath === state.activePath && isSourceEditable(activeNode)

  // Multi-select facts: the visible row order (shift+click ranges) and the
  // selected text files (batch mention applies to text leaves only).
  const visiblePaths = useMemo(() => visiblePathsOf(filtered, collapsed), [filtered, collapsed])
  const fileNodes = useMemo(() => {
    const map = new Map<string, WorkspaceFileNode>()
    for (const node of flattenTree(tree?.files ?? [])) map.set(node.path, node)
    return map
  }, [tree])
  const selectedMentionable = useMemo(
    () => (state.selected ?? []).filter(path => fileNodes.get(path)?.kind === 'text'),
    [state.selected, fileNodes],
  )

  // The session hooks' types model a materialized session; a session-scoped
  // slot renders before one exists.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (snapshot === undefined || cwd === undefined) {
    return (
      <section ref={panelRef} className={css.panel} aria-label={t('canvas.title')} data-testid="aida-canvas-panel">
        <PanelHeader title={t('canvas.title')} maximized={state.maximized} onMaximize={toggleMaximize} onClose={closeCanvas} t={t} />
        <div className={css.panelEmpty}>{t('canvas.workspaceEmpty')}</div>
      </section>
    )
  }

  return (
    <section
      ref={panelRef}
      className={state.maximized ? `${css.panel} ${css.maximized}` : css.panel}
      aria-label={t('canvas.title')}
      data-testid="aida-canvas-panel"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(event) => {
        // Only OS file drags import; the in-tree move drags stop at the tree.
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        void ingestFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <PanelHeader title={t('canvas.title')} maximized={state.maximized} onMaximize={toggleMaximize} onClose={closeCanvas} t={t} />

      <div className={css.tabs} role="tablist" aria-label={t('canvas.title')}>
        <TabButton id="files" active={state.tab === 'files'} label={t('canvas.files')} count={fileCount} onClick={() =>{  actions.setTab('files') }} />
        <TabButton id="trajectory" active={state.tab === 'trajectory'} label={t('canvas.trajectory')} onClick={() =>{  actions.setTab('trajectory') }} />
        <TabButton id="canvas" active={state.tab === 'canvas'} label={t('canvas.canvas')} count={state.openTabs.length} onClick={() =>{  actions.setTab('canvas') }} />
      </div>

      <div className={css.body}>
        {state.tab === 'files' && (
          <FilesTab
            tree={tree}
            error={treeError}
            query={query}
            setQuery={setQuery}
            filtered={filtered}
            collapsed={collapsed}
            activePath={state.activePath}
            selected={state.selected}
            onToggle={toggleFolder}
            onOpen={(path) => { actions.openFile(path); actions.clearSelection() }}
            onRefresh={() => { setTree(null); void refreshTree(cwd) }}
            importing={importing}
            onPickFiles={() => uploadRef.current?.click()}
            onPickFolder={() => folderRef.current?.click()}
            onRename={renameWorkspaceFile}
            onDelete={deleteWorkspaceFile}
            onMention={handleMention}
            onSelectToggle={(path) =>{  actions.toggleSelected(path) }}
            onSelectRange={(target) =>{  actions.selectRange(state.selectionAnchor, target, visiblePaths) }}
            onClearSelection={() =>{  actions.clearSelection() }}
            onBatchOpen={batchOpen}
            onBatchMention={batchMention}
            onBatchDelete={batchDelete}
            onDropFile={moveWorkspaceFile}
            selectedMentionable={selectedMentionable}
            t={t}
          />
        )}

        {state.tab === 'canvas' && (
          <CanvasTab
            openTabs={state.openTabs}
            activePath={state.activePath}
            node={activeNode}
            read={read}
            readError={readError}
            editing={editing}
            buffer={buffer}
            saving={saving}
            onOpenTab={(path) =>{  actions.openFile(path) }}
            onCloseTab={(path) =>{  actions.closeTab(path) }}
            onCloseAll={() =>{  actions.closeAllTabs() }}
            /* v8 ignore next -- the edit toggle only renders with an active file. */
            onEnterEdit={() => { if (state.activePath !== null) actions.setEditing(state.activePath, false) }}
            /* v8 ignore next -- the edit textarea only renders with an active file. */
            onBufferChange={(value) => {
              setBuffer(value)
              if (state.activePath !== null) actions.setEditing(state.activePath, true)
            }}
            onSave={() => void saveEdit()}
            onQuote={handleQuote}
            t={t}
          />
        )}

        {state.tab === 'trajectory' && (
          <div className={css.trajectoryPane} data-testid="aida-canvas-trajectory">
            <div ref={trajectoryContentRef} className={css.trajectoryContent}>
              <TrajectoryView
                {...props}
                inspect={null}
                t={trajectoryT}
                useDuration={useTrajectoryDuration}
                loadOlder={loadTrajectoryOlder}
                setActualDuration={setTrajectoryActualDuration}
              />
            </div>
            {trajectoryActionHost !== null && createPortal(
              <button
                type="button"
                className={css.trajectoryAction}
                data-testid="aida-canvas-session-log-download"
                aria-label={t('canvas.sessionLog')}
                title={t('canvas.sessionLog')}
                onClick={() => { void downloadSessionLog() }}
              >
                <Download size={14} aria-hidden="true" />
              </button>,
              trajectoryActionHost,
            )}
          </div>
        )}
      </div>

      {dragging && <div className={css.dropOverlay}>{t('canvas.import')}</div>}
      {notice !== null && <div className={css.notice} role="status">{notice}</div>}

      <input ref={uploadRef} className={css.hiddenInput} type="file" multiple
        data-testid="aida-canvas-file-input"
        /* v8 ignore next -- a file input's files list is never null. */
        onChange={(event) => { void ingestFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} />
      <input ref={folderRef} className={css.hiddenInput} type="file"
        data-testid="aida-canvas-folder-input"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        /* v8 ignore next -- a file input's files list is never null. */
        onChange={(event) => { void ingestFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} />
    </section>
  )
}

/** Panel header: maximize/restore at the top right, then the close affordance. */
function PanelHeader({ title, maximized, onMaximize, onClose, t }: {
  title: string
  maximized: boolean
  onMaximize: () => void
  onClose: () => void
  t: AidaCanvasPanelProps['t']
}) {
  return (
    <div className={css.header} data-testid="aida-canvas-header">
      <b className={css.headerTitle}>{title}</b>
      <button
        type="button"
        className={`${css.headerAction} ${css.headerActionPush}`}
        aria-label={maximized ? t('canvas.restore') : t('canvas.maximize')}
        title={maximized ? t('canvas.restore') : t('canvas.maximize')}
        data-testid="aida-canvas-maximize"
        onClick={onMaximize}
      >
        {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
      <button type="button" className={`${css.headerAction} ${css.headerActionSeparator}`} aria-label={t('canvas.close')} title={t('canvas.close')} onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  )
}

/** One workspace-tab button. */
function TabButton({ id, active, label, count, onClick }: {
  id: string
  active: boolean
  label: string
  count?: number
  onClick: () => void
}) {
  return (
    <button type="button" role="tab" aria-selected={active} data-tab={id}
      className={active ? `${css.tab} ${css.tabActive}` : css.tab} onClick={onClick}>
      {label}
      {count !== undefined && count > 0 && <span className={css.tabCount}>{count}</span>}
    </button>
  )
}

/** Files tab: search, import, the workspace tree, and the multi-select batch bar. */
function FilesTab({
  tree, error, query, setQuery, filtered, collapsed, activePath, selected = [],
  onToggle, onOpen, onRefresh, importing, onPickFiles, onPickFolder, onRename, onDelete, onMention,
  onSelectToggle, onSelectRange, onClearSelection, onBatchOpen, onBatchMention, onBatchDelete, onDropFile,
  selectedMentionable = [], t,
}: {
  tree: WorkspaceFileListing | null
  error: string | null
  query: string
  setQuery: (query: string) => void
  filtered: readonly WorkspaceFileNode[]
  collapsed: ReadonlySet<string>
  activePath: string | null
  selected: readonly string[]
  onToggle: (node: WorkspaceFileNode) => void
  onOpen: (path: string) => void
  onRefresh: () => void
  importing: { completed: number; total: number; name: string } | null
  onPickFiles: () => void
  onPickFolder: () => void
  onRename: (path: string, nextName: string) => Promise<{ ok: boolean; error?: string }>
  onDelete: (path: string) => Promise<{ ok: boolean; error?: string }>
  onMention: (path: string) => void
  onSelectToggle: (path: string) => void
  onSelectRange: (target: string) => void
  onClearSelection: () => void
  onBatchOpen: (paths: readonly string[]) => void
  onBatchMention: (paths: readonly string[]) => void
  onBatchDelete: (paths: readonly string[]) => Promise<void>
  onDropFile: (path: string, targetDir: string) => void
  selectedMentionable: readonly string[]
  t: AidaCanvasPanelProps['t']
}) {
  const [actionPath, setActionPath] = useState<string | null>(null)
  const [actionMode, setActionMode] = useState<'menu' | 'rename' | 'delete'>('menu')
  const [renameValue, setRenameValue] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [batchConfirm, setBatchConfirm] = useState(false)

  // A fresh selection starts with the confirm step closed.
  useEffect(() => { setBatchConfirm(false) }, [selected])

  const closeAction = (): void => { setActionPath(null); setActionMode('menu'); setActionError(null) }

  /** Open the row-action menu for one row (the ellipsis and the right-click share it). */
  const openRowMenu = useCallback((node: WorkspaceFileNode): void => {
    if (actionPath === node.path) {
      setActionPath(null)
      setActionMode('menu')
      setActionError(null)
      return
    }
    setActionPath(node.path)
    setActionMode('menu')
    setRenameValue(node.name)
    setActionError(null)
  }, [actionPath])

  const submitRename = async (node: WorkspaceFileNode): Promise<void> => {
    /* v8 ignore next -- busy guard: the rename affordances disable while busy, so the true arm is unreachable. */
    if (actionBusy) return
    setActionBusy(true)
    setActionError(null)
    try {
      const result = await onRename(node.path, renameValue.trim())
      /* v8 ignore next -- renameWorkspaceFile always reports an error message on failure. */
      if (!result.ok) setActionError(result.error ?? t('canvas.renameFailed'))
      else closeAction()
    } finally {
      setActionBusy(false)
    }
  }

  const submitDelete = async (node: WorkspaceFileNode): Promise<void> => {
    /* v8 ignore next -- busy guard: the delete affordances disable while busy, so the true arm is unreachable. */
    if (actionBusy) return
    setActionBusy(true)
    setActionError(null)
    try {
      const result = await onDelete(node.path)
      /* v8 ignore next -- deleteWorkspaceFile always reports an error message on failure. */
      if (!result.ok) setActionError(result.error ?? t('canvas.deleteFailed'))
      else closeAction()
    } finally {
      setActionBusy(false)
    }
  }

  const renderRowActions = (node: WorkspaceFileNode): ReactNode => {
    const open = actionPath === node.path
    return (
      <div className={css.treeActionWrap} style={{ position: 'relative' }}>
        <button
          type="button"
          className={css.treeRowActionsButton}
          data-testid="aida-canvas-row-actions"
          title={t('canvas.rowActions')}
          aria-label={t('canvas.rowActions', {}) + ` ${node.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation()
            openRowMenu(node)
          }}
        >
          <Ellipsis size={16} />
        </button>
        {open && (
          <div className={css.treeActionPopover} role="menu" data-testid="aida-canvas-row-menu"
            onClick={(event) =>{  event.stopPropagation() }}
            onContextMenu={(event) =>{  event.stopPropagation() }}>
            {actionMode === 'menu' && (
              <>
                {node.kind === 'text' && (
                  <button role="menuitem" data-testid="aida-canvas-row-mention" onClick={() => { onMention(node.path); closeAction() }}>
                    {t('canvas.mention')}
                  </button>
                )}
                <button role="menuitem" onClick={() =>{  setActionMode('rename') }}>{t('canvas.rename')}</button>
                <button role="menuitem" className={css.danger} onClick={() =>{  setActionMode('delete') }}>{t('canvas.delete')}</button>
              </>
            )}
            {actionMode === 'rename' && (
              <>
                <input
                  autoFocus
                  data-testid="aida-canvas-rename-input"
                  value={renameValue}
                  disabled={actionBusy}
                  placeholder={t('canvas.renamePlaceholder')}
                  onChange={(event) =>{  setRenameValue(event.target.value) }}
                  onKeyDown={(event) => { if (event.key === 'Enter') void submitRename(node) }}
                />
                {actionError !== null && <div className={css.treeActionError} role="alert">{actionError}</div>}
                <button data-testid="aida-canvas-rename-submit" disabled={actionBusy || renameValue.trim() === '' || renameValue.trim() === node.name} onClick={() => void submitRename(node)}>
                  {t('canvas.save')}
                </button>
              </>
            )}
            {actionMode === 'delete' && (
              <>
                <div className={css.treeActionError} role="alert">{t('canvas.deleteConfirm', { name: node.name })}</div>
                {actionError !== null && <div className={css.treeActionError} role="alert">{actionError}</div>}
                <button className={css.danger} data-testid="aida-canvas-delete-confirm" disabled={actionBusy} onClick={() => void submitDelete(node)}>
                  {t('canvas.delete')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={css.filesTab} data-testid="aida-canvas-files">
      <div className={css.filesToolbar}>
        <label className={css.search}>
          <span className={css.searchIcon} aria-hidden="true"><Search size={16} /></span>
          <input
            data-testid="aida-canvas-search"
            value={query}
            onChange={(event) =>{  setQuery(event.target.value) }}
            placeholder={t('canvas.searchPlaceholder')}
            aria-label={t('canvas.searchPlaceholder')}
          />
          {query !== '' && (
            <button type="button" className={css.searchClear} aria-label={t('canvas.closeAll')} onClick={() =>{  setQuery('') }}>
              <X size={16} />
            </button>
          )}
        </label>
        <button type="button" className={css.importButton} data-testid="aida-canvas-import" onClick={onPickFiles}>
          <FileUp size={14} aria-hidden="true" />
          {t('canvas.importFile')}
        </button>
        <button type="button" className={css.importButton} onClick={onPickFolder}>
          <FolderUp size={14} aria-hidden="true" />
          {t('canvas.importFolder')}
        </button>
      </div>
      {importing !== null && (
        <div className={css.importProgress} role="status">
          {t('canvas.importProgress', { completed: String(importing.completed), total: String(importing.total), name: importing.name })}
        </div>
      )}
      {error !== null && <div className={css.treeError} role="alert">{error}</div>}
      {tree === null && error === null ? (
        <div className={css.treeEmpty}>{t('canvas.previewLoading')}</div>
      ) : filtered.length === 0 ? (
        <div className={css.treeEmpty}>
          {query !== '' ? t('canvas.searchNone', { query }) : t('canvas.emptyFilesTitle')}
          <div className={css.treeEmptyHint}>{t('canvas.emptyFilesHint')}</div>
        </div>
      ) : (
        <div className={css.treeScroll}
          role="tree"
          aria-label={t('canvas.files')}
          onKeyDown={navigateFileTree}
          onFocusCapture={keepTreeRovingFocus}
          // Drops outside a folder row move the dragged file to the root.
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(FILE_DRAG_TYPE)) return
            event.preventDefault()
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes(FILE_DRAG_TYPE)) return
            event.preventDefault()
            const path = event.dataTransfer.getData(FILE_DRAG_TYPE)
            if (path !== '') onDropFile(path, '')
          }}>
          <FileTree
            list={filtered}
            activePath={activePath}
            highlighted={null}
            collapsed={collapsed}
            selected={new Set(selected)}
            onToggle={onToggle}
            onOpen={(node) =>{  onOpen(node.path) }}
            onSelectToggle={(node) =>{  onSelectToggle(node.path) }}
            onSelectRange={(node) =>{  onSelectRange(node.path) }}
            renderRowActions={renderRowActions}
            onRowContextMenu={openRowMenu}
            onDropFile={onDropFile}
          />
        </div>
      )}
      {selected.length > 0 && (
        <div className={css.batchBar} data-testid="aida-canvas-batch" role="group" aria-label={t('canvas.selectedCount', { count: String(selected.length) })}>
          <span className={css.batchCount}>{t('canvas.selectedCount', { count: String(selected.length) })}</span>
          <span className={css.grow} />
          {selectedMentionable.length > 0 && (
            <button type="button" className={css.batchAction} data-testid="aida-canvas-batch-mention"
              onClick={() =>{  onBatchMention(selectedMentionable) }}>
              {t('canvas.mentionAll')}
            </button>
          )}
          <button type="button" className={css.batchAction} data-testid="aida-canvas-batch-open"
            onClick={() =>{  onBatchOpen(selected) }}>
            {t('canvas.openAll')}
          </button>
          {batchConfirm ? (
            <>
              <span className={css.batchConfirmText}>{t('canvas.batchDeleteConfirm', { count: String(selected.length) })}</span>
              <button type="button" className={`${css.batchAction} ${css.batchDanger}`} data-testid="aida-canvas-batch-delete-confirm"
                onClick={() => void onBatchDelete(selected)}>
                {t('canvas.delete')}
              </button>
              <button type="button" className={css.batchAction} data-testid="aida-canvas-batch-cancel"
                onClick={() =>{  setBatchConfirm(false) }}>
                {t('canvas.cancel')}
              </button>
            </>
          ) : (
            <button type="button" className={`${css.batchAction} ${css.batchDanger}`} data-testid="aida-canvas-batch-delete"
              onClick={() =>{  setBatchConfirm(true) }}>
              {t('canvas.delete')}
            </button>
          )}
          <button type="button" className={css.batchAction} data-testid="aida-canvas-batch-clear"
            onClick={onClearSelection}>
            {t('canvas.clearSelection')}
          </button>
        </div>
      )}
      {tree !== null && (
        <div className={css.filesFooter}>
          <span>{t('canvas.fileCount', { count: String(countFiles(tree.files)) })}</span>
          <button type="button" className={css.refreshButton} onClick={onRefresh}>{t('canvas.refresh')}</button>
        </div>
      )}
    </div>
  )
}

/** Canvas tab: open-file tabs and the active preview. */
function CanvasTab({
  openTabs, activePath, node, read, readError, editing, buffer, saving,
  onOpenTab, onCloseTab, onCloseAll, onEnterEdit, onBufferChange, onSave, onQuote, t,
}: {
  openTabs: readonly string[]
  activePath: string | null
  node: WorkspaceFileNode | undefined
  read: WorkspaceFileRead | null
  readError: string | null
  editing: boolean
  buffer: string
  saving: boolean
  onOpenTab: (path: string) => void
  onCloseTab: (path: string) => void
  onCloseAll: () => void
  onEnterEdit: () => void
  onBufferChange: (value: string) => void
  onSave: () => void
  onQuote: (path: string) => void
  t: AidaCanvasPanelProps['t']
}) {
  const [previewingDraft, setPreviewingDraft] = useState(false)
  useEffect(() => { setPreviewingDraft(false) }, [activePath, editing])

  return (
    <div className={css.canvasTab} data-testid="aida-canvas-pane">
      {openTabs.length > 0 && (
        <div className={css.fileTabs} role="tablist" aria-label={t('canvas.openTabs')}>
          {openTabs.map(path => (
            <div key={path} className={path === activePath ? `${css.fileTab} ${css.fileTabActive}` : css.fileTab}>
              <button
                type="button"
                role="tab"
                aria-selected={path === activePath}
                data-testid="aida-canvas-tab"
                title={path}
                onClick={() =>{  onOpenTab(path) }}
              >
                {path.split('/').pop()}
              </button>
              <button
                type="button"
                className={css.fileTabClose}
                /* v8 ignore next -- split().pop() always yields a segment for a non-empty path. */
                aria-label={t('canvas.closeFile', { name: path.split('/').pop() ?? path })}
                onClick={() =>{  onCloseTab(path) }}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <button type="button" className={css.fileTabsAll} onClick={onCloseAll}>
            <X size={13} aria-hidden="true" />
            {t('canvas.closeAll')}
          </button>
        </div>
      )}
      {node === undefined || activePath === null ? (
        <div className={css.panelEmpty}>
          {t('canvas.noOpenFiles')}
          <div className={css.treeEmptyHint}>{t('canvas.searchPlaceholder')}</div>
        </div>
      ) : (
        <div className={css.previewWrap}>
          <div className={css.previewBar}>
            <span className={css.previewPath} title={activePath}>{activePath}</span>
            <span className={css.grow} />
            {node.kind === 'text' && (
              <button
                type="button"
                className={css.editButton}
                data-testid="aida-canvas-quote"
                title={t('canvas.quote')}
                onMouseDown={(event) =>{  event.preventDefault() }}
                onClick={() =>{  onQuote(activePath) }}
              >
                <Quote size={14} aria-hidden="true" />
                {t('canvas.quote')}
              </button>
            )}
            {isSourceEditable(node) && (
              <div className={css.previewModes} role="group" aria-label={t('canvas.previewMode')}>
                <button
                  type="button"
                  className={!previewingDraft && editing ? `${css.editButton} ${css.editButtonActive}` : css.editButton}
                  data-testid="aida-canvas-edit-toggle"
                  aria-pressed={editing && !previewingDraft}
                  onClick={editing ? () => { setPreviewingDraft(false) } : onEnterEdit}
                >
                  <PencilLine size={14} aria-hidden="true" />
                  {t('canvas.edit')}
                </button>
                {editing && (
                  <button
                    type="button"
                    className={previewingDraft ? `${css.editButton} ${css.editButtonActive}` : css.editButton}
                    aria-pressed={previewingDraft}
                    onClick={() => { setPreviewingDraft(true) }}
                  >
                    <Eye size={14} aria-hidden="true" />
                    {t('canvas.preview')}
                  </button>
                )}
              </div>
            )}
            {editing && <span className={css.unsavedBadge}>{t('canvas.unsaved')}</span>}
          </div>
          <FilePreview
            node={node}
            format={formatOf(node.name)}
            read={read}
            error={readError}
            editing={editing && !previewingDraft}
            {...(editing && previewingDraft ? { previewContent: buffer } : {})}
            buffer={buffer}
            saving={saving}
            onBufferChange={onBufferChange}
            onSave={onSave}
            t={t}
          />
        </div>
      )}
    </div>
  )
}
