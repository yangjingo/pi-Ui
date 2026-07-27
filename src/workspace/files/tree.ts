import type { FileNode } from '../../core/agent';

export function listFiles(nodes: FileNode[], result: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.type === 'folder') listFiles(node.children || [], result);
    else result.push(node);
  }
  return result;
}
export function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '工作区根目录';
}

export function filterFileTree(list: FileNode[], query: string): FileNode[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return list;
  const result: FileNode[] = [];
  for (const node of list) {
    if (node.type === 'folder') {
      const children = filterFileTree(node.children || [], query);
      if (children.length || node.name.toLocaleLowerCase().includes(needle)) result.push({ ...node, open: true, children });
    } else if ((node.path || node.name).toLocaleLowerCase().includes(needle)) {
      result.push(node);
    }
  }
  return result;
}
