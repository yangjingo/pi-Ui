// @vitest-environment jsdom
// AIDA Canvas behavior: the store's navigation surface, the pure file
// helpers, the turn-tail selector, and the panel's file-tree → preview →
// edit → save flow against stubbed injected workspace-file verbs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createSnapshotStore, EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, SessionId, SessionListState, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  WorkspaceFileListing, WorkspaceFileNode, WorkspaceFileRead, WorkspaceFileWrite,
} from '../src/workspace-protocol.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { createAidaCanvasStore } from '../src/client/canvas/store.ts'
import { basename, bytesToBase64, countFiles, filterFileTree, listFiles } from '../src/client/canvas/files.ts'
import { codeLangOf, formatOf } from '../src/client/canvas/formats.ts'
import { producedPathsOf, AidaCanvasPanel, applyMaximizedGrid } from '../src/client/canvas/CanvasPanel.tsx'
import { FILE_DRAG_TYPE } from '../src/client/canvas/FileTree.tsx'
import { AidaCanvasToggle } from '../src/client/canvas/CanvasToggle.tsx'
import { selectAidaProducedFiles } from '../src/client/canvas/ProducedTail.tsx'
import type { AidaCanvasPanelProps } from '../src/client/canvas/CanvasPanel.tsx'

const TrajectoryView = () => <div data-conversation-composer-overlay="" />

type ListFilesFn = (root: string, signal?: AbortSignal) => Promise<WorkspaceFileListing>
type ReadFileFn = (root: string, path: string, opts?: { offset?: number; maxBytes?: number }, signal?: AbortSignal) => Promise<WorkspaceFileRead>
type WriteFileFn = (root: string, path: string, input: { content?: string; base64?: string }, signal?: AbortSignal) => Promise<WorkspaceFileWrite>
type RenameFileFn = (root: string, path: string, nextName: string, signal?: AbortSignal) => Promise<WorkspaceFileWrite>
type MoveFileFn = (root: string, path: string, targetPath: string, signal?: AbortSignal) => Promise<WorkspaceFileWrite>
type DeleteFileFn = (root: string, path: string, signal?: AbortSignal) => Promise<WorkspaceFileWrite>

const sid = (id: string) => id as SessionId
const SID = sid('s1')

const t: AidaCanvasPanelProps['t'] = makeTranslate(zh, commonZh)

/** jsdom lacks ResizeObserver and URL.createObjectURL; stub both. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function toolResultNode(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 42,
    time: 1000,
    callId: 'c1',
    call: { name: 'write', argsRaw: '{"path":"a.txt","content":"x"}' },
    callTime: 900,
    content: [{ type: 'text', text: 'wrote a.txt' }],
    isError: false,
    callView: { card: 'generic', title: 'Write a.txt', kind: 'edit', locations: [{ path: 'a.txt' }] },
    resultView: { card: 'diff', title: 'a.txt', diffs: [{ path: 'a.txt', oldText: null, newText: 'x' }] },
    subCalls: [],
    ...overrides,
  }
}

function snapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: SID,
    views: EMPTY_CONVERSATION_VIEWS,
    chat: {
      ...EMPTY_CHAT_SNAPSHOT,
      legacy: { ...EMPTY_CHAT_SNAPSHOT.legacy, nodes: [toolResultNode()] },
    },
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: false, subagent: null, lastAgentError: null,
    ...overrides,
  }
}

function sessionsState(): SessionListState {
  return {
    ids: [SID],
    byId: { [SID]: { id: SID, displayTitle: 'proj', cwd: '/projects/one', running: false, blank: false, updatedAt: 1 } },
    current: SID,
    phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
}

function listing(...files: WorkspaceFileNode[]): WorkspaceFileListing {
  return { root: '/projects/one', files, truncated: false }
}

function textFile(path: string, content: string): { node: WorkspaceFileNode; read: WorkspaceFileRead } {
  return {
    node: { name: path.split('/').pop() ?? path, path, kind: 'text', size: content.length },
    read: { path, content, truncated: false, totalBytes: content.length },
  }
}

/** Drive the panel with stubbed hooks and injected verbs; returns spies. */
function mountPanel(options: {
  snapshot?: ConversationSnapshot
  listing?: WorkspaceFileListing
  reads?: Record<string, WorkspaceFileRead>
  listFiles?: ListFilesFn
  readFile?: ReadFileFn
  writeFile?: WriteFileFn
  renameFile?: RenameFileFn
  moveFile?: MoveFileFn
  deleteFile?: DeleteFileFn
  mentionFile?: (path: string) => boolean
  quoteSelection?: (path: string, text: string) => boolean
  downloadSessionLog?: () => Promise<void>
} = {}) {
  const snap = options.snapshot ?? snapshot()
  const sessions = createSnapshotStore<SessionListState>(sessionsState())
  const useSessions = bindSnapshotSelector(sessions)
  const store = createAidaCanvasStore().create()
  const useStore = bindSnapshotSelector(store)
  const useSession = (selector: (snapshot: ConversationSnapshot | undefined) => unknown) => selector(snap)
  const listFiles = (options.listFiles ?? vi.fn(async () => options.listing ?? listing(textFile('README.md', '# Hello').node))) as Mock<ListFilesFn>
  const readFile = (options.readFile ?? vi.fn(async (_root: string, path: string) =>
    options.reads?.[path] ?? textFile(path, `content of ${path}`).read)) as Mock<ReadFileFn>
  const writeFile = (options.writeFile ?? vi.fn(async () => ({ path: 'x.md' }))) as Mock<WriteFileFn>
  const renameFile = (options.renameFile ?? vi.fn(async () => ({ path: 'renamed.md' }))) as Mock<RenameFileFn>
  const moveFile = (options.moveFile ?? vi.fn(async () => ({ path: 'moved.md' }))) as Mock<MoveFileFn>
  const deleteFile = (options.deleteFile ?? vi.fn(async () => ({ path: 'README.md' }))) as Mock<DeleteFileFn>
  const mentionFile = (options.mentionFile ?? vi.fn(() => true)) as Mock<(path: string) => boolean>
  const quoteSelection = (options.quoteSelection ?? vi.fn(() => true)) as Mock<(path: string, text: string) => boolean>
  const closeCanvas = vi.fn()
  const trajectoryDuration = createSnapshotStore(false)
  const useTrajectoryDuration = bindSnapshotSelector(trajectoryDuration)
  const loadTrajectoryOlder = vi.fn(async () => false)
  const setTrajectoryActualDuration = vi.fn()
  const trajectoryT = ((key: string) => key) as never
  const downloadSessionLog = options.downloadSessionLog ?? vi.fn(async () => {})
  const mounted = render(
    <AidaCanvasPanel
      useSessions={useSessions as never}
      useSession={useSession as never}
      useProjection={(() => undefined)}
      useInput={(() => ({ draft: '', draftRev: 0 })) as never}
      inputActions={{ setDraft: vi.fn(), addImages: vi.fn(), removeImage: vi.fn(), pruneImages: vi.fn(), submit: vi.fn() }}
      useWorkspaces={(() => undefined) as never}
      sessionId={SID}
      useStore={useStore}
      actions={store.actions}
      listFiles={listFiles}
      readFile={readFile}
      writeFile={writeFile}
      renameFile={renameFile}
      moveFile={moveFile}
      deleteFile={deleteFile}
      closeCanvas={closeCanvas}
      trajectoryView={TrajectoryView}
      useTrajectoryDuration={useTrajectoryDuration}
      loadTrajectoryOlder={loadTrajectoryOlder}
      setTrajectoryActualDuration={setTrajectoryActualDuration}
      trajectoryT={trajectoryT}
      downloadSessionLog={downloadSessionLog}
      mentionFile={mentionFile}
      quoteSelection={quoteSelection}
      t={t}
    />,
  )
  return { store, listFiles, readFile, writeFile, renameFile, moveFile, deleteFile, mentionFile, quoteSelection, downloadSessionLog, closeCanvas, snap, unmount: mounted.unmount }
}

