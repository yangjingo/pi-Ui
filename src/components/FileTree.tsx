// UI/UX layer — shared file-tree renderer. Used by the Workspace data-center and the SkillHub
// file browser. Folder rows call onToggle(node); file rows call onOpen(node) — the full node, so
// callers that key by path (e.g. skills with same-named files across folders) can resolve.

import type { FileNode } from '../../core/types';
import { countFiles } from '../../core/util';
import { Icon, fileIcon } from '../icons';
import { esc } from '../render';

export function FileTree({ list, depth = 0, active, onToggle, onOpen }: {
  list: FileNode[];
  depth?: number;
  active: string | null;
  onToggle(node: FileNode): void;
  onOpen(node: FileNode): void;
}) {
  return (
    <>
      {list.map(f => (
        <Row key={(f.path || f.name) + depth} f={f} depth={depth} active={active} onToggle={onToggle} onOpen={onOpen} />
      ))}
    </>
  );
}

function Row({ f, depth, active, onToggle, onOpen }: {
  f: FileNode;
  depth: number;
  active: string | null;
  onToggle(node: FileNode): void;
  onOpen(node: FileNode): void;
}) {
  const isFolder = f.type === 'folder';
  const isActive = active === f.name || active === (f.path || '');
  return (
    <>
      <button
        className={`file-row${isFolder ? ' folder' : ''}${isFolder && !f.open ? ' closed' : ''}${isActive ? ' active' : ''}`}
        data-testid="file-item"
        onClick={() => (isFolder ? onToggle(f) : onOpen(f))}
      >
        <span className="indent" style={{ width: depth * 16 }} />
        {isFolder ? (
          <>
            <span className="caret"><Icon name="chevron" /></span>
            <span className="tree-ico ftype-folder"><Icon name="folder" /></span>
            <span className="name">{esc(f.name)}</span>
            <span className="fsize">{f.children ? countFiles(f.children) : ''}</span>
          </>
        ) : (
          <>
            <span className="caret" style={{ visibility: 'hidden' }}><Icon name="chevron" /></span>
            <span className={`tree-ico ftype-${f.type}`}><Icon name={fileIcon(f.type)} /></span>
            <span className="name">{esc(f.name)}</span>
            <span className="fsize">{esc(f.size || '')}</span>
          </>
        )}
      </button>
      {isFolder && f.open && f.children && (
        <FileTree list={f.children} depth={depth + 1} active={active} onToggle={onToggle} onOpen={onOpen} />
      )}
    </>
  );
}
