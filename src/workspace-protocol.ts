/** Shared host/browser protocol for the standalone AIDA Workspace Canvas. */

export type WorkspaceFileKind = 'folder' | 'text' | 'image' | 'pdf' | 'office' | 'binary'

export interface WorkspaceFileNode {
  name: string
  path: string
  kind: WorkspaceFileKind
  size?: number
  children?: WorkspaceFileNode[]
}

export interface WorkspaceFileListing {
  root: string
  files: WorkspaceFileNode[]
  truncated: boolean
}

export interface WorkspaceFileRead {
  path: string
  content?: string
  base64?: string
  contentType?: string
  truncated: boolean
  totalBytes: number
}

export interface WorkspaceFileWrite { path: string }

export const AIDA_WORKSPACE_ENDPOINT = '/api/aida-workspace'

export type AidaWorkspaceRequest =
  | { operation: 'list'; root: string }
  | { operation: 'read'; root: string; path: string; offset?: number; maxBytes?: number }
  | { operation: 'write'; root: string; path: string; content?: string; base64?: string }
  | { operation: 'rename'; root: string; path: string; nextName: string }
  | { operation: 'move'; root: string; path: string; targetPath: string }
  | { operation: 'delete'; root: string; path: string }

export type AidaWorkspaceResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }
