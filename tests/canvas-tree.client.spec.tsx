// @vitest-environment jsdom
// AIDA Canvas file tree and turn-tail chips: direct FileTree mount exercising
// the roving-tabindex keyboard navigation, focus capture, row interactions,
// and render states, plus the ProducedTail chips and the selector's remaining
// branches.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { WorkspaceFileNode } from '../src/workspace-protocol.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { createAidaCanvasStore } from '../src/client/canvas/store.ts'
import { FILE_DRAG_TYPE, FileTree, keepTreeRovingFocus, navigateFileTree } from '../src/client/canvas/FileTree.tsx'
import { ProducedTail, selectAidaProducedFiles, type ProducedTailProps } from '../src/client/canvas/ProducedTail.tsx'

const t = makeTranslate(zh, commonZh)

/** jsdom lacks ResizeObserver and URL.createObjectURL; stub both. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  // Node ≥25's localStorage needs --localstorage-file under vitest's jsdom;
  // the tree owns no persisted state, so a best-effort clear is enough.
  globalThis.localStorage?.clear?.()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Two nested folders, two leaves, one empty folder, one sizeless leaf. */
const tree: WorkspaceFileNode[] = [
  {
    name: 'src',
    path: 'src',
    kind: 'folder',
    children: [
      {
        name: 'components',
        path: 'src/components',
        kind: 'folder',
        children: [{ name: 'Button.tsx', path: 'src/components/Button.tsx', kind: 'text', size: 10 }],
      },
      { name: 'index.ts', path: 'src/index.ts', kind: 'text', size: 20 },
    ],
  },
  { name: 'README.md', path: 'README.md', kind: 'text' },
  { name: 'empty', path: 'empty', kind: 'folder' },
]

/** Render the tree inside the same roving-focus shell the canvas panel uses. */
function mountTree(options: {
  list?: readonly WorkspaceFileNode[]
  activePath?: string | null
  highlighted?: string | null
  collapsed?: ReadonlySet<string>
  selected?: ReadonlySet<string>
  renderRowActions?: (node: WorkspaceFileNode) => ReactNode
  onRowContextMenu?: (node: WorkspaceFileNode) => void
  onDropFile?: (path: string, targetDir: string) => void
} = {}) {
  const onToggle = vi.fn()
  const onOpen = vi.fn()
  const onSelectToggle = vi.fn()
  const onSelectRange = vi.fn()
  render(
    <div
      role="tree"
      data-testid="aida-canvas-tree"
      tabIndex={-1}
      onKeyDown={navigateFileTree}
      onFocusCapture={keepTreeRovingFocus}>
      <FileTree
        list={options.list ?? tree}
        activePath={options.activePath ?? null}
        highlighted={options.highlighted ?? null}
        collapsed={options.collapsed ?? new Set()}
        selected={options.selected ?? new Set()}
        onToggle={onToggle}
        onOpen={onOpen}
        onSelectToggle={onSelectToggle}
        onSelectRange={onSelectRange}
        renderRowActions={options.renderRowActions}
        onRowContextMenu={options.onRowContextMenu}
        onDropFile={options.onDropFile ?? vi.fn()}
      />
    </div>,
  )
  const rows = (): HTMLButtonElement[] =>
    Array.from(screen.getByTestId('aida-canvas-tree').querySelectorAll<HTMLButtonElement>('[role="treeitem"]'))
  const rowOf = (path: string) => rows().find(row => row.dataset.filePath === path)
  return { onToggle, onOpen, onSelectToggle, onSelectRange, rows, rowOf, tree: screen.getByTestId('aida-canvas-tree') }
}

describe('AIDA canvas tree keyboard navigation', () => {
  it('moves roving focus with the arrow, home, and end keys', () => {
    const { rows, rowOf, tree } = mountTree()
    rows()[0]!.focus()
    expect(document.activeElement).toBe(rows()[0])
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rowOf('src/components'))
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rowOf('src/components/Button.tsx'))
    fireEvent.keyDown(tree, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rowOf('src/components'))
    fireEvent.keyDown(tree, { key: 'Home' })
    expect(document.activeElement).toBe(rowOf('src'))
    fireEvent.keyDown(tree, { key: 'End' })
    expect(document.activeElement).toBe(rowOf('empty'))
  })

  it('stays put past the first and last rows, on unmapped keys, and when focus is outside the rows', () => {
    const { rows, tree } = mountTree()
    rows()[0]!.focus()
    fireEvent.keyDown(tree, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows()[0])
    const last = rows()[rows().length - 1]!
    last.focus()
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(tree, { key: 'Tab' })
    expect(document.activeElement).toBe(last)
    // Focus on the shell itself is not a row, so navigation declines.
    tree.focus()
    expect(document.activeElement).toBe(tree)
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tree)
  })

  it('keeps exactly one visible row focusable as focus roves', () => {
    const { rows, tree } = mountTree()
    rows()[2]!.focus()
    expect(rows().map(row => row.tabIndex)).toEqual([-1, -1, 0, -1, -1, -1])
    rows()[4]!.focus()
    expect(rows().map(row => row.tabIndex)).toEqual([-1, -1, -1, -1, 0, -1])
    // Focus landing outside the rows leaves the roving state untouched.
    tree.focus()
    expect(rows().map(row => row.tabIndex)).toEqual([-1, -1, -1, -1, 0, -1])
  })
})

