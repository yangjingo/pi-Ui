/**
 * Accessible recursive file tree for the AIDA Canvas Files tab: roving
 * tabindex, folder toggle, active-file highlighting, and search-result
 * highlighting. A trimmed port of the Pi Canvas tree, using only the
 * workspace-file node shape.
 */

import type { KeyboardEvent as ReactKeyboardEvent, FocusEvent as ReactFocusEvent, ReactNode } from 'react'
import { useState } from 'react'
import type { WorkspaceFileNode } from '../../workspace-protocol.ts'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.mjs'
import File from 'lucide-react/dist/esm/icons/file.mjs'
import { countFiles } from './files.ts'
import css from './canvas.module.css'

/** The dataTransfer type carrying a dragged file's relative path. */
export const FILE_DRAG_TYPE = 'application/x-aida-file-path'

/** Move focus along the visible tree rows (roving tabindex). */
export function navigateFileTree(event: ReactKeyboardEvent<HTMLDivElement>): void {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'))
  const current = items.indexOf(document.activeElement as HTMLElement)
  if (current < 0) return
  const next = event.key === 'ArrowDown' ? current + 1
    : event.key === 'ArrowUp' ? current - 1
      : event.key === 'Home' ? 0
        : event.key === 'End' ? items.length - 1
          : -1
  const target = items[next]
  if (target === undefined) return
  event.preventDefault()
  target.focus()
}

/** Keep exactly one visible row focusable. */
export function keepTreeRovingFocus(event: ReactFocusEvent<HTMLDivElement>): void {
  const target = event.target as HTMLElement
  if (target.getAttribute('role') !== 'treeitem') return
  for (const item of event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
    item.tabIndex = item === target ? 0 : -1
  }
}

export interface FileTreeProps {
  /** Root nodes to render (already filtered). */
  list: readonly WorkspaceFileNode[]
  /** Depth offset (root rows are depth 0). */
  depth?: number
  /** Path of the active canvas file. */
  activePath: string | null
  /** Search-highlighted path. */
  highlighted: string | null
  /** Folder paths the user collapsed (default: all folders open). */
  collapsed: ReadonlySet<string>
  /** Paths of rows selected for batch actions (file leaves). */
  selected: ReadonlySet<string>
  /** Folder open/close toggle. */
  onToggle: (node: WorkspaceFileNode) => void
  /** Open a file in the canvas (a plain leaf click). */
  onOpen: (node: WorkspaceFileNode) => void
  /** Toggle a leaf into/out of the batch selection (Ctrl/⌘+click). */
  onSelectToggle: (node: WorkspaceFileNode) => void
  /** Select the leaf range from the selection anchor (Shift+click). */
  onSelectRange: (node: WorkspaceFileNode) => void
  /** Per-leaf action slot rendered beside the row (rename/delete menu). */
  renderRowActions: ((node: WorkspaceFileNode) => ReactNode) | undefined
  /** Right-click on a row: open its action menu (menu state owned by the caller). */
  onRowContextMenu?: ((node: WorkspaceFileNode) => void) | undefined
  /** Move a dragged file into a folder (`targetDir` '' = the workspace root). */
  onDropFile: (path: string, targetDir: string) => void
}

/** Recursively render one level of the tree. */
export function FileTree(props: FileTreeProps) {
  const {
    list, depth = 0, activePath, highlighted, collapsed, selected, onToggle, onOpen,
    onSelectToggle, onSelectRange, renderRowActions, onRowContextMenu, onDropFile,
  } = props
  return (
    <>
      {list.map(node => (
        <FileRow
          key={node.path}
          node={node}
          depth={depth}
          activePath={activePath}
          highlighted={highlighted}
          collapsed={collapsed}
          selected={selected}
          onToggle={onToggle}
          onOpen={onOpen}
          onSelectToggle={onSelectToggle}
          onSelectRange={onSelectRange}
          renderRowActions={renderRowActions}
          onRowContextMenu={onRowContextMenu}
          onDropFile={onDropFile}
        />
      ))}
    </>
  )
}

