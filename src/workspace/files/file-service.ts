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

export async function importWorkspaceFile(sessionId: string, file: File, destPath?: string): Promise<{ ok: boolean; error?: string; file?: ImportedWorkspaceFile }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = fileTypeOf(file.name);
  const targetPath = destPath || file.name;
  const isBinaryImport = isOfficeFile(file.name) || type === 'pdf' || type === 'png' || type === 'binary';
  const result = isBinaryImport
    ? await agentClient.importFile(sessionId, targetPath, bytesToBase64(bytes))
    : bytes.includes(0)
      ? { ok: false, error: 'unsupported binary' }
      : await agentClient.saveFile(sessionId, targetPath, new TextDecoder().decode(bytes));
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

export function workspaceFileUrl(sessionId: string, path: string, download = false): string {
  const query = new URLSearchParams({ sessionId, path });
  if (download) query.set('download', '1');
  return `/api/file/raw?${query.toString()}`;
}

export class WorkspaceFileRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'WorkspaceFileRequestError';
  }
}

export async function fetchWorkspaceFileBlob(sessionId: string, path: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(workspaceFileUrl(sessionId, path), { signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new WorkspaceFileRequestError(payload?.error || '文件无法加载', response.status);
  }
  return response.blob();
}

export async function fetchWorkspaceArchive(sessionId: string, paths: string[], signal?: AbortSignal): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch('/api/files/archive', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, paths }),
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new WorkspaceFileRequestError(payload?.error || '无法创建 ZIP', response.status);
  }
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const fallback = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  let filename = 'workspace-files.zip';
  try { filename = decodeURIComponent(encoded || fallback || filename); } catch { /* use fallback */ }
  return { blob: await response.blob(), filename };
}

export function saveBlobAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function subscribeWorkspaceEvents(listener: (event: AgentEvent) => void): () => void {
  return agentClient.subscribe(listener);
}