describe('AIDA canvas tree rows', () => {
  it('toggles folders and opens leaves from row clicks', () => {
    const { onToggle, onOpen, rowOf } = mountTree()
    fireEvent.click(rowOf('src')!)
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ path: 'src' }))
    fireEvent.click(rowOf('src/components/Button.tsx')!)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/components/Button.tsx' }))
  })

  it('activates rows with the Enter and Space keys, exactly once', () => {
    const { onToggle, onOpen, rowOf } = mountTree()
    fireEvent.keyDown(rowOf('src')!, { key: ' ' })
    expect(onToggle).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(rowOf('src')!, { key: 'Enter' })
    expect(onToggle).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(rowOf('README.md')!, { key: ' ' })
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(rowOf('README.md')!, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledTimes(2)
    // Unmapped keys leave the row alone.
    fireEvent.keyDown(rowOf('README.md')!, { key: 'a' })
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('opens the row action menu from a right-click', () => {
    const onRowContextMenu = vi.fn()
    const { rowOf } = mountTree({ onRowContextMenu })
    fireEvent.contextMenu(rowOf('README.md')!)
    expect(onRowContextMenu).toHaveBeenCalledTimes(1)
    expect(onRowContextMenu).toHaveBeenCalledWith(expect.objectContaining({ path: 'README.md' }))
    // A right-click on a folder row reports the folder.
    fireEvent.contextMenu(rowOf('src')!)
    expect(onRowContextMenu).toHaveBeenCalledTimes(2)
    expect(onRowContextMenu).toHaveBeenCalledWith(expect.objectContaining({ path: 'src' }))
  })

  it('toggles leaf selection with Ctrl/⌘+click and ranges with Shift+click', () => {
    const { onToggle, onOpen, onSelectToggle, onSelectRange, rowOf } = mountTree()
    fireEvent.click(rowOf('src/components/Button.tsx')!, { ctrlKey: true })
    expect(onSelectToggle).toHaveBeenCalledTimes(1)
    expect(onSelectToggle).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/components/Button.tsx' }))
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(rowOf('README.md')!, { metaKey: true })
    expect(onSelectToggle).toHaveBeenCalledTimes(2)
    fireEvent.click(rowOf('src/index.ts')!, { shiftKey: true })
    expect(onSelectRange).toHaveBeenCalledTimes(1)
    expect(onSelectRange).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/index.ts' }))
    expect(onOpen).not.toHaveBeenCalled()
    // A plain leaf click still opens; folders ignore the modifiers.
    fireEvent.click(rowOf('README.md')!)
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.click(rowOf('src')!, { ctrlKey: true })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('marks selected leaves with aria-selected and the selected style', () => {
    const { rowOf } = mountTree({ selected: new Set(['README.md', 'src/index.ts']) })
    expect(rowOf('README.md')!.getAttribute('aria-selected')).toBe('true')
    expect(rowOf('README.md')!.className).toContain('treeRowSelected')
    expect(rowOf('src/index.ts')!.getAttribute('aria-selected')).toBe('true')
    expect(rowOf('src')!.getAttribute('aria-selected')).toBeNull()
    expect(rowOf('src/components/Button.tsx')!.getAttribute('aria-selected')).toBeNull()
  })

  it('drags a leaf onto a folder row and drops it into the folder', () => {
    const onDropFile = vi.fn()
    const { rowOf } = mountTree({ onDropFile })
    const leaf = rowOf('src/components/Button.tsx')!
    const folder = rowOf('src')!
    const dataTransfer = {
      types: [FILE_DRAG_TYPE],
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => 'src/components/Button.tsx'),
    } as unknown as DataTransfer
    fireEvent.dragStart(leaf, { dataTransfer })
    expect(dataTransfer.setData).toHaveBeenCalledWith(FILE_DRAG_TYPE, 'src/components/Button.tsx')
    fireEvent.dragOver(folder, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('move')
    expect(folder.className).toContain('treeRowDropTarget')
    fireEvent.dragLeave(folder, { dataTransfer })
    expect(folder.className).not.toContain('treeRowDropTarget')
    fireEvent.dragOver(folder, { dataTransfer })
    fireEvent.drop(folder, { dataTransfer })
    expect(onDropFile).toHaveBeenCalledWith('src/components/Button.tsx', 'src')
  })

  it('ignores drags that carry no file payload', () => {
    const onDropFile = vi.fn()
    const { rowOf } = mountTree({ onDropFile })
    const folder = rowOf('src')!
    const foreign = { types: ['text/plain'], setData: vi.fn(), getData: vi.fn(() => '') } as unknown as DataTransfer
    fireEvent.dragOver(folder, { dataTransfer: foreign })
    expect(folder.className).not.toContain('treeRowDropTarget')
    fireEvent.drop(folder, { dataTransfer: foreign })
    expect(onDropFile).not.toHaveBeenCalled()
  })

  it('drops with an empty dragged path on a folder row do nothing', () => {
    const onDropFile = vi.fn()
    const { rowOf } = mountTree({ onDropFile })
    const folder = rowOf('src')!
    const empty = {
      types: [FILE_DRAG_TYPE],
      setData: vi.fn(),
      getData: vi.fn(() => ''),
      dropEffect: 'none',
    } as unknown as DataTransfer
    fireEvent.dragOver(folder, { dataTransfer: empty })
    fireEvent.drop(folder, { dataTransfer: empty })
    expect(onDropFile).not.toHaveBeenCalled()
  })

  it('marks active and highlighted rows, folds and expands folders, and recurses', () => {
    const collapsed = new Set(['src/components'])
    const { rowOf } = mountTree({ activePath: 'src/index.ts', highlighted: 'README.md', collapsed })
    expect(rowOf('src/index.ts')!.getAttribute('aria-current')).toBe('true')
    expect(rowOf('README.md')!.className).toContain('treeRowHighlighted')
    expect(rowOf('src')!.getAttribute('aria-expanded')).toBe('true')
    expect(rowOf('src/components')!.getAttribute('aria-expanded')).toBe('false')
    expect(rowOf('empty')!.getAttribute('aria-expanded')).toBe('false')
    expect(rowOf('README.md')!.getAttribute('aria-expanded')).toBeNull()
    // Indentation tracks the depth offset.
    expect(rowOf('src')!.style.paddingLeft).toBe('8px')
    expect(rowOf('src/components')!.style.paddingLeft).toBe('24px')
    // Collapsed folders hide their children; open folders recurse into theirs.
    expect(rowOf('src/components/Button.tsx')).toBeUndefined()
    expect(rowOf('src/index.ts')).toBeTruthy()
  })

  it('renders the per-leaf action slot only on leaf rows', () => {
    const renderRowActions = (node: WorkspaceFileNode) => <span data-testid={`row-actions-${node.path}`}>actions</span>
    mountTree({ renderRowActions })
    expect(screen.getByTestId('row-actions-README.md')).toBeTruthy()
    expect(screen.getByTestId('row-actions-src/components/Button.tsx')).toBeTruthy()
    expect(screen.queryByTestId('row-actions-src')).toBeNull()
  })
})

describe('AIDA turn-tail chips', () => {
  /** Mount the chips with an open spy and the Host's native openFile. */
  function mountTail(paths: readonly string[]) {
    const openCanvas = vi.fn()
    const openFile = vi.fn()
    // dsh 0.2.0's turnTail is a list slot: the component runs the selection
    // itself from the Turn's deliverables data and keeps the Host's native
    // open linkage (openFile), not the Canvas.
    const props = {
      turn: { turn: 1, data: new Map([['deliverables', { produced: paths.map((path, index) => ({ path, seq: index + 1 })) }]]) },
      seq: paths.length + 1,
      openFile,
      t,
    } as unknown as ProducedTailProps
    render(<ProducedTail {...props} />)
    return { openCanvas, openFile }
  }

  it('renders produced-file chips, counts the overflow, and opens natively on click', () => {
    const paths = ['a.txt', 'docs/guide.md', 'c.txt', 'd.txt', 'e.txt', 'f.txt', 'g.txt', 'h.txt']
    const { openFile } = mountTail(paths)
    const tail = screen.getByTestId('aida-canvas-tail')
    expect(tail.textContent).toContain('生成的文件')
    expect(screen.getAllByRole('button')).toHaveLength(6)
    expect(tail.textContent).toContain('+2')
    expect(screen.queryByText('g.txt')).toBeNull()
    const chip = screen.getByTitle('docs/guide.md')
    expect(chip.textContent).toBe('guide.md')
    expect(chip.getAttribute('aria-label')).toBe('在画布中打开 docs/guide.md')
    fireEvent.click(chip)
    expect(openFile).toHaveBeenCalledWith('docs/guide.md')
  })

  it('renders all chips without an overflow count when they fit', () => {
    const { openFile } = mountTail(['a.txt', 'docs/guide.md'])
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByTestId('aida-canvas-tail').textContent).not.toContain('+')
    fireEvent.click(screen.getByTitle('a.txt'))
    expect(openFile).toHaveBeenCalledWith('a.txt')
  })

  it('filters produced paths beyond the closing seq and declines empty deliverables', () => {
    const owner = {
      turn: { turn: 1, data: new Map([['deliverables', { produced: [
        { path: 'a.txt', seq: 10 },
        { path: 'a.txt', seq: 12 },
        { path: 'late.txt', seq: 40 },
      ] }]]) },
      seq: 20,
      openFile: vi.fn(),
    }
    expect(selectAidaProducedFiles(owner as never)).toEqual(['a.txt'])
    const allLate = {
      ...owner,
      turn: { turn: 1, data: new Map([['deliverables', { produced: [{ path: 'late.txt', seq: 40 }] }]]) },
    }
    expect(selectAidaProducedFiles(allLate as never)).toBeNull()
  })
})
