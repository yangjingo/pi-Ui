// Prod entry: serves the built UI (dist/) + the Core API from one Node process.
// Run with: npm run build && npm run start

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { runtime } from './runtime';
import { createApiHandler } from './transport';

const PORT = Number(process.env.PORT) || 4173;
const DIST = join(process.cwd(), 'dist');
const api = createApiHandler();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url.startsWith('/api/')) return api(req, res);

  // Static file serving with SPA fallback to index.html
  try {
    let path = join(DIST, url === '/' ? 'index.html' : url);
    const st = await stat(path).catch(() => null);
    if (!st || st.isDirectory()) path = join(DIST, 'index.html');
    const data = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found. Run `npm run build` first.');
  }
});

runtime.init().catch((e: any) => console.error('[pi] runtime init failed:', e?.message || e));

server.listen(PORT, () => {
  console.log(`\n  Pi workspace → http://localhost:${PORT}`);
  console.log(`  model: ${process.env.PI_MODEL || 'anthropic/claude-sonnet-4-5'} · cwd: ${process.env.PI_CWD || './workspace'}\n`);
});
