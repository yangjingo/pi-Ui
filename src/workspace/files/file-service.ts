import { agentClient, fileTypeOf, type AgentEvent } from '../../core/agent';
import { isOfficeFile } from '../../harness/file';

export interface ImportedWorkspaceFile {
  id: string;
  path: string;
  name: string;
  type: string;
}

export function workspaceFileType(path: string) {
  return fileTypeOf(path);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export async function importWorkspaceFile(file: File, destPath?: string): Promise<{ ok: boolean; error?: string; file?: ImportedWorkspaceFile }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = fileTypeOf(file.name);
  const targetPath = destPath || file.name;
  const isBinaryImport = isOfficeFile(file.name) || type === 'pdf' || type === 'png' || type === 'binary';
  const result = isBinaryImport
    ? await agentClient.importFile(targetPath, bytesToBase64(bytes))
    : bytes.includes(0)
      ? { ok: false, error: 'unsupported binary' }
      : await agentClient.saveFile(targetPath, new TextDecoder().decode(bytes));
  if (!result.ok) return result;
  return {
    ok: true,
    file: {
      id: `${file.name}:${file.size}:${file.lastModified}`,
      path: targetPath,
      name: targetPath.replace(/\\/g, '/').split('/').pop() || file.name,
      type: fileTypeOf(targetPath),
    },
  };
}

export function workspaceFileUrl(path: string, download = false): string {
  const query = new URLSearchParams({ path });
  if (download) query.set('download', '1');
  return `/api/file/raw?${query.toString()}`;
}

export async function fetchWorkspaceFileBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(workspaceFileUrl(path), { signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || '文件无法加载');
  }
  return response.blob();
}

export function subscribeWorkspaceEvents(listener: (event: AgentEvent) => void): () => void {
  return agentClient.subscribe(listener);
}
