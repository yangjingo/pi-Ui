// Pure domain helpers shared by Core and UI. No React, no Node, no Pi.

import type { FileNode, Session } from './types';

export function findFile(node: FileNode, name: string): FileNode | null {
  if (node.name === name) return node;
  if (node.children) for (const c of node.children) { const f = findFile(c, name); if (f) return f; }
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

export function finalArtifact(session: Session): string | null {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (m.role === 'agent' && m.artifacts && m.artifacts.length) return m.artifacts[m.artifacts.length - 1].name;
  }
  return null;
}

export function parseCSV(text: string): string[][] {
  return (text || '').replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n').map(l => l.split(','));
}

export function basename(p: string): string {
  const s = p.replace(/\\/g, '/');
  return s.slice(s.lastIndexOf('/') + 1);
}

/** Build a nested folder/file tree from a flat list of file nodes (each with a `path`). */
export function buildFileTree(files: FileNode[]): FileNode[] {
  const root: FileNode = { name: '', type: 'folder', path: '', children: [] };
  for (const f of files) {
    const parts = (f.path || f.name).replace(/^\.?\//, '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length) continue;
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const prefix = parts.slice(0, i + 1).join('/');
      if (i === parts.length - 1) {
        cur.children!.push({ ...f, name: part, path: f.path || prefix });
      } else {
        let dir = cur.children!.find(c => c.type === 'folder' && c.name === part);
        if (!dir) { dir = { name: part, type: 'folder', path: prefix, open: true, children: [] }; cur.children!.push(dir); }
        cur = dir;
      }
    }
  }
  return root.children!;
}

