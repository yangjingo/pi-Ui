// Production server: serves the built UI and the Core API from one Node process.
// The npm CLI supplies the package-relative UI path instead of assuming process.cwd().

import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import { createApiHandler } from './transport';
import { loopbackHost } from './network-policy';
import { injectUiBootstrap, resolveUiBootstrap } from './ui-bootstrap';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const COMPRESSIBLE = new Set(['.css', '.html', '.js', '.json', '.svg']);
const MIN_COMPRESS_BYTES = 1024;

type ContentEncoding = 'br' | 'gzip';

export interface PiUiServerOptions {
  distDir: string;
  host?: string;
  port?: number;
}

function assetPath(distDir: string, requestPath: string): string | null {
  try {
    const decoded = decodeURIComponent(requestPath).replaceAll('\\', '/');
    const candidate = resolve(distDir, `.${decoded === '/' ? '/index.html' : decoded}`);
    const route = relative(distDir, candidate);
    if (route.startsWith('..') || isAbsolute(route)) return null;
    return candidate;
  } catch {
    return null;
  }
}

function preferredEncoding(header: string | string[] | undefined): ContentEncoding | null {
  const qualities = new Map<string, number>();
  for (const value of (Array.isArray(header) ? header.join(',') : header || '').split(',')) {
    const [name, ...parameters] = value.trim().toLowerCase().split(';');
    if (!name) continue;
    const match = parameters
      .map(parameter => parameter.trim().match(/^q=(0(?:\.\d+)?|1(?:\.0+)?)$/u))
      .find(Boolean);
    const quality = match ? Number(match[1]) : 1;
    qualities.set(name, Math.max(qualities.get(name) || 0, quality));
  }
  const wildcard = qualities.get('*') || 0;
  const brotli = qualities.get('br') ?? wildcard;
  const zipped = qualities.get('gzip') ?? wildcard;
  if (brotli > 0 && brotli >= zipped) return 'br';
  if (zipped > 0) return 'gzip';
  return null;
}

function compress(data: Buffer, encoding: ContentEncoding): Promise<Buffer> {
  return new Promise((resolveData, reject) => {
    const done = (error: Error | null, result: Buffer) => error ? reject(error) : resolveData(result);
    if (encoding === 'br') {
      brotliCompress(data, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
      }, done);
      return;
    }
    gzip(data, { level: 6 }, done);
  });
}

export async function startPiUiServer(options: PiUiServerOptions): Promise<Server> {
  const distDir = resolve(options.distDir);
  const host = loopbackHost(options.host);
  const port = options.port ?? 4173;
  const api = createApiHandler();
  const uiBootstrap = resolveUiBootstrap();
  const encodedAssets = new Map<string, Promise<Buffer>>();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) return api(req, res);

      const requested = assetPath(distDir, url.pathname);
      if (!requested) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Invalid path');
        return;
      }

      let path = requested;
      const file = await stat(path).catch(() => null);
      if (!file || file.isDirectory()) path = resolve(distDir, 'index.html');
      const source = await readFile(path);
      const data = extname(path) === '.html'
        ? Buffer.from(injectUiBootstrap(source.toString('utf8'), uiBootstrap), 'utf8')
        : source;
      const extension = extname(path);
      const encoding = COMPRESSIBLE.has(extension) && data.byteLength >= MIN_COMPRESS_BYTES
        ? preferredEncoding(req.headers['accept-encoding'])
        : null;
      const cacheKey = `${path}:${encoding || 'identity'}`;
      const body = encoding
        ? await (encodedAssets.get(cacheKey) || (() => {
            const pending = compress(data, encoding);
            encodedAssets.set(cacheKey, pending);
            return pending;
          })())
        : data;
      const immutable = url.pathname.startsWith('/assets/') && path === requested;
      const headers: Record<string, string | number> = {
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        'content-length': body.byteLength,
        'content-type': MIME[extension] || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      };
      if (encoding) headers['content-encoding'] = encoding;
      if (COMPRESSIBLE.has(extension)) headers.vary = 'Accept-Encoding';
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Internal server error');
      }
    }
  });

  return new Promise((resolveServer, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolveServer(server);
    });
  });
}
