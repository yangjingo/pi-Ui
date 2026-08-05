import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import test from 'node:test';
import { startPiUiServer } from '../../src/core/pi/server';

interface Response {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
  status: number;
}

function get(port: number, path: string, encoding?: string): Promise<Response> {
  return new Promise((resolveResponse, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      headers: encoding ? { 'accept-encoding': encoding } : undefined,
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.once('end', () => resolveResponse({
        body: Buffer.concat(chunks),
        headers: res.headers,
        status: res.statusCode || 0,
      }));
    });
    req.once('error', reject);
    req.end();
  });
}

function postWithDeclaredSize(port: number, path: string, declaredSize: number): Promise<Response> {
  return new Promise((resolveResponse, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'content-length': String(declaredSize),
        'content-type': 'application/json',
      },
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.once('end', () => resolveResponse({
        body: Buffer.concat(chunks),
        headers: res.headers,
        status: res.statusCode || 0,
      }));
    });
    req.once('error', reject);
    req.end('{}');
  });
}

function postJson(port: number, path: string, body: unknown, origin?: string): Promise<Response> {
  const content = JSON.stringify(body);
  return new Promise((resolveResponse, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'content-length': String(Buffer.byteLength(content)),
        'content-type': 'application/json',
        ...(origin ? { origin } : {}),
      },
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.once('end', () => resolveResponse({
        body: Buffer.concat(chunks),
        headers: res.headers,
        status: res.statusCode || 0,
      }));
    });
    req.once('error', reject);
    req.end(content);
  });
}

test('production server compresses and caches fingerprinted lazy assets', async t => {
  const distDir = await mkdtemp(join(tmpdir(), 'pi-ui-server-'));
  const assetsDir = join(distDir, 'assets');
  await mkdir(assetsDir);
  const source = 'export const diagram = "flowchart";\n'.repeat(4_000);
  await Promise.all([
    writeFile(join(distDir, 'index.html'), '<!doctype html><div id="root"></div>'),
    writeFile(join(assetsDir, 'mermaid-core-abc123.js'), source),
  ]);
  t.after(() => rm(distDir, { recursive: true, force: true }));

  const server = await startPiUiServer({ distDir, host: '127.0.0.1', port: 0 });
  t.after(() => new Promise<void>((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const brotli = await get(address.port, '/assets/mermaid-core-abc123.js', 'br, gzip');
  assert.equal(brotli.status, 200);
  assert.equal(brotli.headers['content-encoding'], 'br');
  assert.equal(brotli.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(brotli.headers.vary, 'Accept-Encoding');
  assert.ok(brotli.body.byteLength < Buffer.byteLength(source));
  assert.equal(brotliDecompressSync(brotli.body).toString('utf8'), source);

  const zipped = await get(address.port, '/assets/mermaid-core-abc123.js', 'gzip;q=1, br;q=0');
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.equal(gunzipSync(zipped.body).toString('utf8'), source);

  const identity = await get(address.port, '/assets/mermaid-core-abc123.js');
  assert.equal(identity.headers['content-encoding'], undefined);
  assert.equal(identity.body.toString('utf8'), source);
});

test('production API rejects oversized JSON before buffering it', async t => {
  const distDir = await mkdtemp(join(tmpdir(), 'pi-ui-server-'));
  await writeFile(join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
  t.after(() => rm(distDir, { recursive: true, force: true }));

  const server = await startPiUiServer({ distDir, host: '127.0.0.1', port: 0 });
  t.after(() => new Promise<void>((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const response = await postWithDeclaredSize(address.port, '/api/thinking', 4 * 1024 * 1024 + 1);
  assert.equal(response.status, 413);
  assert.match(response.body.toString('utf8'), /request body exceeds 4MB limit/);
});

test('production server stays loopback-only and rejects cross-origin API calls', async t => {
  const distDir = await mkdtemp(join(tmpdir(), 'pi-ui-server-'));
  await writeFile(join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
  t.after(() => rm(distDir, { recursive: true, force: true }));

  await assert.rejects(
    startPiUiServer({ distDir, host: '0.0.0.0', port: 0 }),
    /only listens on/,
  );

  const server = await startPiUiServer({ distDir, host: '127.0.0.1', port: 0 });
  t.after(() => new Promise<void>((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const response = await postJson(address.port, '/api/thinking', { sessionId: 'test', on: true }, 'https://example.com');
  assert.equal(response.status, 403);
  assert.match(response.body.toString('utf8'), /cross-origin access/);
});
