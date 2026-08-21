// @vitest-environment jsdom
// AIDA Canvas coverage for the pure file helpers (paths, kind labels, binary
// conversion, downloads), the store's edit/close/rename surface, and the
// MermaidDiagram render paths against a stubbed mermaid runtime. Panel and
// navigation flow live in canvas.client.spec.tsx; this spec closes the helper
// and diagram gaps.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import mermaid from 'mermaid'
import {
  base64ToBlob,
  base64ToText,
  bytesToBase64,
  countFiles,
  filterFileTree,
  isSourceEditable,
  kindLabel,
  listFiles,
  parentPath,
  parseCsv,
  saveBlobAs,
  textToBase64,
  visiblePathsOf,
} from '../src/client/canvas/files.ts'
import { createAidaCanvasStore } from '../src/client/canvas/store.ts'
import { MermaidDiagram } from '../src/client/canvas/MermaidDiagram.tsx'

// The canvas lazy-loads the mermaid runtime; stub it so the render paths are
// deterministic and independent of jsdom's missing SVG APIs.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>rendered</text></svg>',
      diagramType: 'flowchart',
    })),
  },
}))

/** jsdom lacks ResizeObserver and URL.createObjectURL; stub both. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AIDA canvas file helpers', () => {
  it('flattens and counts trees, including childless folders', () => {
    const tree = [
      { name: 'src', path: 'src', kind: 'folder' as const, children: [{ name: 'a.ts', path: 'src/a.ts', kind: 'text' as const }] },
      { name: 'empty', path: 'empty', kind: 'folder' as const },
    ]
    expect(listFiles(tree).map(file => file.path)).toEqual(['src/a.ts'])
    expect(countFiles(tree)).toBe(1)
  })

  it('keeps folders whose own name matches and drops folders with no matches', () => {
    const tree = [{ name: 'docs', path: 'docs', kind: 'folder' as const }]
    expect(filterFileTree(tree, 'docs')).toEqual([{ name: 'docs', path: 'docs', kind: 'folder', children: [] }])
    expect(filterFileTree(tree, 'xyz')).toEqual([])
  })

  it('flattens the visible leaf order, honoring collapsed folders', () => {
    const tree = [
      {
        name: 'src', path: 'src', kind: 'folder' as const,
        children: [
          { name: 'a.ts', path: 'src/a.ts', kind: 'text' as const },
          { name: 'nested', path: 'src/nested', kind: 'folder' as const, children: [{ name: 'b.ts', path: 'src/nested/b.ts', kind: 'text' as const }] },
          { name: 'empty', path: 'src/empty', kind: 'folder' as const },
        ],
      },
      { name: 'README.md', path: 'README.md', kind: 'text' as const },
    ]
    expect(visiblePathsOf(tree, new Set())).toEqual(['src/a.ts', 'src/nested/b.ts', 'README.md'])
    // A collapsed folder hides its subtree from the range order.
    expect(visiblePathsOf(tree, new Set(['src/nested']))).toEqual(['src/a.ts', 'README.md'])
    expect(visiblePathsOf(tree, new Set(['src']))).toEqual(['README.md'])
  })

  it('derives parent paths, normalizing backslashes', () => {
    expect(parentPath('src/a.ts')).toBe('src')
    expect(parentPath('a.ts')).toBe('')
    expect(parentPath('/top.ts')).toBe('')
    expect(parentPath('src\\nested\\a.ts')).toBe('src/nested')
  })

  it('labels every workspace file kind', () => {
    expect(kindLabel('folder')).toBe('folder')
    expect(kindLabel('text')).toBe('text')
    expect(kindLabel('image')).toBe('image')
    expect(kindLabel('pdf')).toBe('pdf')
    expect(kindLabel('office')).toBe('office')
    expect(kindLabel('binary')).toBe('binary')
  })

  it('decodes base64 payloads into typed blobs', async () => {
    const blob = base64ToBlob('aGVsbG8=', 'text/plain')
    expect(blob.type).toBe('text/plain')
    expect(blob.size).toBe(5)
    expect(await blob.text()).toBe('hello')
  })

  it('encodes bytes as base64, including the chunked path', () => {
    expect(bytesToBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=')
    const bytes = new Uint8Array(70000)
    for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 7) % 256
    const binary = atob(bytesToBase64(bytes))
    expect(binary.length).toBe(bytes.length)
    let matches = true
    for (let index = 0; index < bytes.length; index++) {
      if (binary.charCodeAt(index) !== bytes[index]) matches = false
    }
    expect(matches).toBe(true)
  })

  it('decodes base64 payloads into UTF-8 text, including multibyte content', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><text>你好</text></svg>'
    expect(base64ToText(textToBase64(source))).toBe(source)
    expect(base64ToText('aGVsbG8=')).toBe('hello')
  })

  it('returns an empty string when a base64 payload is invalid', () => {
    expect(base64ToText('not base64!')).toBe('')
  })

  it('round-trips text into base64 through the byte encoder', () => {
    expect(textToBase64('hello')).toBe('aGVsbG8=')
  })

  it('parses comma-delimited tables with quoted fields and escaped quotes', () => {
    expect(parseCsv('a,b\n1,2', ',')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('"a,1","b""2"', ',')).toEqual([['a,1', 'b"2']])
    expect(parseCsv('"leading","trailing"\n1,2\n', ',')).toEqual([['leading', 'trailing'], ['1', '2']])
    // A trailing newline adds no empty row; CRLF and lone CR both normalize.
    expect(parseCsv('a\nb\n', ',')).toEqual([['a'], ['b']])
    expect(parseCsv('x\r\ny\r', ',')).toEqual([['x'], ['y']])
  })

  it('parses tab-delimited tables and empty content', () => {
    expect(parseCsv('a\tb\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('', '\t')).toEqual([])
    expect(parseCsv('\n', ',')).toEqual([])
  })

  it('treats text files and SVG documents as source-editable, images and folders not', () => {
    expect(isSourceEditable({ name: 'a.txt', path: 'a.txt', kind: 'text' })).toBe(true)
    expect(isSourceEditable({ name: 'diagram.svg', path: 'diagram.svg', kind: 'image' })).toBe(true)
    expect(isSourceEditable({ name: 'DIAGRAM.SVG', path: 'DIAGRAM.SVG', kind: 'image' })).toBe(true)
    expect(isSourceEditable({ name: 'photo.png', path: 'photo.png', kind: 'image' })).toBe(false)
    expect(isSourceEditable({ name: 'src', path: 'src', kind: 'folder', children: [] })).toBe(false)
    expect(isSourceEditable(undefined)).toBe(false)
  })

  it('downloads a blob through a temporary anchor and revokes the object URL', () => {
    vi.useFakeTimers()
    const captured: { anchor: HTMLAnchorElement | null } = { anchor: null }
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      captured.anchor = this
    })
    try {
      const blob = new Blob(['payload'])
      saveBlobAs(blob, 'notes.txt')
      expect(vi.mocked(URL.createObjectURL)).toHaveBeenCalledWith(blob)
      expect(captured.anchor?.getAttribute('href')).toBe('blob:fake')
      expect(captured.anchor?.getAttribute('download')).toBe('notes.txt')
      expect(click).toHaveBeenCalledTimes(1)
      expect(document.body.querySelector('a')).toBeNull()
      vi.advanceTimersByTime(0)
      expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledWith('blob:fake')
    } finally {
      click.mockRestore()
      vi.useRealTimers()
    }
  })
})

describe('AIDA canvas store', () => {
  it('keeps one open-tab entry when the same file opens again', () => {
    const store = createAidaCanvasStore().create()
    act(() => {
      store.actions.openFile('a.txt')
      store.actions.openFile('a.txt')
    })
    expect(store.store.getSnapshot()).toMatchObject({ tab: 'canvas', openTabs: ['a.txt'], activePath: 'a.txt' })
  })

  it('clears the edit buffer when the tab under edit closes', () => {
    const store = createAidaCanvasStore().create()
    act(() => {
      store.actions.openFile('a.txt')
      store.actions.setEditing('a.txt', true)
    })
    act(() => { store.actions.closeTab('a.txt') })
    expect(store.store.getSnapshot()).toMatchObject({ openTabs: [], activePath: null, editPath: null, editDirty: false })
  })

  it('closes every tab and clears the file navigation state', () => {
    const store = createAidaCanvasStore().create()
    act(() => {
      store.actions.openFile('a.txt')
      store.actions.openFile('b.txt')
      store.actions.setEditing('b.txt', true)
      store.actions.closeAllTabs()
    })
    expect(store.store.getSnapshot()).toMatchObject({ openTabs: [], activePath: null, editPath: null, editDirty: false })
  })

  it('renames a tab in the open list, the active path, and the edit buffer', () => {
    const store = createAidaCanvasStore().create()
    act(() => {
      store.actions.openFile('a.txt')
      store.actions.openFile('b.txt')
      store.actions.setEditing('b.txt', true)
      store.actions.renameTab('b.txt', 'renamed.txt')
    })
    expect(store.store.getSnapshot()).toMatchObject({
      openTabs: ['a.txt', 'renamed.txt'],
      activePath: 'renamed.txt',
      editPath: 'renamed.txt',
    })
    // A rename of a tab that is neither active nor being edited only touches the list.
    act(() => { store.actions.renameTab('a.txt', 'z.txt') })
    expect(store.store.getSnapshot()).toMatchObject({
      openTabs: ['z.txt', 'renamed.txt'],
      activePath: 'renamed.txt',
      editPath: 'renamed.txt',
    })
  })

  it('toggles multi-selection and clears it, keeping the anchor', () => {
    const store = createAidaCanvasStore().create()
    act(() => {
      store.actions.toggleSelected('a.txt')
      store.actions.toggleSelected('b.txt')
      store.actions.toggleSelected('a.txt')
    })
    expect(store.store.getSnapshot().selected).toEqual(['b.txt'])
    expect(store.store.getSnapshot().selectionAnchor).toBe('a.txt')
    act(() => { store.actions.clearSelection() })
    expect(store.store.getSnapshot().selected).toEqual([])
    expect(store.store.getSnapshot().selectionAnchor).toBeNull()
  })

  it('selects visible ranges from the anchor, with the target-only fallbacks', () => {
    const store = createAidaCanvasStore().create()
    const order = ['a.txt', 'b.txt', 'c.txt', 'd.txt']
    act(() => {
      store.actions.toggleSelected('a.txt')
      store.actions.selectRange('a.txt', 'c.txt', order)
    })
    expect(store.store.getSnapshot().selected).toEqual(['a.txt', 'b.txt', 'c.txt'])
    expect(store.store.getSnapshot().selectionAnchor).toBe('c.txt')
    // A stale anchor (its row is hidden by a search) selects the target alone.
    act(() => { store.actions.selectRange('gone.txt', 'd.txt', order) })
    expect(store.store.getSnapshot().selected).toEqual(['d.txt'])
    // An unknown target clears the selection.
    act(() => { store.actions.selectRange('a.txt', 'missing.txt', order) })
    expect(store.store.getSnapshot().selected).toEqual([])
    expect(store.store.getSnapshot().selectionAnchor).toBeNull()
    // A null anchor (no prior selection action) selects the target alone.
    act(() => { store.actions.selectRange(null, 'b.txt', order) })
    expect(store.store.getSnapshot().selected).toEqual(['b.txt'])
  })

  it('reset clears the selection too', () => {
    const store = createAidaCanvasStore().create()
    act(() => {
      store.actions.toggleSelected('a.txt')
      store.actions.reset()
    })
    expect(store.store.getSnapshot().selected).toEqual([])
    expect(store.store.getSnapshot().selectionAnchor).toBeNull()
  })
})

describe('AIDA canvas mermaid diagram', () => {
  it('renders the source to svg when the runtime resolves', async () => {
    render(createElement(MermaidDiagram, { source: 'flowchart LR\n  A --> B' }))
    const stage = await screen.findByTestId('aida-canvas-mermaid')
    await waitFor(() =>{  expect(stage.innerHTML).toContain('rendered') })
    expect(vi.mocked(mermaid.initialize).mock.calls[0]![0].themeVariables?.fontSize).toBe('13px')
  })

  it('renders an empty diagram when the source is blank', async () => {
    render(createElement(MermaidDiagram, { source: '' }))
    await waitFor(() =>{  expect(vi.mocked(mermaid.render)).toHaveBeenCalled() })
    expect(vi.mocked(mermaid.render).mock.calls[0]![1]).toBe('flowchart LR\n  A[empty]')
  })

  it('resolves theme tokens from computed styles when the document defines them', async () => {
    vi.stubGlobal('getComputedStyle', (() => ({
      getPropertyValue: (name: string) => (name === '--dsw-alias-bg-layer-2' ? '#abcdef' : ''),
    })))
    try {
      render(createElement(MermaidDiagram, { source: 'flowchart LR\n  A --> B' }))
      await waitFor(() =>{  expect(vi.mocked(mermaid.initialize)).toHaveBeenCalled() })
      const config = vi.mocked(mermaid.initialize).mock.calls[0]![0]
      expect(config.themeVariables?.primaryColor).toBe('#abcdef')
      expect(config.themeVariables?.primaryTextColor).toBe('#111827')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses the default theme colors when no document exists', async () => {
    render(createElement(MermaidDiagram, { source: 'flowchart LR\n  A --> B' }))
    // Drop the jsdom global before the lazily imported mermaid config is
    // resolved so the resolvedToken SSR guard takes its fallback branch.
    // waitFor defaults its container to document, so pin it to the captured body.
    const container = document.body
    vi.stubGlobal('document', undefined)
    try {
      await waitFor(() =>{  expect(vi.mocked(mermaid.initialize)).toHaveBeenCalled() }, { container })
      const config = vi.mocked(mermaid.initialize).mock.calls[0]![0]
      expect(config.themeVariables?.primaryColor).toBe('#ffffff')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shows the raw source with the failure message when the runtime rejects', async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('boom'))
    render(createElement(MermaidDiagram, { source: 'flowchart LR\n  A --> B' }))
    const fallback = await screen.findByTestId('aida-canvas-mermaid-error')
    expect(fallback.querySelector('[role="alert"]')?.textContent).toBe('boom')
    expect(fallback.querySelector('pre')?.textContent).toBe('flowchart LR\n  A --> B')
  })

  it('stringifies non-Error render failures into the fallback', async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce('boom-string')
    render(createElement(MermaidDiagram, { source: 'flowchart LR\n  A --> B' }))
    const fallback = await screen.findByTestId('aida-canvas-mermaid-error')
    expect(fallback.querySelector('[role="alert"]')?.textContent).toBe('boom-string')
  })

  it('discards the svg when the component unmounts while the runtime renders', async () => {
    let resolveRender!: (value: { svg: string; diagramType: string }) => void
    vi.mocked(mermaid.render).mockImplementationOnce(
      () => new Promise<{ svg: string; diagramType: string }>((resolve) => { resolveRender = resolve }),
    )
    const { unmount } = render(createElement(MermaidDiagram, { source: 'flowchart LR\n  A --> B' }))
    const stage = await screen.findByTestId('aida-canvas-mermaid')
    await waitFor(() =>{  expect(vi.mocked(mermaid.initialize)).toHaveBeenCalled() })
    unmount()
    resolveRender({ svg: '<svg>late</svg>', diagramType: 'flowchart' })
    await act(async () => {})
    expect(stage.innerHTML).toBe('')
  })

  it('ignores a late render failure after the component unmounts', async () => {
    let rejectRender!: (reason: unknown) => void
    vi.mocked(mermaid.render).mockImplementationOnce(
      () => new Promise<never>((_resolve, reject) => { rejectRender = reject }),
    )
    const { unmount } = render(createElement(MermaidDiagram, { source: 'flowchart LR\n  A --> B' }))
    await waitFor(() =>{  expect(vi.mocked(mermaid.initialize)).toHaveBeenCalled() })
    unmount()
    rejectRender('late failure')
    await act(async () => {})
    expect(screen.queryByTestId('aida-canvas-mermaid-error')).toBeNull()
  })

  it('aborts the render when the component unmounts before the runtime loads', async () => {
    const { unmount } = render(createElement(MermaidDiagram, { source: 'flowchart LR\n  A --> B' }))
    unmount()
    await act(async () => {})
    expect(vi.mocked(mermaid.initialize)).not.toHaveBeenCalled()
  })
})