describe('AIDA canvas helpers', () => {
  it('flattens, counts, and filters the workspace tree', () => {
    const tree: WorkspaceFileNode[] = [
      { name: 'src', path: 'src', kind: 'folder', children: [{ name: 'a.ts', path: 'src/a.ts', kind: 'text' }] },
      { name: 'README.md', path: 'README.md', kind: 'text' },
    ]
    expect(listFiles(tree).map(file => file.path)).toEqual(['src/a.ts', 'README.md'])
    expect(countFiles(tree)).toBe(2)
    expect(basename('src/a.ts')).toBe('a.ts')
    expect(filterFileTree(tree, 'a.ts').length).toBe(1)
    expect(filterFileTree(tree, '').length).toBe(2)
  })

  it('derives the preview format from the file extension', () => {
    expect(formatOf('README.md')).toBe('markdown')
    expect(formatOf('doc.markdown')).toBe('markdown')
    expect(formatOf('index.html')).toBe('html')
    expect(formatOf('page.htm')).toBe('html')
    expect(formatOf('flow.mmd')).toBe('mermaid')
    expect(formatOf('diagram.mermaid')).toBe('mermaid')
    expect(formatOf('diagram.svg')).toBe('svg')
    expect(formatOf('DIAGRAM.SVG')).toBe('svg')
    expect(formatOf('data.json')).toBe('json')
    expect(formatOf('data.jsonl')).toBe('json')
    expect(formatOf('data.csv')).toBe('csv')
    expect(formatOf('data.tsv')).toBe('csv')
    expect(formatOf('main.ts')).toBe('code')
    expect(formatOf('app.py')).toBe('code')
    expect(formatOf('style.css')).toBe('code')
    expect(formatOf('notes.txt')).toBe('text')
    // A name without an extension stays on the plain pane.
    expect(formatOf('Makefile')).toBe('text')
  })

  it('maps source extensions to the shiki grammar ids', () => {
    expect(codeLangOf('app.py')).toBe('python')
    expect(codeLangOf('main.ts')).toBe('typescript')
    expect(codeLangOf('page.xml')).toBe('xml')
    // HTML has its own iframe format, so it is not a code-format extension.
    expect(codeLangOf('page.html')).toBeUndefined()
    expect(codeLangOf('notes.txt')).toBeUndefined()
    expect(codeLangOf('Makefile')).toBeUndefined()
  })

  it('extracts produced paths from mutation call and result views', () => {
    expect(producedPathsOf(toolResultNode())).toEqual(['a.txt'])
    const read = toolResultNode({
      call: { name: 'read', argsRaw: '{}' },
      callView: null,
      resultView: { card: 'read', title: 'a.txt', path: 'a.txt', offset: 0, lines: [], totalLines: 1 },
    })
    expect(producedPathsOf(read)).toEqual(['a.txt'])
    // A diff call view and a non-diff/read result card both carry paths.
    const diffCall = toolResultNode({
      callView: { card: 'diff', title: 'a.txt', diffs: [{ path: 'a.txt', oldText: null, newText: 'x' }], locations: [{ path: 'a.txt' }] },
      resultView: null,
    })
    expect(producedPathsOf(diffCall)).toEqual(['a.txt'])
    const terminalResult = toolResultNode({
      resultView: { card: 'terminal', title: 'ls', output: 'x', exitCode: 0 },
    })
    expect(producedPathsOf(terminalResult)).toEqual(['a.txt'])
    // A mutation call without locations produces nothing.
    expect(producedPathsOf(toolResultNode({
      callView: { card: 'generic', title: 'x' },
      resultView: null,
    }))).toEqual([])
  })

  it('applies and clears the frame maximized grid override', () => {
    const frame = document.createElement('div')
    frame.style.gridTemplateColumns = '280px 1fr 360px'
    Object.defineProperty(frame, 'children', { value: [{ getBoundingClientRect: () => ({ width: 280 }) }] })
    Object.defineProperty(frame, 'getBoundingClientRect', { value: () => ({ width: 1680 }) })
    const panel = document.createElement('section')
    frame.appendChild(panel)
    document.body.appendChild(frame)

    applyMaximizedGrid(panel, true)
    expect(frame.dataset.aidaCanvasMaximized).toBe('true')
    expect(frame.style.getPropertyValue('--aida-canvas-cols')).toBe('280px 0px 1400px')

    applyMaximizedGrid(panel, false)
    expect(frame.dataset.aidaCanvasMaximized).toBeUndefined()
    expect(frame.style.getPropertyValue('--aida-canvas-cols')).toBe('')
    frame.remove()
  })

  it('uses the default sidebar width when the maximized frame has no children', () => {
    const frame = document.createElement('div')
    frame.style.gridTemplateColumns = '280px 1fr 360px'
    Object.defineProperty(frame, 'children', { value: [] })
    Object.defineProperty(frame, 'getBoundingClientRect', { value: () => ({ width: 1680 }) })
    const panel = document.createElement('section')
    frame.appendChild(panel)
    document.body.appendChild(frame)
    try {
      applyMaximizedGrid(panel, true)
      expect(frame.style.getPropertyValue('--aida-canvas-cols')).toBe('280px 0px 1400px')
    } finally {
      frame.remove()
    }
  })

})

describe('AIDA canvas store', () => {
  it('opens, switches, and closes files', () => {
    const store = createAidaCanvasStore().create()
    act(() => {
      store.actions.openFile('a.txt')
    })
    expect(store.store.getSnapshot()).toMatchObject({ tab: 'canvas', activePath: 'a.txt', openTabs: ['a.txt'] })
    act(() => {
      store.actions.openFile('b.txt')
    })
    const state = store.store.getSnapshot()
    expect(state.activePath).toBe('b.txt')
    act(() => { store.actions.closeTab('a.txt') })
    expect(store.store.getSnapshot().openTabs).toEqual(['b.txt'])
  })

  it('clears the editing state on close-all and tab close', () => {
    const store = createAidaCanvasStore().create()
    act(() => {
      store.actions.openFile('a.txt')
      store.actions.setEditing('a.txt', true)
    })
    expect(store.store.getSnapshot()).toMatchObject({ editPath: 'a.txt', editDirty: true })
    act(() => { store.actions.closeAllTabs() })
    expect(store.store.getSnapshot()).toMatchObject({ openTabs: [], activePath: null, editPath: null, editDirty: false })
    act(() => {
      store.actions.openFile('b.txt')
      store.actions.setEditing('b.txt', true)
      store.actions.closeTab('b.txt')
    })
    expect(store.store.getSnapshot()).toMatchObject({ editPath: null, editDirty: false })
  })

  it('follows renamed tabs in the open list, active path, and editing path', () => {
    const store = createAidaCanvasStore().create()
    act(() => {
      store.actions.openFile('a.txt')
      store.actions.openFile('b.txt')
      store.actions.setTab('files')
      store.actions.setMaximized(true)
      store.actions.renameTab('a.txt', 'renamed.md')
    })
    expect(store.store.getSnapshot()).toMatchObject({
      tab: 'files', maximized: true, openTabs: ['renamed.md', 'b.txt'], activePath: 'b.txt',
    })
    act(() => {
      store.actions.setEditing('renamed.md', true)
      store.actions.renameTab('renamed.md', 'final.md')
    })
    expect(store.store.getSnapshot()).toMatchObject({ openTabs: ['final.md', 'b.txt'], editPath: 'final.md' })
    act(() => { store.actions.reset() })
    expect(store.store.getSnapshot()).toEqual({
      maximized: false, tab: 'files', openTabs: [], activePath: null,
      editPath: null, editDirty: false, selected: [], selectionAnchor: null,
    })
  })
})

describe('AIDA turn-tail selector', () => {
  it('claims produced paths from the deliverables turn data', () => {
    const owner = {
      turn: { turn: 1, data: new Map([['deliverables', { produced: [{ path: 'a.txt', seq: 10 }, { path: 'a.txt', seq: 12 }] }]]) },
      seq: 20,
      openFile: vi.fn(),
    }
    expect(selectAidaProducedFiles(owner as never)).toEqual(['a.txt'])
    expect(selectAidaProducedFiles({ ...owner, turn: { turn: 1, data: new Map() } } as never)).toBeNull()
  })
})

describe('AIDA canvas toggle', () => {
  it('renders the logo-row style icon button (no text label) and opens the column on click', () => {
    const openCanvas = vi.fn()
    render(
      <AidaCanvasToggle
        useSessions={(() => undefined) as never}
        useSession={(() => undefined) as never}
        useProjection={(() => undefined)}
        useInput={(() => ({ draft: '', draftRev: 0 })) as never}
        inputActions={{ setDraft: vi.fn(), addImages: vi.fn(), removeImage: vi.fn(), pruneImages: vi.fn(), submit: vi.fn() }}
        useWorkspaces={(() => undefined) as never}
        sessionId={SID}
        openCanvas={openCanvas}
        t={t}
      />,
    )
    const button = screen.getByTestId('aida-canvas-toggle')
    // Icon-only: the label rides aria/tooltip, not visible text.
    expect(button.textContent).toBe('')
    expect(button.getAttribute('aria-label')).toBe('画布')
    // The glyph describes opening the framework's right-hand details panel.
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('lucide-panel-right-open')
    expect(button.querySelector('svg')?.getAttribute('width')).toBe('16')
    fireEvent.click(button)
    expect(openCanvas).toHaveBeenCalledTimes(1)
  })
})

