/** Safe same-origin static asset route for the AIDA deployment skin. */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, relative, resolve } from 'node:path'

/** Prefix owned by this plugin. A plugin-owned prefix cannot shadow DSH routes. */
export const AIDA_ASSETS_ROUTE = '/aida-ui-assets'

/** Small fixed asset vocabulary: extension allowlisted, one file deep. */
const ASSET_EXTENSIONS = new Set(['.png', '.svg'])

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
})

export type StaticAssetResolution =
  | { readonly ok: true; readonly file: string; readonly contentType: string; readonly bytes: number }
  | { readonly ok: false; readonly status: 404 }

/**
 * Resolve one AIDA asset request below {@link AIDA_ASSETS_ROUTE}.
 * @param assetRoot absolute package `assets/` directory.
 * @param requestUrl raw Node request URL (query strings are ignored).
 * @returns a file descriptor, or a stable 404 for traversal/unknown assets.
 */
export async function resolveAidaAsset(
  assetRoot: string,
  requestUrl: string | undefined,
): Promise<StaticAssetResolution> {
  let pathname: string
  try {
    pathname = new URL(requestUrl ?? '/', 'http://aida.local').pathname
  } catch {
    return { ok: false, status: 404 }
  }

  const encoded = pathname.slice(AIDA_ASSETS_ROUTE.length + 1)
  if (encoded === '' || encoded.includes('/')) return { ok: false, status: 404 }

  let name: string
  try {
    name = decodeURIComponent(encoded)
  } catch {
    return { ok: false, status: 404 }
  }
  const extension = extname(name).toLowerCase()
  if (!ASSET_EXTENSIONS.has(extension)) return { ok: false, status: 404 }

  const root = resolve(assetRoot)
  const file = resolve(root, name)
  const distance = relative(root, file)
  if (distance === '' || distance.startsWith('..') || resolve(distance) === distance) {
    return { ok: false, status: 404 }
  }
  try {
    const info = await stat(file)
    if (!info.isFile()) return { ok: false, status: 404 }
    return { ok: true, file, contentType: CONTENT_TYPES[extension]!, bytes: info.size }
  } catch {
    return { ok: false, status: 404 }
  }
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

/**
 * Create the prefix handler serving only bundled AIDA artwork.
 * @param assetRoot absolute package `assets/` directory.
 * @returns async Node HTTP handler.
 */
export function createAidaAssetsHandler(assetRoot: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }

    const asset = await resolveAidaAsset(assetRoot, req.url)
    if (!asset.ok) {
      notFound(res)
      return
    }

    res.writeHead(200, {
      'content-type': asset.contentType,
      'content-length': asset.bytes,
      'cache-control': 'public, max-age=3600',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createReadStream(asset.file)
      stream.on('error', reject)
      res.on('finish', () => resolvePromise())
      res.on('error', reject)
      stream.pipe(res)
    })
  }
}
