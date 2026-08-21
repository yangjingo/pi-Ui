/** Host route for the standalone AIDA Workspace Canvas. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import { AIDA_WORKSPACE_ENDPOINT, type AidaWorkspaceRequest, type AidaWorkspaceResponse } from './workspace-protocol.ts'
import { WorkspaceFileError, WorkspaceFiles } from './host/workspace-files.ts'

export const name = 'client-ui-aida'
export const inject = ['webServer', 'workspaceRegistry']

const MAX_REQUEST_BYTES = 28 * 1024 * 1024

async function readRequest(req: IncomingMessage): Promise<AidaWorkspaceRequest> {
  if (req.method !== 'POST') throw new WorkspaceFileError('workspace-write-invalid', 'only POST is supported')
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += value.length
    if (bytes > MAX_REQUEST_BYTES) throw new WorkspaceFileError('workspace-write-invalid', 'request body is too large')
    chunks.push(value)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || !('operation' in parsed) || !('root' in parsed)) {
    throw new WorkspaceFileError('workspace-write-invalid', 'invalid Workspace request')
  }
  return parsed as AidaWorkspaceRequest
}

function send<T>(res: ServerResponse, status: number, body: AidaWorkspaceResponse<T>): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function apply(ctx: Context): void {
  const files = new WorkspaceFiles(() => ctx.workspaceRegistry.list().map(workspace => workspace.path))
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: AIDA_WORKSPACE_ENDPOINT,
    handler: async (req, res) => {
      try {
        const request = await readRequest(req)
        let value: unknown
        switch (request.operation) {
          case 'list': value = files.list(request.root); break
          case 'read': value = files.read(request.root, request.path, {
            ...(request.offset !== undefined ? { offset: request.offset } : {}),
            ...(request.maxBytes !== undefined ? { maxBytes: request.maxBytes } : {}),
          }); break
          case 'write': value = files.write(request.root, request.path, {
            ...(request.content !== undefined ? { content: request.content } : {}),
            ...(request.base64 !== undefined ? { base64: request.base64 } : {}),
          }); break
          case 'rename': value = files.rename(request.root, request.path, request.nextName); break
          case 'move': value = files.move(request.root, request.path, request.targetPath); break
          case 'delete': value = files.remove(request.root, request.path); break
        }
        send(res, 200, { ok: true, value })
      } catch (error) {
        const code = error instanceof WorkspaceFileError ? error.code : 'internal'
        const message = error instanceof Error ? error.message : String(error)
        send(res, code === 'internal' ? 500 : 400, { ok: false, error: { code, message } })
      }
    },
  }), 'ui-aida: Workspace HTTP route')
}
