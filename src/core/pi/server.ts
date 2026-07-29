// Production server: serves the built UI and the Core API from one Node process.
// The npm CLI supplies the package-relative UI path instead of assuming process.cwd().

import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { createApiHandler } from './transport';

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

export async function startPiUiServer(options: PiUiServerOptions): Promise<Server> {
  const distDir = resolve(options.distDir);
  const host = options.host || '127.0.0.1';
  const port = options.port ?? 4173;
  const api = createApiHandler();

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
      const data = await readFile(path);
      res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
      res.end(data);
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
