/** Browser client for the AIDA plugin's private same-origin Workspace route. */

import {
  AIDA_WORKSPACE_ENDPOINT,
  type AidaWorkspaceRequest,
  type AidaWorkspaceResponse,
  type WorkspaceFileListing,
  type WorkspaceFileRead,
  type WorkspaceFileWrite,
} from '../workspace-protocol.ts'

async function call<T>(request: AidaWorkspaceRequest, signal?: AbortSignal): Promise<T> {
  const response = await fetch(AIDA_WORKSPACE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    ...(signal !== undefined ? { signal } : {}),
  })
  const body = await response.json() as AidaWorkspaceResponse<T>
  if (!response.ok || !body.ok) {
    throw new Error(body.ok ? `Workspace request failed (${response.status})` : body.error.message)
  }
  return body.value
}

export const aidaWorkspaceApi = {
  listFiles: (root: string, signal?: AbortSignal): Promise<WorkspaceFileListing> =>
    call({ operation: 'list', root }, signal),
  readFile: (root: string, path: string, opts: { offset?: number; maxBytes?: number } = {}, signal?: AbortSignal): Promise<WorkspaceFileRead> =>
    call({ operation: 'read', root, path, ...opts }, signal),
  writeFile: (root: string, path: string, input: { content?: string; base64?: string }, signal?: AbortSignal): Promise<WorkspaceFileWrite> =>
    call({ operation: 'write', root, path, ...input }, signal),
  renameFile: (root: string, path: string, nextName: string, signal?: AbortSignal): Promise<WorkspaceFileWrite> =>
    call({ operation: 'rename', root, path, nextName }, signal),
  moveFile: (root: string, path: string, targetPath: string, signal?: AbortSignal): Promise<WorkspaceFileWrite> =>
    call({ operation: 'move', root, path, targetPath }, signal),
  deleteFile: (root: string, path: string, signal?: AbortSignal): Promise<WorkspaceFileWrite> =>
    call({ operation: 'delete', root, path }, signal),
}
