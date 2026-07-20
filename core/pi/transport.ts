// HTTP + SSE transport over Node's built-in http. No framework.
// Shared by the Vite dev plugin (middleware) and the prod server.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { runtime } from './runtime';

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

type NextFn = () => void;

/** Connect-style middleware: handles /api/*, passes everything else through. */
export function createApiHandler() {
  return async (req: IncomingMessage, res: ServerResponse, next?: NextFn) => {
    const url = req.url || '';
    if (!url.startsWith('/api/')) { next?.(); return; }

    // Server-Sent Events: stream AgentEvent to the browser
    if (url === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(': stream open\n\n');
      const unsub = runtime.on((e) => res.write('data: ' + JSON.stringify(e) + '\n\n'));
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { unsub(); clearInterval(ping); });
      return;
    }

    try {
      if (url === '/api/health' && req.method === 'GET') return json(res, 200, runtime.health);
      if (url === '/api/sessions' && req.method === 'GET') return json(res, 200, runtime.listSessions());
      if (url === '/api/session/new' && req.method === 'POST') {
        await runtime.newSession(); return json(res, 200, { ok: true });
      }
      if (url === '/api/prompt' && req.method === 'POST') {
        const { text } = await readBody(req);
        if (!text) return json(res, 400, { error: 'missing "text"' });
        // Fire and forget — the assistant reply streams back over /api/events.
        void runtime.prompt(text);
        return json(res, 200, { ok: true });
      }
      if (url === '/api/file' && req.method === 'POST') {
        const { path, content } = await readBody(req);
        if (!path) return json(res, 400, { error: 'missing "path"' });
        await runtime.saveFile(path, content);
        return json(res, 200, { ok: true });
      }
      if (url === '/api/cwd' && req.method === 'POST') {
        const { path } = await readBody(req);
        if (!path) return json(res, 400, { error: 'missing "path"' });
        const result = await runtime.setCwd(String(path));
        return json(res, result.ok ? 200 : 400, { ...result, ...runtime.health });
      }
      if (url === '/api/thinking' && req.method === 'POST') {
        const { on } = await readBody(req);
        await runtime.setThinking(!!on);
        return json(res, 200, { ok: true, thinking: !!on });
      }
      if (url === '/api/models' && req.method === 'GET') {
        return json(res, 200, { models: runtime.listModels(), active: runtime.health.model });
      }
      if (url === '/api/models/custom' && req.method === 'POST') {
        const body = await readBody(req);
        const result = await runtime.addCustomModel(body);
        return json(res, result.ok ? 200 : 400, { ...result, models: runtime.listModels() });
      }
      if (url === '/api/models/custom/test' && req.method === 'POST') {
        const body = await readBody(req);
        const result = await runtime.testCustomModel(body);
        return json(res, 200, result);
      }
      if (url.startsWith('/api/models/custom') && req.method === 'DELETE') {
        const u = new URL(url, 'http://localhost');
        const id = u.searchParams.get('id') || '';
        await runtime.removeCustomModel(id);
        return json(res, 200, { ok: true, models: runtime.listModels() });
      }
      if (url === '/api/models/active' && req.method === 'POST') {
        const { providerId, modelId } = await readBody(req);
        if (!providerId || !modelId) return json(res, 400, { error: 'missing providerId/modelId' });
        const result = await runtime.setActiveModel(providerId, modelId);
        return json(res, result.ok ? 200 : 400, { ...result, models: runtime.listModels() });
      }
      return json(res, 404, { error: 'not found' });
    } catch (e: any) {
      return json(res, 500, { error: e?.message || String(e) });
    }
  };
}
