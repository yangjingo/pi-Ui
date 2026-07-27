// Pure file-workspace helpers owned by Canvas. No React, Node, or Pi dependencies.

import type { FileNode, Session } from '../../core/agent';

export function findFile(node: FileNode, key: string): FileNode | null {
  const normalized = key.replace(/^\.\//, '').replace(/\\/g, '/');
  const nodePath = node.path?.replace(/^\.\//, '').replace(/\\/g, '/');
  // Prefer the stable workspace path. Falling back to name keeps artifact links
  // (which currently carry only a basename) compatible.
  if (nodePath === normalized || node.name === key) return node;
  if (node.children) for (const c of node.children) { const f = findFile(c, key); if (f) return f; }
  return null;
}

export function findFileInSession(session: Session, name: string): FileNode | null {
  for (const f of session.files) { const r = findFile(f, name); if (r) return r; }
  return null;
}

export function countFiles(list: FileNode[]): number {
  let n = 0;
  for (const f of list) { if (f.children) n += countFiles(f.children); else n++; }
  return n;
}

export function pathOf(_session: Session, node: FileNode): string {
  return node.path ? '/' + node.path.replace(/^\/+/, '') : '/' + node.name;
}

export function parseCSV(text: string): string[][] {
  const source = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!source) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) {
      quoted = true;
    } else if (char === ',') {
      row.push(cell); cell = '';
    } else if (char === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function normalizeFilePath(raw: string): string {
  return raw
    .replace(/^\.?\//, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .trim();
}

export function basename(p: string): string {
  const s = normalizeFilePath(p);
  return s.slice(s.lastIndexOf('/') + 1);
}

/** Build a nested folder/file tree from a flat list of file nodes (each with a `path`). */
export function buildFileTree(files: FileNode[]): FileNode[] {
  const normalized = new Map<string, FileNode>();
  for (const f of files) {
    const path = normalizeFilePath(f.path || f.name);
    if (!path) continue;
    if (!normalized.has(path)) normalized.set(path, f);
  }

  const root: FileNode = { name: '', type: 'folder', path: '', children: [] };
  for (const [path, f] of normalized.entries()) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) continue;
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const prefix = parts.slice(0, i + 1).join('/');
      if (i === parts.length - 1) {
        cur.children!.push({ ...f, name: part, path: prefix });
      } else {
        let dir = cur.children!.find(c => c.type === 'folder' && c.name === part);
        if (!dir) { dir = { name: part, type: 'folder', path: prefix, open: true, children: [] }; cur.children!.push(dir); }
        cur = dir;
      }
    }
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sort = (nodes: FileNode[]) => {
    nodes.sort((a, b) => {
      const folderOrder = Number(b.type === 'folder') - Number(a.type === 'folder');
      return folderOrder || collator.compare(a.name, b.name);
    });
    for (const node of nodes) if (node.children) sort(node.children);
  };
  sort(root.children!);
  return root.children!;
}