describe('AIDA canvas panel', () => {
  it('shows the workspace tree, opens a text file, previews it, and saves an edit', async () => {
    const { listFiles, readFile, writeFile } = mountPanel({
      listing: listing(textFile('notes.txt', 'hello text').node),
      reads: { 'notes.txt': { path: 'notes.txt', content: 'hello text', truncated: false, totalBytes: 10 } },
    })
    expect(await screen.findByText('notes.txt')).toBeTruthy()
    expect(listFiles).toHaveBeenCalledWith('/projects/one', expect.anything())

    fireEvent.click(screen.getByText('notes.txt'))
    await waitFor(() =>{  expect(screen.getByTestId('aida-canvas-preview').textContent).toBe('hello text') })
    expect(readFile).toHaveBeenCalledWith('/projects/one', 'notes.txt', { maxBytes: 524288 }, expect.anything())

    fireEvent.click(screen.getByTestId('aida-canvas-edit-toggle'))
    const editor = screen.getByTestId('aida-canvas-edit') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'edited' } })
    fireEvent.click(screen.getByTestId('aida-canvas-save'))
    await waitFor(() =>{  expect(writeFile).toHaveBeenCalledWith('/projects/one', 'notes.txt', { content: 'edited' }) })
  })

  it('clears the file search through the SVG clear affordance', async () => {
    mountPanel()
    const input = await screen.findByTestId('aida-canvas-search')
    fireEvent.change(input, { target: { value: 'notes' } })
    const clear = screen.getByLabelText('全部关闭')
    expect(clear.querySelectorAll('svg')).toHaveLength(1)
    fireEvent.click(clear)
    expect((screen.getByTestId('aida-canvas-search') as HTMLInputElement).value).toBe('')
  })

  it('closes an open file tab through its SVG close affordance', async () => {
    const { store } = mountPanel({ listing: listing(textFile('notes.txt', 'hello').node) })
    fireEvent.click(await screen.findByText('notes.txt'))
    await screen.findByTestId('aida-canvas-preview')
    const close = screen.getByLabelText('关闭 notes.txt')
    expect(close.querySelectorAll('svg')).toHaveLength(1)
    fireEvent.click(close)
    expect(store.store.getSnapshot().openTabs).not.toContain('notes.txt')
  })

  it('mounts the DSH TrajectoryView boundary inside Canvas', async () => {
    const downloadSessionLog = vi.fn(async () => {})
    mountPanel({ snapshot: snapshot(), downloadSessionLog })
    fireEvent.click(await screen.findByText('轨迹'))
    const host = await screen.findByTestId('aida-canvas-trajectory')
    expect(host.querySelector('[data-conversation-composer-overlay]')).toBeTruthy()
    const download = screen.getByTestId('aida-canvas-session-log-download')
    expect(download.querySelector('svg')?.getAttribute('class')).toContain('lucide-download')
    fireEvent.click(download)
    expect(downloadSessionLog).toHaveBeenCalledTimes(1)
  })
  it('maximizes over the conversation area and restores on the second click', async () => {
    const { store } = mountPanel()
    const panel = screen.getByTestId('aida-canvas-panel')
    expect(store.store.getSnapshot().maximized).toBe(false)
    expect(panel.className).not.toContain('maximized')

    const maximize = screen.getByTestId('aida-canvas-maximize')
    // The fullscreen control is a proper SVG icon at the panel's top right.
    expect(maximize.querySelectorAll('svg')).toHaveLength(1)
    fireEvent.click(maximize)
    expect(store.store.getSnapshot().maximized).toBe(true)
    expect(panel.className).toContain('maximized')
    // Restore state flips the fullscreen glyph.
    expect(maximize.querySelector('svg')?.getAttribute('class')).toContain('lucide-minimize-2')

    fireEvent.click(maximize)
    expect(store.store.getSnapshot().maximized).toBe(false)
    expect(panel.className).not.toContain('maximized')
  })

  it('recomputes the maximized grid override when the window resizes', async () => {
    // The frame lookup walks up from the panel to the nearest element with an
    // inline grid; document.body plays the frame here.
    const body = document.body
    body.style.gridTemplateColumns = '280px 1fr 360px'
    const { unmount } = mountPanel()
    try {
      fireEvent.click(await screen.findByTestId('aida-canvas-maximize'))
      await waitFor(() =>{  expect(body.dataset.aidaCanvasMaximized).toBe('true') })
      expect(body.style.getPropertyValue('--aida-canvas-cols')).toBe('0px 0px 0px')
      // A window resize recomputes the override from the live frame geometry.
      Object.defineProperty(body, 'getBoundingClientRect', { value: () => ({ width: 1800 }), configurable: true })
      fireEvent(window, new Event('resize'))
      expect(body.style.getPropertyValue('--aida-canvas-cols')).toBe('0px 0px 1800px')
    } finally {
      delete (body as { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect
      body.removeAttribute('data-aida-canvas-maximized')
      body.style.removeProperty('--aida-canvas-cols')
      body.style.removeProperty('grid-template-columns')
      unmount()
    }
  })

  it('declines to render without a session workspace', () => {
    const sessions = createSnapshotStore<SessionListState>({
      ...sessionsState(),
      byId: {},
    })
    const snap = snapshot()
    const store = createAidaCanvasStore().create()
    const props = {
      useSessions: bindSnapshotSelector(sessions) as never,
      useSession: ((selector: (snapshot: ConversationSnapshot | undefined) => unknown) => selector(snap)) as never,
      useProjection: (() => undefined) as never,
      useInput: (() => ({ draft: '', draftRev: 0 })) as never,
      inputActions: { setDraft: vi.fn(), addImages: vi.fn(), removeImage: vi.fn(), pruneImages: vi.fn(), submit: vi.fn() } as never,
      useWorkspaces: (() => undefined) as never,
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      listFiles: vi.fn() as never,
      readFile: vi.fn() as never,
      writeFile: vi.fn() as never,
      renameFile: vi.fn() as never,
      moveFile: vi.fn() as never,
      deleteFile: vi.fn() as never,
      closeCanvas: vi.fn() as never,
      trajectoryView: TrajectoryView,
      useTrajectoryDuration: bindSnapshotSelector(createSnapshotStore(false)) as never,
      loadTrajectoryOlder: vi.fn(async () => false) as never,
      setTrajectoryActualDuration: vi.fn() as never,
      trajectoryT: ((key: string) => key) as never,
      downloadSessionLog: vi.fn(async () => {}),
      mentionFile: vi.fn() as never,
      quoteSelection: vi.fn() as never,
      t,
    }
    // A session without a workspace root renders the empty state.
    render(<AidaCanvasPanel {...props} sessionId={SID} />)
    expect(screen.getByText('当前会话没有项目')).toBeTruthy()
    cleanup()
    // No current session at all renders the same empty state.
    render(<AidaCanvasPanel {...props} sessionId={undefined as never} />)
    expect(screen.getByText('当前会话没有项目')).toBeTruthy()
  })

  it('renames a file through the row actions menu', async () => {
    const { renameFile } = mountPanel()
    await screen.findByText('README.md')
    fireEvent.click(screen.getAllByTestId('aida-canvas-row-actions')[0]!)
    fireEvent.click(screen.getByText('重命名'))
    const input = screen.getByTestId('aida-canvas-rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'renamed.md' } })
    fireEvent.click(screen.getByTestId('aida-canvas-rename-submit'))
    await waitFor(() =>{  expect(renameFile).toHaveBeenCalledWith('/projects/one', 'README.md', 'renamed.md') })
  })

  it('opens the row action menu from a right-click on the row', async () => {
    const { renameFile } = mountPanel()
    const row = await screen.findByRole('treeitem', { name: /README/ })
    fireEvent.contextMenu(row)
    fireEvent.click(await screen.findByText('重命名'))
    const input = screen.getByTestId('aida-canvas-rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'right.md' } })
    fireEvent.click(screen.getByTestId('aida-canvas-rename-submit'))
    await waitFor(() =>{  expect(renameFile).toHaveBeenCalledWith('/projects/one', 'README.md', 'right.md') })
  })

  it('deletes a file through the row actions menu', async () => {
    const { deleteFile } = mountPanel()
    await screen.findByText('README.md')
    fireEvent.click(screen.getAllByTestId('aida-canvas-row-actions')[0]!)
    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getByTestId('aida-canvas-delete-confirm'))
    await waitFor(() =>{  expect(deleteFile).toHaveBeenCalledWith('/projects/one', 'README.md') })
  })

  it('mentions a text file into the composer from the row actions menu', async () => {
    const { mentionFile } = mountPanel()
    await screen.findByText('README.md')
    fireEvent.click(screen.getAllByTestId('aida-canvas-row-actions')[0]!)
    fireEvent.click(screen.getByText('引用到输入框'))
    expect(mentionFile).toHaveBeenCalledWith('README.md')
  })

  it('omits the mention action for non-text files', async () => {
    const listingWithBinary = listing(
      { name: 'data.xlsx', path: 'data.xlsx', kind: 'office', size: 10 },
      textFile('README.md', '# Hello').node,
    )
    mountPanel({ listing: listingWithBinary })
    await screen.findByText('data.xlsx')
    fireEvent.click(screen.getAllByTestId('aida-canvas-row-actions')[0]!)
    expect(screen.queryByText('引用到输入框')).toBeNull()
  })

  it('mentions the whole file when the quote button has no selection', async () => {
    const { mentionFile, quoteSelection } = mountPanel({
      listing: listing(textFile('notes.txt', 'hello text').node),
      reads: { 'notes.txt': { path: 'notes.txt', content: 'hello text', truncated: false, totalBytes: 10 } },
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByText('notes.txt'))
    await screen.findByTestId('aida-canvas-preview')
    // A prior test may leave a stale range in the jsdom selection; clear it so
    // the empty-selection fallback path runs.
    window.getSelection()?.removeAllRanges()
    fireEvent.click(screen.getByTestId('aida-canvas-quote'))
    expect(quoteSelection).not.toHaveBeenCalled()
    expect(mentionFile).toHaveBeenCalledWith('notes.txt')
  })

  it('quotes the edit-area selection into the composer', async () => {
    const { quoteSelection } = mountPanel({
      listing: listing(textFile('notes.txt', 'hello text').node),
      reads: { 'notes.txt': { path: 'notes.txt', content: 'hello text', truncated: false, totalBytes: 10 } },
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByText('notes.txt'))
    await screen.findByTestId('aida-canvas-preview')
    fireEvent.click(screen.getByTestId('aida-canvas-edit-toggle'))
    const editor = screen.getByTestId('aida-canvas-edit') as HTMLTextAreaElement
    editor.focus()
    editor.setSelectionRange(0, 5)
    fireEvent.mouseDown(screen.getByTestId('aida-canvas-quote'))
    fireEvent.click(screen.getByTestId('aida-canvas-quote'))
    expect(quoteSelection).toHaveBeenCalledWith('notes.txt', 'hello')
  })

  it('quotes the rendered-preview selection into the composer', async () => {
    const { quoteSelection } = mountPanel({
      listing: listing(textFile('notes.txt', 'hello text').node),
      reads: { 'notes.txt': { path: 'notes.txt', content: 'hello text', truncated: false, totalBytes: 10 } },
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByText('notes.txt'))
    const preview = await screen.findByTestId('aida-canvas-preview')
    const range = document.createRange()
    range.selectNodeContents(preview)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.mouseDown(screen.getByTestId('aida-canvas-quote'))
    fireEvent.click(screen.getByTestId('aida-canvas-quote'))
    expect(quoteSelection).toHaveBeenCalledWith('notes.txt', 'hello text')
  })

  it('renders Office workbook previews as sheet tables', async () => {
    const workbook = JSON.stringify({
      __office: 'workbook',
      sheets: [{ name: 'Sheet1', rows: [['a', 'b'], ['1', '2']] }],
    })
    const { listFiles } = mountPanel({
      listing: listing({ name: 'data.xlsx', path: 'data.xlsx', kind: 'office', size: workbook.length }),
      reads: { 'data.xlsx': { path: 'data.xlsx', content: workbook, truncated: false, totalBytes: workbook.length } },
    })
    await screen.findByText('data.xlsx')
    fireEvent.click(screen.getByText('data.xlsx'))
    const sheet = await screen.findByTestId('aida-canvas-sheet')
    expect(sheet.textContent).toContain('Sheet1')
    expect(sheet.textContent).toContain('1')
    expect(sheet.textContent).toContain('2')
    expect(listFiles).toHaveBeenCalled()
  })

  it('renders markdown files as formatted documents with an edit mode', async () => {
    const source = '# Title\n\n- one\n- two\n'
    const { readFile } = mountPanel({
      listing: listing(textFile('README.md', source).node),
      reads: { 'README.md': { path: 'README.md', content: source, truncated: false, totalBytes: source.length } },
    })
    await screen.findByText('README.md')
    fireEvent.click(screen.getByText('README.md'))
    const doc = await screen.findByTestId('aida-canvas-markdown')
    expect(doc.querySelector('h1')?.textContent).toBe('Title')
    expect(readFile).toHaveBeenCalled()
    // Editing switches to the source textarea (preview/source toggle).
    fireEvent.click(screen.getByTestId('aida-canvas-edit-toggle'))
    expect(screen.getByTestId('aida-canvas-edit')).toBeTruthy()
  })

  it('renders HTML files in a sandboxed iframe', async () => {
    const source = '<h1>Hello</h1><script>window.pwned = true</script>'
    mountPanel({
      listing: listing(textFile('page.html', source).node),
      reads: { 'page.html': { path: 'page.html', content: source, truncated: false, totalBytes: source.length } },
    })
    await screen.findByText('page.html')
    fireEvent.click(screen.getByText('page.html'))
    const stage = await screen.findByTestId('aida-canvas-html')
    const frame = stage.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('srcdoc')).toContain('<h1>Hello</h1>')
  })

  it('renders mermaid files through the diagram stage', async () => {
    const source = 'flowchart LR\n  A --> B\n'
    mountPanel({
      listing: listing(textFile('flow.mmd', source).node),
      reads: { 'flow.mmd': { path: 'flow.mmd', content: source, truncated: false, totalBytes: source.length } },
    })
    await screen.findByText('flow.mmd')
    fireEvent.click(screen.getByText('flow.mmd'))
    // The mermaid runtime is lazily imported; jsdom may surface the fallback,
    // but the diagram surface (stage or error fallback) must mount. The lazy
    // import is slow under coverage instrumentation, so the wait outlives the
    // default test timeout.
    await waitFor(() => {
      expect(screen.getByTestId('aida-canvas-mermaid') || screen.getByTestId('aida-canvas-mermaid-error')).toBeTruthy()
    }, { timeout: 20000 })
  }, 25000)

  it('shows the tree error when the workspace listing fails', async () => {
    mountPanel({ listFiles: vi.fn(async () => { throw new Error('listing boom') }) })
    expect(await screen.findByText('listing boom')).toBeTruthy()
  }, 15000)

  it('opens a file nested inside a folder and collapses the folder', async () => {
    const tree = listing(
      { name: 'src', path: 'src', kind: 'folder', children: [textFile('src/app.ts', 'const x = 1').node] },
      textFile('README.md', '# Hello').node,
    )
    mountPanel({
      listing: tree,
      reads: { 'src/app.ts': { path: 'src/app.ts', content: 'const x = 1', truncated: false, totalBytes: 11 } },
    })
    const folderRow = await screen.findByRole('treeitem', { name: /src/ })
    fireEvent.click(folderRow)
    expect(screen.queryByText('app.ts')).toBeNull()
    fireEvent.click(folderRow)
    fireEvent.click(await screen.findByText('app.ts'))
    const preview = await screen.findByTestId('aida-canvas-code')
    expect(preview.textContent).toContain('const x = 1')
  })

  it('shows the read error when the file read fails', async () => {
    mountPanel({
      listing: listing(textFile('notes.txt', 'x').node),
      readFile: vi.fn(async () => { throw new Error('read boom') }),
    })
    fireEvent.click(await screen.findByText('notes.txt'))
    expect(await screen.findByText('read boom')).toBeTruthy()
  })

  it('guards against a second save while one is in flight', async () => {
    let release: (value: WorkspaceFileWrite) => void = () => {}
    const writeFile = vi.fn(() => new Promise<WorkspaceFileWrite>((resolve) => { release = resolve }))
    mountPanel({
      listing: listing(textFile('notes.txt', 'hello').node),
      writeFile,
    })
    fireEvent.click(await screen.findByText('notes.txt'))
    await screen.findByTestId('aida-canvas-preview')
    fireEvent.click(screen.getByTestId('aida-canvas-edit-toggle'))
    fireEvent.click(screen.getByTestId('aida-canvas-save'))
    await waitFor(() =>{  expect(writeFile).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByTestId('aida-canvas-save'))
    expect(writeFile).toHaveBeenCalledTimes(1)
    act(() => { release({ path: 'notes.txt' }) })
  })

  it('reports a failed save', async () => {
    mountPanel({
      listing: listing(textFile('notes.txt', 'hello').node),
      writeFile: vi.fn(async () => { throw new Error('write boom') }),
    })
    fireEvent.click(await screen.findByText('notes.txt'))
    await screen.findByTestId('aida-canvas-preview')
    fireEvent.click(screen.getByTestId('aida-canvas-edit-toggle'))
    fireEvent.click(screen.getByTestId('aida-canvas-save'))
    expect(await screen.findByText('write boom')).toBeTruthy()
  })

  it('imports dropped files: text content, binary base64, and the drag overlay', async () => {
    const { writeFile, listFiles } = mountPanel()
    await screen.findByText('README.md')
    const panel = screen.getByTestId('aida-canvas-panel')
    const textFile2 = new File(['hello world'], 'a.txt', { type: 'text/plain' })
    const binaryFile = new File([new Uint8Array([0, 104, 105])], 'bin.dat', { type: 'application/octet-stream' })

    fireEvent.dragEnter(panel, { dataTransfer: { types: ['Files'], files: [] } })
    expect(screen.getAllByText('导入')).toHaveLength(2)
    fireEvent.dragOver(panel, { dataTransfer: { types: ['Files'], files: [] } })
    fireEvent.dragLeave(panel, { dataTransfer: { types: ['Files'], files: [] } })
    expect(screen.getAllByText('导入')).toHaveLength(1)
    // A drop without Files data is ignored.
    fireEvent.dragEnter(panel, { dataTransfer: { types: ['Text'], files: [] } })
    expect(screen.getAllByText('导入')).toHaveLength(1)
    fireEvent.dragOver(panel, { dataTransfer: { types: ['Text'], files: [] } })
    fireEvent.dragLeave(panel, { dataTransfer: { types: ['Text'], files: [] } })
    fireEvent.drop(panel, { dataTransfer: { types: ['Text'], files: [] } })
    expect(writeFile).not.toHaveBeenCalled()

    fireEvent.drop(panel, { dataTransfer: { types: ['Files'], files: [textFile2, binaryFile] } })
    await waitFor(() =>{  expect(writeFile).toHaveBeenCalledTimes(2) })
    expect(writeFile).toHaveBeenNthCalledWith(1, '/projects/one', 'a.txt', { content: 'hello world' }, expect.any(AbortSignal))
    const base64Call = writeFile.mock.calls[1] as [string, string, { base64: string }, AbortSignal]
    expect(base64Call[1]).toBe('bin.dat')
    expect(typeof base64Call[2].base64).toBe('string')
    expect(await screen.findByText('已导入 2 个文件')).toBeTruthy()
    // The tree refetches after the import.
    await waitFor(() =>{  expect(listFiles.mock.calls.length).toBeGreaterThanOrEqual(2) })
  })

  it('imports picked files and folders through the hidden inputs', async () => {
    const { writeFile } = mountPanel()
    await screen.findByText('README.md')
    // The toolbar and menu buttons drive the hidden pickers.
    fireEvent.click(screen.getByTestId('aida-canvas-import'))
    fireEvent.click(screen.getByText('导入文件'))
    fireEvent.click(screen.getByText('导入文件夹'))
    const picked = new File(['picked'], 'picked.md', { type: 'text/markdown' })
    const fileInput = screen.getByTestId('aida-canvas-file-input')
    Object.defineProperty(fileInput, 'files', { value: [picked] })
    fireEvent.change(fileInput)
    await waitFor(() =>{  expect(writeFile).toHaveBeenCalledWith('/projects/one', 'picked.md', { content: 'picked' }, expect.any(AbortSignal)) })

    const folderFile = new File(['deep'], 'deep.ts', { type: 'text/plain' })
    Object.defineProperty(folderFile, 'webkitRelativePath', { value: 'src/deep.ts' })
    const folderInput = screen.getByTestId('aida-canvas-folder-input')
    Object.defineProperty(folderInput, 'files', { value: [folderFile] })
    fireEvent.change(folderInput)
    await waitFor(() =>{  expect(writeFile).toHaveBeenCalledWith('/projects/one', 'src/deep.ts', { content: 'deep' }, expect.any(AbortSignal)) })
  })

  it('reports the import progress and keeps going when one import fails', async () => {
    const { writeFile } = mountPanel()
    await screen.findByText('README.md')
    const good = new File(['ok'], 'good.txt', { type: 'text/plain' })
    const bad = new File(['no'], 'bad.txt', { type: 'text/plain' })
    writeFile
      .mockResolvedValueOnce({ path: 'good.txt' })
      .mockRejectedValueOnce(new Error('import boom'))
    fireEvent.drop(screen.getByTestId('aida-canvas-panel'), { dataTransfer: { types: ['Files'], files: [good, bad] } })
    expect(await screen.findByText('正在导入 1/2：bad.txt')).toBeTruthy()
    expect(await screen.findByText('已导入 1 个文件 · 失败 1 个')).toBeTruthy()
  })

  it('aborts an in-flight upload when the canvas session unmounts', async () => {
    const writeFile = vi.fn((_root: string, _path: string, _input: object, signal?: AbortSignal) => new Promise<WorkspaceFileWrite>((_resolve, reject) => {
      signal?.addEventListener('abort', () =>{  reject(new DOMException('aborted', 'AbortError')) }, { once: true })
    }))
    const { unmount } = mountPanel({ writeFile })
    await screen.findByText('README.md')
    const file = new File(['pending'], 'pending.txt', { type: 'text/plain' })
    fireEvent.drop(screen.getByTestId('aida-canvas-panel'), { dataTransfer: { types: ['Files'], files: [file] } })
    await waitFor(() =>{  expect(writeFile).toHaveBeenCalledTimes(1) })
    const signal = writeFile.mock.calls[0]?.[3]
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('refreshes the tree from the footer', async () => {
    const { listFiles } = mountPanel()
    await screen.findByText('README.md')
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() =>{  expect(listFiles.mock.calls.length).toBeGreaterThanOrEqual(2) })
    await screen.findByText('README.md')
  })

  it('opens an SVG document, edits its source, and saves the text back', async () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>'
    const base64 = bytesToBase64(new TextEncoder().encode(source))
    const { writeFile } = mountPanel({
      listing: listing({ name: 'diagram.svg', path: 'diagram.svg', kind: 'image', size: source.length }),
      reads: {
        'diagram.svg': { path: 'diagram.svg', base64, contentType: 'image/svg+xml', truncated: false, totalBytes: source.length },
      },
    })
    await screen.findByText('diagram.svg')
    fireEvent.click(screen.getByText('diagram.svg'))
    // The rendered image preview consumes the base64 payload.
    const img = await screen.findByAltText('diagram.svg')
    expect(img.getAttribute('src')).toBe('blob:fake')
    // The edit toggle opens the decoded UTF-8 source in the textarea.
    fireEvent.click(screen.getByTestId('aida-canvas-edit-toggle'))
    const editor = screen.getByTestId('aida-canvas-edit') as HTMLTextAreaElement
    expect(editor.value).toBe(source)
    const edited = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>'
    fireEvent.change(editor, { target: { value: edited } })
    fireEvent.click(screen.getByTestId('aida-canvas-save'))
    await waitFor(() =>{  expect(writeFile).toHaveBeenCalledWith('/projects/one', 'diagram.svg', { content: edited }) })
    // The saved source stays in the edit buffer (still in edit mode).
    expect((screen.getByTestId('aida-canvas-edit') as HTMLTextAreaElement).value).toBe(edited)
  })

  it('renders JSON and CSV files through the format-aware preview', async () => {
    mountPanel({
      listing: listing(
        textFile('data.json', '{"a": 1}').node,
        textFile('data.csv', 'a,b\n1,2').node,
      ),
      reads: {
        'data.json': { path: 'data.json', content: '{"a": 1}', truncated: false, totalBytes: 9 },
        'data.csv': { path: 'data.csv', content: 'a,b\n1,2', truncated: false, totalBytes: 6 },
      },
    })
    await screen.findByText('data.json')
    fireEvent.click(screen.getByText('data.json'))
    expect(await screen.findByTestId('aida-canvas-json')).toBeTruthy()
    // Back to the Files tab to open the CSV row.
    fireEvent.click(screen.getByText('文件'))
    fireEvent.click(await screen.findByText('data.csv'))
    expect(await screen.findByTestId('aida-canvas-csv')).toBeTruthy()
  })

  it('multi-selects rows with Ctrl+click and batch-mentions the text leaves', async () => {
    const { store, mentionFile } = mountPanel({
      listing: listing(
        textFile('a.txt', 'a').node,
        textFile('b.md', 'b').node,
        { name: 'img.png', path: 'img.png', kind: 'image', size: 4 },
      ),
    })
    await screen.findByText('a.txt')
    fireEvent.click(screen.getByText('a.txt'), { ctrlKey: true })
    fireEvent.click(screen.getByText('b.md'), { ctrlKey: true })
    fireEvent.click(screen.getByText('img.png'), { ctrlKey: true })
    const batch = await screen.findByTestId('aida-canvas-batch')
    expect(batch.textContent).toContain('已选择 3 个文件')
    expect(store.store.getSnapshot().selected).toEqual(['a.txt', 'b.md', 'img.png'])
    // The batch mention covers only the selected text leaves.
    fireEvent.click(screen.getByTestId('aida-canvas-batch-mention'))
    expect(mentionFile).toHaveBeenCalledWith('a.txt')
    expect(mentionFile).toHaveBeenCalledWith('b.md')
    expect(mentionFile).not.toHaveBeenCalledWith('img.png')
    // The batch action clears the selection.
    expect(screen.queryByTestId('aida-canvas-batch')).toBeNull()
  })

  it('batch-opens the selected files and batch-deletes with a confirmation step', async () => {
    const { store, deleteFile } = mountPanel({
      listing: listing(
        textFile('a.txt', 'a').node,
        textFile('b.md', 'b').node,
      ),
    })
    await screen.findByText('a.txt')
    fireEvent.click(screen.getByText('a.txt'), { ctrlKey: true })
    fireEvent.click(screen.getByText('b.md'), { ctrlKey: true })
    fireEvent.click(screen.getByTestId('aida-canvas-batch-open'))
    expect(store.store.getSnapshot().openTabs).toEqual(['a.txt', 'b.md'])
    expect(store.store.getSnapshot().selected).toEqual([])

    // Select again; the delete requires an explicit confirmation.
    fireEvent.click(screen.getByText('文件'))
    fireEvent.click(await screen.findByText('a.txt'), { ctrlKey: true })
    fireEvent.click(screen.getByText('b.md'), { ctrlKey: true })
    fireEvent.click(screen.getByTestId('aida-canvas-batch-delete'))
    expect(deleteFile).not.toHaveBeenCalled()
    expect(screen.getByTestId('aida-canvas-batch').textContent).toContain('确定删除这 2 个文件吗？')
    fireEvent.click(screen.getByTestId('aida-canvas-batch-delete-confirm'))
    await waitFor(() =>{  expect(deleteFile).toHaveBeenCalledWith('/projects/one', 'a.txt') })
    expect(deleteFile).toHaveBeenCalledWith('/projects/one', 'b.md')
    await waitFor(() =>{  expect(screen.queryByTestId('aida-canvas-batch')).toBeNull() })
    expect(await screen.findByText('已删除 2 个文件')).toBeTruthy()
  })

  it('selects a range with Shift+click and clears it on a plain click', async () => {
    const { store } = mountPanel({
      listing: listing(
        textFile('a.txt', 'a').node,
        textFile('b.md', 'b').node,
        textFile('c.ts', 'c').node,
      ),
    })
    await screen.findByText('a.txt')
    fireEvent.click(screen.getByText('a.txt'), { ctrlKey: true })
    fireEvent.click(screen.getByText('c.ts'), { shiftKey: true })
    expect(store.store.getSnapshot().selected).toEqual(['a.txt', 'b.md', 'c.ts'])
    // A plain click opens the file and clears the selection.
    fireEvent.click(screen.getByText('a.txt'))
    expect(store.store.getSnapshot().openTabs).toEqual(['a.txt'])
    expect(store.store.getSnapshot().selected).toEqual([])
  })

  it('reports a mixed batch delete failure', async () => {
    mountPanel({
      listing: listing(
        textFile('a.txt', 'a').node,
        textFile('b.md', 'b').node,
      ),
      deleteFile: vi.fn()
        .mockResolvedValueOnce({ path: 'a.txt' })
        .mockRejectedValueOnce(new Error('delete boom')),
    })
    await screen.findByText('a.txt')
    fireEvent.click(screen.getByText('a.txt'), { ctrlKey: true })
    fireEvent.click(screen.getByText('b.md'), { ctrlKey: true })
    fireEvent.click(screen.getByTestId('aida-canvas-batch-delete'))
    fireEvent.click(screen.getByTestId('aida-canvas-batch-delete-confirm'))
    expect(await screen.findByText('已删除 1 个文件，失败 1 个')).toBeTruthy()
  })

  it('moves a file by dropping it onto a folder row', async () => {
    const { moveFile } = mountPanel({
      listing: listing(
        { name: 'docs', path: 'docs', kind: 'folder', children: [] },
        textFile('notes.txt', 'hello').node,
      ),
      moveFile: vi.fn(async (_root: string, _path: string, targetPath: string) => ({ path: targetPath })),
    })
    await screen.findByText('notes.txt')
    const leaf = await screen.findByRole('treeitem', { name: /notes/ })
    const folder = await screen.findByRole('treeitem', { name: /docs/ })
    const dataTransfer = {
      types: [FILE_DRAG_TYPE],
      setData: vi.fn(),
      getData: vi.fn(() => 'notes.txt'),
      dropEffect: 'none',
    } as never
    fireEvent.dragStart(leaf, { dataTransfer })
    fireEvent.dragOver(folder, { dataTransfer })
    fireEvent.drop(folder, { dataTransfer })
    await waitFor(() =>{  expect(moveFile).toHaveBeenCalledWith('/projects/one', 'notes.txt', 'docs/notes.txt') })
    expect(await screen.findByText('已移动 notes.txt')).toBeTruthy()
  })

  it('moves a file to the workspace root on a blank-area drop and reports failures', async () => {
    const { moveFile } = mountPanel({
      listing: listing(
        { name: 'docs', path: 'docs', kind: 'folder', children: [textFile('docs/notes.txt', 'hello').node] },
      ),
      moveFile: vi.fn()
        .mockResolvedValueOnce({ path: 'notes.txt' })
        .mockRejectedValueOnce(new Error('move boom')),
    })
    await screen.findByText('docs')
    const leaf = await screen.findByRole('treeitem', { name: /notes/ })
    const tree = screen.getByRole('tree')
    const dataTransfer = {
      types: [FILE_DRAG_TYPE],
      setData: vi.fn(),
      getData: vi.fn(() => 'docs/notes.txt'),
      dropEffect: 'none',
    } as never
    fireEvent.dragStart(leaf, { dataTransfer })
    fireEvent.dragOver(tree, { dataTransfer })
    fireEvent.drop(tree, { dataTransfer })
    await waitFor(() =>{  expect(moveFile).toHaveBeenCalledWith('/projects/one', 'docs/notes.txt', 'notes.txt') })
    expect(await screen.findByText('已移动 notes.txt')).toBeTruthy()
    // A failing move surfaces the error through the notice.
    fireEvent.dragStart(leaf, { dataTransfer })
    fireEvent.dragOver(tree, { dataTransfer })
    fireEvent.drop(tree, { dataTransfer })
    expect(await screen.findByText('move boom')).toBeTruthy()
  })

  it('skips a drop whose destination equals the source', async () => {
    const { moveFile } = mountPanel({
      listing: listing(textFile('notes.txt', 'hello').node),
    })
    await screen.findByText('notes.txt')
    const tree = screen.getByRole('tree')
    const dataTransfer = {
      types: [FILE_DRAG_TYPE],
      setData: vi.fn(),
      getData: vi.fn(() => 'notes.txt'),
      dropEffect: 'none',
    } as unknown as DataTransfer
    fireEvent.dragStart(await screen.findByRole('treeitem', { name: /notes/ }), { dataTransfer })
    fireEvent.drop(tree, { dataTransfer })
    expect(moveFile).not.toHaveBeenCalled()
  })

  it('ignores foreign drags and empty-path drops on the tree blank area', async () => {
    const { moveFile } = mountPanel({
      listing: listing(textFile('notes.txt', 'hello').node),
    })
    await screen.findByText('notes.txt')
    const tree = screen.getByRole('tree')
    const foreign = { types: ['text/plain'], setData: vi.fn(), getData: vi.fn(() => '') } as unknown as DataTransfer
    fireEvent.dragOver(tree, { dataTransfer: foreign })
    fireEvent.drop(tree, { dataTransfer: foreign })
    expect(moveFile).not.toHaveBeenCalled()
    const empty = {
      types: [FILE_DRAG_TYPE],
      setData: vi.fn(),
      getData: vi.fn(() => ''),
      dropEffect: 'none',
    } as unknown as DataTransfer
    fireEvent.drop(tree, { dataTransfer: empty })
    expect(moveFile).not.toHaveBeenCalled()
  })

  it('clears the batch selection through the batch bar and cancels the delete confirm', async () => {
    const { store, deleteFile } = mountPanel({
      listing: listing(
        textFile('a.txt', 'a').node,
        textFile('b.md', 'b').node,
      ),
    })
    await screen.findByText('a.txt')
    fireEvent.click(screen.getByText('a.txt'), { ctrlKey: true })
    fireEvent.click(screen.getByText('b.md'), { ctrlKey: true })
    // The cancel button of the confirm step returns to the plain bar.
    fireEvent.click(screen.getByTestId('aida-canvas-batch-delete'))
    fireEvent.click(screen.getByTestId('aida-canvas-batch-cancel'))
    expect(deleteFile).not.toHaveBeenCalled()
    expect(screen.queryByText('确定删除这 2 个文件吗？')).toBeNull()
    // The clear button empties the selection and hides the bar.
    fireEvent.click(screen.getByTestId('aida-canvas-batch-clear'))
    expect(store.store.getSnapshot().selected).toEqual([])
    expect(screen.queryByTestId('aida-canvas-batch')).toBeNull()
  })

  it('keeps the row menu open when a right-click lands inside the popover', async () => {
    const { renameFile } = mountPanel()
    await screen.findByText('README.md')
    fireEvent.click(screen.getAllByTestId('aida-canvas-row-actions')[0]!)
    const popover = await screen.findByTestId('aida-canvas-row-menu')
    fireEvent.contextMenu(popover)
    // The menu survives the inner right-click and still works.
    fireEvent.click(screen.getByText('重命名'))
    const input = screen.getByTestId('aida-canvas-rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'kept.md' } })
    fireEvent.click(screen.getByTestId('aida-canvas-rename-submit'))
    await waitFor(() =>{  expect(renameFile).toHaveBeenCalledWith('/projects/one', 'README.md', 'kept.md') })
  })

  it('omits the mention action for SVG rows', async () => {
    mountPanel({ listing: listing({ name: 'diagram.svg', path: 'diagram.svg', kind: 'image', size: 10 }) })
    await screen.findByText('diagram.svg')
    fireEvent.click(screen.getAllByTestId('aida-canvas-row-actions')[0]!)
    expect(screen.queryByText('引用到输入框')).toBeNull()
  })

  it('renames a file with the Enter key and reports a rename failure', async () => {
    const { renameFile } = mountPanel({ renameFile: vi.fn(async () => { throw new Error('rename boom') }) })
    await screen.findByText('README.md')
    fireEvent.click(screen.getAllByTestId('aida-canvas-row-actions')[0]!)
    fireEvent.click(screen.getByText('重命名'))
    const input = screen.getByTestId('aida-canvas-rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'entered.md' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>{  expect(renameFile).toHaveBeenCalledWith('/projects/one', 'README.md', 'entered.md') })
    expect(await screen.findByText('rename boom')).toBeTruthy()
  })

  it('reports a delete failure', async () => {
    mountPanel({ deleteFile: vi.fn(async () => { throw new Error('delete boom') }) })
    await screen.findByText('README.md')
    fireEvent.click(screen.getAllByTestId('aida-canvas-row-actions')[0]!)
    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getByTestId('aida-canvas-delete-confirm'))
    expect(await screen.findByText('delete boom')).toBeTruthy()
  })

  it('reopens and closes the row-actions menu from its button', async () => {
    mountPanel()
    await screen.findByText('README.md')
    const actions = screen.getAllByTestId('aida-canvas-row-actions')[0]!
    fireEvent.click(actions)
    expect(screen.getByTestId('aida-canvas-row-menu')).toBeTruthy()
    fireEvent.click(actions)
    expect(screen.queryByTestId('aida-canvas-row-menu')).toBeNull()
    fireEvent.click(actions)
    expect(screen.getByTestId('aida-canvas-row-menu')).toBeTruthy()
  })

  it('switches the active file via the file tabs and closes all of them', async () => {
    const { store } = mountPanel({
      listing: listing(textFile('a.txt', 'AAA').node, textFile('b.txt', 'BBB').node),
    })
    fireEvent.click(await screen.findByText('a.txt'))
    await screen.findByTestId('aida-canvas-preview')
    // Back to the tree for the second file, then the tab label switches back.
    fireEvent.click(screen.getByRole('tab', { name: /^文件/ }))
    fireEvent.click(await screen.findByText('b.txt'))
    await waitFor(() =>{  expect(store.store.getSnapshot().activePath).toBe('b.txt') })
    fireEvent.click(screen.getByRole('tab', { name: /a\.txt/ }))
    await waitFor(() =>{  expect(store.store.getSnapshot().activePath).toBe('a.txt') })
    fireEvent.click(screen.getByText('全部关闭'))
    expect(await screen.findByText('没有打开的文件')).toBeTruthy()
    // The explicit tab buttons switch the panel surface directly.
    fireEvent.click(screen.getByRole('tab', { name: /^文件/ }))
    expect(await screen.findByText('b.txt')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /^画布/ }))
    expect(await screen.findByText('没有打开的文件')).toBeTruthy()
  })

  it('mentions the whole file when the edit area holds no selection', async () => {
    const { mentionFile } = mountPanel({
      listing: listing(textFile('notes.txt', 'hello text').node),
      reads: { 'notes.txt': { path: 'notes.txt', content: 'hello text', truncated: false, totalBytes: 10 } },
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByText('notes.txt'))
    await screen.findByTestId('aida-canvas-preview')
    fireEvent.click(screen.getByTestId('aida-canvas-edit-toggle'))
    const editor = screen.getByTestId('aida-canvas-edit') as HTMLTextAreaElement
    editor.focus()
    editor.setSelectionRange(0, 0)
    fireEvent.click(screen.getByTestId('aida-canvas-quote'))
    expect(mentionFile).toHaveBeenCalledWith('notes.txt')
  })

  it('shows the mention-busy notice when quoting or mentioning fails', async () => {
    mountPanel({
      listing: listing(textFile('notes.txt', 'hello text').node),
      reads: { 'notes.txt': { path: 'notes.txt', content: 'hello text', truncated: false, totalBytes: 10 } },
      quoteSelection: vi.fn(() => false),
      mentionFile: vi.fn(() => false),
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByText('notes.txt'))
    const preview = await screen.findByTestId('aida-canvas-preview')
    const range = document.createRange()
    range.selectNodeContents(preview)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.click(screen.getByTestId('aida-canvas-quote'))
    expect(await screen.findByText('当前输入框不可用，请稍后再试')).toBeTruthy()
    fireEvent.click(screen.getByTestId('aida-canvas-quote'))
    expect(screen.getAllByText('当前输入框不可用，请稍后再试').length).toBeGreaterThanOrEqual(1)
  })

  it('clears the notice after its timeout', async () => {
    mountPanel({ mentionFile: vi.fn(() => false) })
    await screen.findByText('README.md')
    fireEvent.click(screen.getAllByTestId('aida-canvas-row-actions')[0]!)
    fireEvent.click(screen.getByText('引用到输入框'))
    expect(await screen.findByText('当前输入框不可用，请稍后再试')).toBeTruthy()
    await waitFor(() =>{  expect(screen.queryByText('当前输入框不可用，请稍后再试')).toBeNull() }, { timeout: 4000 })
  })

  it('mentions the whole file when the edit-area selection is unavailable', async () => {
    const { mentionFile } = mountPanel({
      listing: listing(textFile('notes.txt', 'hello text').node),
      reads: { 'notes.txt': { path: 'notes.txt', content: 'hello text', truncated: false, totalBytes: 10 } },
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByText('notes.txt'))
    await screen.findByTestId('aida-canvas-preview')
    fireEvent.click(screen.getByTestId('aida-canvas-edit-toggle'))
    const editor = screen.getByTestId('aida-canvas-edit') as HTMLTextAreaElement
    editor.focus()
    // A textarea whose selection is unavailable falls back to the mention chip.
    Object.defineProperty(editor, 'selectionStart', { value: null })
    Object.defineProperty(editor, 'selectionEnd', { value: null })
    fireEvent.mouseDown(screen.getByTestId('aida-canvas-quote'))
    fireEvent.click(screen.getByTestId('aida-canvas-quote'))
    expect(mentionFile).toHaveBeenCalledWith('notes.txt')
  })

  it('falls back to the mention chip when the selection sits outside the panel', async () => {
    const { mentionFile } = mountPanel({
      listing: listing(textFile('notes.txt', 'hello text').node),
      reads: { 'notes.txt': { path: 'notes.txt', content: 'hello text', truncated: false, totalBytes: 10 } },
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByText('notes.txt'))
    await screen.findByTestId('aida-canvas-preview')
    // A selection anchored outside the canvas panel is not quotable.
    const outside = document.createElement('div')
    outside.textContent = 'outside text'
    document.body.appendChild(outside)
    const range = document.createRange()
    range.selectNodeContents(outside)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.mouseDown(screen.getByTestId('aida-canvas-quote'))
    fireEvent.click(screen.getByTestId('aida-canvas-quote'))
    expect(mentionFile).toHaveBeenCalledWith('notes.txt')
    // A selection whose anchor is not a DOM node also falls back.
    Object.defineProperty(selection, 'anchorNode', { value: null, configurable: true })
    fireEvent.click(screen.getByTestId('aida-canvas-quote'))
    expect(mentionFile).toHaveBeenCalledTimes(2)
    outside.remove()
  })

  it('discards stale listing and read settlements after unmount', async () => {
    // A pending listing that resolves after unmount hits the inert then arm.
    let resolveList!: (value: WorkspaceFileListing) => void
    const listFiles = vi.fn(() => new Promise<WorkspaceFileListing>((resolve) => { resolveList = resolve }))
    const first = mountPanel({ listFiles })
    first.unmount()
    resolveList({ root: '/projects/one', files: [], truncated: false })
    await act(async () => {})
    // A pending listing that rejects after unmount hits the inert catch arm.
    let rejectList!: (reason: unknown) => void
    const second = mountPanel({ listFiles: vi.fn(() => new Promise<WorkspaceFileListing>((_resolve, reject) => { rejectList = reject })) })
    second.unmount()
    rejectList(new DOMException('aborted', 'AbortError'))
    await act(async () => {})
    // A pending read that resolves after unmount hits the inert then arm.
    let resolveRead!: (value: WorkspaceFileRead) => void
    const readFile = vi.fn(() => new Promise<WorkspaceFileRead>((resolve) => { resolveRead = resolve }))
    const third = mountPanel({
      listing: listing(textFile('notes.txt', 'x').node),
      readFile,
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByText('notes.txt'))
    await screen.findByTestId('aida-canvas-pane')
    third.unmount()
    resolveRead({ path: 'notes.txt', content: 'x', truncated: false, totalBytes: 1 })
    await act(async () => {})
    // A pending read that rejects after unmount hits the inert catch arms.
    let rejectRead!: (reason: unknown) => void
    const fourth = mountPanel({
      listing: listing(textFile('notes.txt', 'x').node),
      readFile: vi.fn(() => new Promise<WorkspaceFileRead>((_resolve, reject) => { rejectRead = reject })),
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByText('notes.txt'))
    await screen.findByTestId('aida-canvas-pane')
    fourth.unmount()
    rejectRead(new DOMException('aborted', 'AbortError'))
    await act(async () => {})
    expect(listFiles).toHaveBeenCalledTimes(1)
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('surfaces non-Error failures from the listing, the read, and the write', async () => {
    // A string listing failure surfaces through the tree error.
    const listingMount = mountPanel({ listFiles: vi.fn(async () => { throw 'list boom' }) })
    expect(await screen.findByText('list boom')).toBeTruthy()
    listingMount.unmount()
    cleanup()
    // A string read failure surfaces through the read error.
    const readMount = mountPanel({
      listing: listing(textFile('notes.txt', 'hello').node),
      readFile: vi.fn(async () => { throw 'read boom' }),
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByText('notes.txt'))
    expect(await screen.findByText('read boom')).toBeTruthy()
    readMount.unmount()
    cleanup()
    // A string write failure surfaces after a successful read + save.
    const writeMount = mountPanel({
      listing: listing(textFile('notes.txt', 'hello').node),
      writeFile: vi.fn(async () => { throw 'write boom' }),
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByText('notes.txt'))
    await screen.findByTestId('aida-canvas-preview')
    fireEvent.click(screen.getByTestId('aida-canvas-edit-toggle'))
    fireEvent.click(screen.getByTestId('aida-canvas-save'))
    expect(await screen.findByText('write boom')).toBeTruthy()
    writeMount.unmount()
  })

  it('keeps the edit buffer empty for base64 reads without text content', async () => {
    const { store } = mountPanel({
      listing: listing(
        { name: 'photo.png', path: 'photo.png', kind: 'image', size: 4 },
        { name: 'diagram.svg', path: 'diagram.svg', kind: 'image', size: 4 },
      ),
      reads: {
        'photo.png': { path: 'photo.png', base64: 'aGk=', contentType: 'image/png', truncated: false, totalBytes: 2 },
        'diagram.svg': { path: 'diagram.svg', truncated: false, totalBytes: 0 },
      },
    })
    await screen.findByText('photo.png')
    fireEvent.click(screen.getByText('photo.png'))
    // A binary (non-SVG) read without text content resolves the buffer to ''.
    await screen.findByAltText('photo.png')
    // Back to the Files tab, then open the SVG row.
    fireEvent.click(screen.getByText('文件'))
    fireEvent.click(await screen.findByText('diagram.svg'))
    await screen.findByTestId('aida-canvas-pane')
    // An SVG read without a base64 payload decodes to an empty buffer too.
    fireEvent.click(screen.getByTestId('aida-canvas-edit-toggle'))
    expect((screen.getByTestId('aida-canvas-edit') as HTMLTextAreaElement).value).toBe('')
    expect(store.store.getSnapshot().openTabs).toContain('diagram.svg')
  })

  it('opens a path missing from the tree and leaves the canvas pane empty', async () => {
    const { store } = mountPanel({
      listing: listing(
        { name: 'empty', path: 'empty', kind: 'folder' },
        textFile('notes.txt', 'x').node,
      ),
    })
    await screen.findByText('notes.txt')
    // A path outside the listing cannot resolve to a node.
    act(() => { store.actions.openFile('missing.txt') })
    expect(screen.getByText('没有打开的文件')).toBeTruthy()
  })

  it('keeps the tree when the save refresh lists a different root, and renames with a mismatched refresh', async () => {
    let listingCalls = 0
    const listFiles = vi.fn(async () => {
      listingCalls += 1
      // The refresh after a save/rename reports a foreign root; the tree stays.
      return listingCalls === 1
        ? listing(textFile('notes.txt', 'hello').node)
        : { root: '/other', files: [], truncated: false }
    })
    const { renameFile } = mountPanel({
      listing: listing(textFile('notes.txt', 'hello').node),
      listFiles,
      renameFile: vi.fn(async () => ({ path: 'renamed.txt' })),
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByText('notes.txt'))
    await screen.findByTestId('aida-canvas-preview')
    fireEvent.click(screen.getByTestId('aida-canvas-edit-toggle'))
    fireEvent.click(screen.getByTestId('aida-canvas-save'))
    await waitFor(() =>{  expect(listFiles.mock.calls.length).toBeGreaterThanOrEqual(2) })
    fireEvent.click(screen.getByText('文件'))
    fireEvent.click(screen.getAllByTestId('aida-canvas-row-actions')[0]!)
    fireEvent.click(screen.getByText('重命名'))
    fireEvent.change(screen.getByTestId('aida-canvas-rename-input'), { target: { value: 'renamed.txt' } })
    fireEvent.click(screen.getByTestId('aida-canvas-rename-submit'))
    await waitFor(() =>{  expect(renameFile).toHaveBeenCalledWith('/projects/one', 'notes.txt', 'renamed.txt') })
  })

  it('aborts a superseded import at the loop top and skips its stale finally', async () => {
    // The first import's write settles only when its controller aborts; the
    // superseding drop then lands on the loop-top abort check of the next
    // iteration.
    const writeFile = vi.fn((_root: string, _path: string, _input: object, signal?: AbortSignal) => {
      if (writeFile.mock.calls.length === 2) return Promise.resolve({ path: 'a.txt' })
      return new Promise<WorkspaceFileWrite>((resolve) => {
        signal?.addEventListener('abort', () =>{  resolve({ path: 'a.txt' }) }, { once: true })
      })
    })
    mountPanel({ writeFile })
    await screen.findByText('README.md')
    const first = new File(['a'], 'a.txt', { type: 'text/plain' })
    const second = new File(['b'], 'b.txt', { type: 'text/plain' })
    fireEvent.drop(screen.getByTestId('aida-canvas-panel'), { dataTransfer: { types: ['Files'], files: [first, second] } })
    // The first import is stuck on its pending write.
    await waitFor(() =>{  expect(writeFile).toHaveBeenCalledTimes(1) })
    // A second drop supersedes it; the first write settles on the abort and
    // the next iteration's loop-top check returns.
    fireEvent.drop(screen.getByTestId('aida-canvas-panel'), { dataTransfer: { types: ['Files'], files: [first] } })
    await waitFor(() =>{  expect(writeFile).toHaveBeenCalledTimes(2) })
    // The superseding import completes and refreshes the tree.
    expect(await screen.findByText('已导入 1 个文件')).toBeTruthy()
  })

  it('aborts a superseded import after its last write settles', async () => {
    // The final write ignores the abort and settles on its own, so the
    // post-loop abort check returns before the notice.
    let resolveLastWrite!: (value: WorkspaceFileWrite) => void
    const writeFile = vi.fn((_root: string, _path: string, _input: object) => {
      if (writeFile.mock.calls.length === 2) {
        return new Promise<WorkspaceFileWrite>((resolve) => { resolveLastWrite = resolve })
      }
      return Promise.resolve({ path: 'a.txt' })
    })
    mountPanel({ writeFile })
    await screen.findByText('README.md')
    const first = new File(['a'], 'a.txt', { type: 'text/plain' })
    const second = new File(['b'], 'b.txt', { type: 'text/plain' })
    fireEvent.drop(screen.getByTestId('aida-canvas-panel'), { dataTransfer: { types: ['Files'], files: [first, second] } })
    await waitFor(() =>{  expect(writeFile).toHaveBeenCalledTimes(2) })
    // A second drop supersedes the first import while its last write is
    // pending; the stale write then settles and the post-loop check returns.
    fireEvent.drop(screen.getByTestId('aida-canvas-panel'), { dataTransfer: { types: ['Files'], files: [first] } })
    await waitFor(() =>{  expect(writeFile).toHaveBeenCalledTimes(3) })
    resolveLastWrite({ path: 'b.txt' })
    // The superseding import completes and refreshes the tree.
    expect(await screen.findByText('已导入 1 个文件')).toBeTruthy()
  })

  it('aborts a superseded import between a read and its write', async () => {
    // The dragged file's arrayBuffer stays pending until the abort, so the
    // post-decode abort check runs with a settled controller.
    const file = new File(['a'], 'a.txt', { type: 'text/plain' })
    let resolveBytes!: (value: ArrayBuffer) => void
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => new Promise<ArrayBuffer>((resolve) => { resolveBytes = resolve }),
      configurable: true,
    })
    const writeFile = vi.fn(async () => ({ path: 'a.txt' }))
    mountPanel({ writeFile })
    await screen.findByText('README.md')
    fireEvent.drop(screen.getByTestId('aida-canvas-panel'), { dataTransfer: { types: ['Files'], files: [file] } })
    const supersede = new File(['b'], 'b.txt', { type: 'text/plain' })
    fireEvent.drop(screen.getByTestId('aida-canvas-panel'), { dataTransfer: { types: ['Files'], files: [supersede] } })
    resolveBytes(new TextEncoder().encode('a').buffer)
    await act(async () => {})
    expect(await screen.findByText('已导入 1 个文件')).toBeTruthy()
  })

  it('aborts a superseded import during its post-import refresh', async () => {
    const deferredRefreshes: { resolve: (value: WorkspaceFileListing) => void }[] = []
    let refreshCount = 0
    const listFiles = vi.fn(async (_root: string) => {
      // The first call is the initial tree fetch; refreshes defer.
      if (++refreshCount === 1) return listing(textFile('a.txt', 'a').node)
      return new Promise<WorkspaceFileListing>((resolve) => { deferredRefreshes.push({ resolve }) })
    })
    const writeFile = vi.fn(async () => ({ path: 'b.txt' }))
    mountPanel({ listFiles, writeFile })
    await screen.findByText('a.txt')
    const first = new File(['a'], 'a.txt', { type: 'text/plain' })
    fireEvent.drop(screen.getByTestId('aida-canvas-panel'), { dataTransfer: { types: ['Files'], files: [first, first] } })
    // The first import finishes its writes and waits on the refresh.
    await waitFor(() =>{  expect(deferredRefreshes.length).toBe(1) })
    // A second drop aborts the first import mid-refresh.
    fireEvent.drop(screen.getByTestId('aida-canvas-panel'), { dataTransfer: { types: ['Files'], files: [first] } })
    await waitFor(() =>{  expect(deferredRefreshes.length).toBe(2) })
    for (const deferred of deferredRefreshes.splice(0)) deferred.resolve(listing(textFile('a.txt', 'a').node))
    // The stale refresh arm skips its tree update without breaking the panel.
    await act(async () => {})
    expect(screen.getByTestId('aida-canvas-panel')).toBeTruthy()
  })

  it('keeps the drag overlay until the last nested drag leaves', async () => {
    mountPanel()
    await screen.findByText('README.md')
    const panel = screen.getByTestId('aida-canvas-panel')
    fireEvent.dragEnter(panel, { dataTransfer: { types: ['Files'], files: [] } })
    fireEvent.dragEnter(panel, { dataTransfer: { types: ['Files'], files: [] } })
    fireEvent.dragLeave(panel, { dataTransfer: { types: ['Files'], files: [] } })
    // One nested drag remains, so the overlay stays.
    expect(screen.getAllByText('导入')).toHaveLength(2)
    fireEvent.dragLeave(panel, { dataTransfer: { types: ['Files'], files: [] } })
    expect(screen.getAllByText('导入')).toHaveLength(1)
  })

  it('reports string failures from rename, move, and delete', async () => {
    mountPanel({
      listing: listing(
        { name: 'docs', path: 'docs', kind: 'folder', children: [] },
        textFile('notes.txt', 'x').node,
      ),
      renameFile: vi.fn(async () => { throw 'rename boom' }),
      moveFile: vi.fn(async () => { throw 'move boom' }),
      deleteFile: vi.fn(async () => { throw 'delete boom' }),
    })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getAllByTestId('aida-canvas-row-actions')[0]!)
    fireEvent.click(screen.getByText('重命名'))
    fireEvent.change(screen.getByTestId('aida-canvas-rename-input'), { target: { value: 'x.txt' } })
    fireEvent.click(screen.getByTestId('aida-canvas-rename-submit'))
    expect(await screen.findByText('rename boom')).toBeTruthy()
    // Reopen the menu (the failed rename left it in rename mode), then delete.
    const actions = screen.getAllByTestId('aida-canvas-row-actions')[0]!
    fireEvent.click(actions)
    fireEvent.click(actions)
    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getByTestId('aida-canvas-delete-confirm'))
    expect(await screen.findByText('delete boom')).toBeTruthy()
    // A failed move surfaces its string through the notice.
    const dataTransfer = {
      types: [FILE_DRAG_TYPE],
      setData: vi.fn(),
      getData: vi.fn(() => 'notes.txt'),
      dropEffect: 'none',
    } as unknown as DataTransfer
    const folder = await screen.findByRole('treeitem', { name: /docs/ })
    fireEvent.dragStart(await screen.findByRole('treeitem', { name: /notes/ }), { dataTransfer })
    fireEvent.drop(folder, { dataTransfer })
    expect(await screen.findByText('move boom')).toBeTruthy()
  })

  it('ignores non-Enter keys in the rename input', async () => {
    const { renameFile } = mountPanel()
    await screen.findByText('README.md')
    fireEvent.click(screen.getAllByTestId('aida-canvas-row-actions')[0]!)
    fireEvent.click(screen.getByText('重命名'))
    fireEvent.keyDown(screen.getByTestId('aida-canvas-rename-input'), { key: 'a' })
    expect(renameFile).not.toHaveBeenCalled()
  })

})
