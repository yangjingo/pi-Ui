// UI/UX layer — shared file-tree renderer for the Workspace data-center. Folder rows call
// onToggle(node); file rows call onOpen(node) with the full node so callers can resolve by path.

import type { MouseEvent, ReactNode } from 'react';
import type { FileNode } from '../../core/agent/protocol';
import { countFiles } from '../../workspace';
import { Icon, fileIcon, t, text } from '../../ui';

export function FileTree({
  list,
  depth = 0,
  active,
  highlighted = null,
  idPrefix = 'file-tree-item',
  rovingPath,
  selectionMode = false,
  selectedPaths,
  renderFileActions,
  onToggle,
  onOpen,
  onSelect,
}: {
  list: FileNode[];
  depth?: number;
  active: string | null;
  highlighted?: string | null;
  idPrefix?: string;
  rovingPath?: string;
  selectionMode?: boolean;
  selectedPaths?: ReadonlySet<string>;
  renderFileActions?(node: FileNode): ReactNode;
  onToggle(node: FileNode): void;
  onOpen(node: FileNode): void;
  onSelect?(node: FileNode, event: MouseEvent<HTMLButtonElement>): void;
}) {
  const visiblePaths = list.flatMap(visibleTreePaths);
  const resolvedRovingPath = rovingPath
    ?? [highlighted, active].find(path => !!path && visiblePaths.includes(path))
    ?? visiblePaths[0];
  return (
    <>
      {list.map((f, index) => (
        <Row
          key={`${f.path || f.name}|${depth}|${index}`}
          f={f}
          depth={depth}
          active={active}
          highlighted={highlighted}
          idPrefix={idPrefix}
          rovingPath={resolvedRovingPath}
          selectionMode={selectionMode}
          selectedPaths={selectedPaths}
          renderFileActions={renderFileActions}
          onToggle={onToggle}
          onOpen={onOpen}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
export function fileTreeItemId(prefix: string, path: string): string {
  const normalized = path.replace(/^\.?\//, '').replace(/\\/g, '/');
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

export function navigateFileTree(e: React.KeyboardEvent<HTMLElement>) {
  const current = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
  if (!current) return;
  const root = e.currentTarget;
  const items = Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  const index = items.indexOf(current);
  if (index < 0) return;
  let target: HTMLElement | null = null;
  if (e.key === 'ArrowDown') target = items[Math.min(items.length - 1, index + 1)];
  else if (e.key === 'ArrowUp') target = items[Math.max(0, index - 1)];
  else if (e.key === 'Home') target = items[0];
  else if (e.key === 'End') target = items[items.length - 1];
  else if (e.key === 'ArrowRight') {
    if (current.getAttribute('aria-expanded') === 'false') current.click();
    else if (current.getAttribute('aria-expanded') === 'true') {
      const level = Number(current.getAttribute('aria-level'));
      const next = items[index + 1];
      if (next && Number(next.getAttribute('aria-level')) > level) target = next;
    }
  } else if (e.key === 'ArrowLeft') {
    if (current.getAttribute('aria-expanded') === 'true') current.click();
    else {
      const level = Number(current.getAttribute('aria-level'));
      for (let i = index - 1; i >= 0; i--) {
        if (Number(items[i].getAttribute('aria-level')) < level) { target = items[i]; break; }
      }
    }
  } else return;
  e.preventDefault();
  target?.focus();
}

export function keepTreeRovingFocus(e: React.FocusEvent<HTMLElement>) {
  const current = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
  if (!current) return;
  for (const item of e.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')) item.tabIndex = -1;
  current.tabIndex = 0;
}

function Row({ f, depth, active, highlighted, idPrefix, rovingPath, selectionMode, selectedPaths, renderFileActions, onToggle, onOpen, onSelect }: {
  f: FileNode;
  depth: number;
  active: string | null;
  highlighted: string | null;
  idPrefix: string;
  rovingPath?: string;
  selectionMode: boolean;
  selectedPaths?: ReadonlySet<string>;
  renderFileActions?(node: FileNode): ReactNode;
  onToggle(node: FileNode): void;
  onOpen(node: FileNode): void;
  onSelect?(node: FileNode, event: MouseEvent<HTMLButtonElement>): void;
}) {
  const isFolder = f.type === 'folder';
  const path = f.path || f.name;
  const isActive = active === path;
  const isHighlighted = !isFolder && highlighted === path;
  const descendants = isFolder ? listLeafPaths(f) : [path];
  const isSelected = descendants.length > 0 && descendants.every(item => selectedPaths?.has(item));
  return (
    <>
      <div className={`file-row-shell${selectionMode ? ' selecting' : ''}${isSelected ? ' selected' : ''}`}>
        <button
          id={fileTreeItemId(idPrefix, path)}
          className={`file-row${isFolder ? ' folder' : ''}${isFolder && !f.open ? ' closed' : ''}${isActive ? ' active' : ''}${isHighlighted ? ' search-active' : ''}`}
          data-testid="file-item"
          data-file-path={path}
          data-search-active={isHighlighted ? 'true' : undefined}
          data-selected={selectionMode ? String(isSelected) : undefined}
          title={selectionMode ? t(isSelected ? 'files.unselectPath' : 'files.selectPath', { path }) : path}
          role="treeitem"
          tabIndex={path === rovingPath ? 0 : -1}
          aria-level={depth + 1}
          aria-expanded={isFolder && !selectionMode ? !!f.open : undefined}
          aria-current={!selectionMode && !isFolder && isActive ? 'true' : undefined}
          aria-selected={selectionMode ? isSelected : (!isFolder ? (highlighted ? isHighlighted : isActive) : undefined)}
          onClick={(event) => {
            if (selectionMode) onSelect?.(f, event);
            else if (isFolder) onToggle(f);
            else onOpen(f);
          }}
        >
          <span className="indent" style={{ width: depth * 16 }} />
          {selectionMode && <span className="file-select-mark" aria-hidden="true">{isSelected && <Icon name="check" />}</span>}
          {isFolder ? (
            <>
              <span className="tree-ico ftype-folder"><Icon name="folder" /></span>
              <span className="name">{text(f.name)}</span>
              <span className="fsize">{f.children ? countFiles(f.children) : ''}</span>
            </>
          ) : (
            <>
              <span className={`tree-ico ftype-${f.type}`}><Icon name={fileIcon(f.type)} /></span>
              <span className="name">{text(f.name)}</span>
              <span className="fsize">{text(f.size || '')}</span>
            </>
          )}
        </button>
        {!selectionMode && !isFolder && renderFileActions?.(f)}
      </div>
      {isFolder && f.open && f.children && (
        <div role="group">
          <FileTree
            list={f.children}
            depth={depth + 1}
            active={active}
            highlighted={highlighted}
            idPrefix={idPrefix}
            rovingPath={rovingPath}
            selectionMode={selectionMode}
            selectedPaths={selectedPaths}
            renderFileActions={renderFileActions}
            onToggle={onToggle}
            onOpen={onOpen}
            onSelect={onSelect}
          />
        </div>
      )}
    </>
  );
}

function listLeafPaths(node: FileNode): string[] {
  if (node.type !== 'folder') return [node.path || node.name];
  return (node.children || []).flatMap(listLeafPaths);
}

function visibleTreePaths(node: FileNode): string[] {
  const path = node.path || node.name;
  return node.type === 'folder' && node.open && node.children
    ? [path, ...node.children.flatMap(visibleTreePaths)]
    : [path];
}