/** One tree row (folder or leaf), recursing into open folders. */
function FileRow({
  node, depth, activePath, highlighted, collapsed, selected, onToggle, onOpen,
  onSelectToggle, onSelectRange, renderRowActions, onRowContextMenu, onDropFile,
}: {
  node: WorkspaceFileNode
  depth: number
  activePath: string | null
  highlighted: string | null
  collapsed: ReadonlySet<string>
  selected: ReadonlySet<string>
  onToggle: (node: WorkspaceFileNode) => void
  onOpen: (node: WorkspaceFileNode) => void
  onSelectToggle: (node: WorkspaceFileNode) => void
  onSelectRange: (node: WorkspaceFileNode) => void
  renderRowActions: ((node: WorkspaceFileNode) => ReactNode) | undefined
  onRowContextMenu: ((node: WorkspaceFileNode) => void) | undefined
  onDropFile: (path: string, targetDir: string) => void
}) {
  const isFolder = node.kind === 'folder'
  const isActive = !isFolder && activePath === node.path
  const isHighlighted = highlighted === node.path
  const isSelected = !isFolder && selected.has(node.path)
  const open = isFolder && !collapsed.has(node.path) && (node.children?.length ?? 0) > 0
  const [dragOver, setDragOver] = useState(false)

  /** Plain activation: folders toggle, leaves open. */
  const activate = (): void => {
    if (isFolder) onToggle(node)
    else onOpen(node)
  }

  /** Mouse activation: folders toggle; leaves honor the selection modifiers. */
  const handleClick = (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void => {
    if (isFolder) {
      onToggle(node)
      return
    }
    if (event.shiftKey) {
      onSelectRange(node)
      return
    }
    if (event.ctrlKey || event.metaKey) {
      onSelectToggle(node)
      return
    }
    onOpen(node)
  }

  return (
    <>
      <div className={css.treeRowWrap}>
        <button
          type="button"
          role="treeitem"
          aria-selected={isSelected || undefined}
          className={[
            css.treeRow,
            isFolder ? css.treeRowFolder : '',
            isActive ? css.treeRowActive : '',
            isHighlighted ? css.treeRowHighlighted : '',
            isSelected ? css.treeRowSelected : '',
            isFolder && dragOver ? css.treeRowDropTarget : '',
          ].filter(Boolean).join(' ')}
          data-file-path={node.path}
          aria-expanded={isFolder ? open : undefined}
          aria-current={isActive ? 'true' : undefined}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={handleClick}
          // Enter and Space activate a row like a click (explicit, so the
          // keydown default — which would re-fire the button's click — is
          // suppressed and the tree action happens exactly once).
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              activate()
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            onRowContextMenu?.(node)
          }}
          {...(isFolder
            ? {
              // Folder rows are drop targets: dropping a dragged file onto
              // one moves it into the folder.
              onDragOver: (event: React.DragEvent) => {
                if (!event.dataTransfer.types.includes(FILE_DRAG_TYPE)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDragOver(true)
              },
              onDragLeave: () => { setDragOver(false) },
              onDrop: (event: React.DragEvent) => {
                if (!event.dataTransfer.types.includes(FILE_DRAG_TYPE)) return
                event.preventDefault()
                event.stopPropagation()
                setDragOver(false)
                const path = event.dataTransfer.getData(FILE_DRAG_TYPE)
                if (path !== '') onDropFile(path, node.path)
              },
            }
            : {
              // Leaf rows are drag sources (files only; folders are targets).
              draggable: true,
              onDragStart: (event: React.DragEvent) => {
                event.dataTransfer.setData(FILE_DRAG_TYPE, node.path)
                event.dataTransfer.effectAllowed = 'move'
              },
            })}
        >
          <span className={css.treeGlyph} aria-hidden="true">
            {isFolder
              ? <ChevronRight size={16} className={open ? css.treeGlyphOpen : undefined} />
              : <File size={16} />}
          </span>
          <span className={css.treeName}>{node.name}</span>
          {isFolder
            ? <span className={css.treeMeta}>{countFiles(node.children ?? [])}</span>
            : node.size !== undefined
              ? <span className={css.treeMeta}>{node.size}</span>
              : null}
        </button>
        {!isFolder && renderRowActions !== undefined && (
          <span className={css.treeActions}>{renderRowActions(node)}</span>
        )}
      </div>
      {isFolder && open && node.children !== undefined && (
        <FileTree
          list={node.children}
          depth={depth + 1}
          activePath={activePath}
          highlighted={highlighted}
          collapsed={collapsed}
          selected={selected}
          onToggle={onToggle}
          onOpen={onOpen}
          onSelectToggle={onSelectToggle}
          onSelectRange={onSelectRange}
          renderRowActions={renderRowActions}
          onRowContextMenu={onRowContextMenu}
          onDropFile={onDropFile}
        />
      )}
    </>
  )
}
