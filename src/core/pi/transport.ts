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
      // Hydrate every new/reconnected browser with one authoritative session atomically:
      // transcript, generated artifacts and their previews all belong to the same session dir.
      res.write('data: ' + JSON.stringify(runtime.sessionSnapshot('initial')) + '\n\n');
      const unsub = runtime.on((e) => res.write('data: ' + JSON.stringify(e) + '\n\n'));
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { unsub(); clearInterval(ping); });
      return;
    }

    try {
      if (url === '/api/pi/inheritance' && req.method === 'GET') {
        return json(res, 200, await runtime.inspectPiInheritance());
      }
      if (url === '/api/runtime/bootstrap' && req.method === 'POST') {
        const body = await readBody(req);
        const result = await runtime.bootstrapRuntime(Boolean(body?.inheritPi));
        return json(res, result.ok ? 200 : 409, result);
      }
      if (url === '/api/health' && req.method === 'GET') return json(res, 200, runtime.health);
      if (url === '/api/sessions' && req.method === 'GET') return json(res, 200, runtime.listSessions());
      if (url === '/api/skills' && req.method === 'GET') return json(res, 200, runtime.listSkills());
      if (url === '/api/skills' && req.method === 'POST') {
        const result = runtime.saveSkill(await readBody(req));
        return json(res, result.ok ? 200 : 400, result);
      }
      if (url === '/api/skills/from-turn' && req.method === 'POST') {
        const body = await readBody(req);
        const result = runtime.createSkillFromTurn(Number(body?.messageIndex));
        return json(res, result.ok ? 200 : 400, result);
      }
      if (url.startsWith('/api/skills?') && req.method === 'DELETE') {
        const id = new URL(url, 'http://localhost').searchParams.get('id') || '';
        const result = runtime.deleteSkill(id);
        return json(res, result.ok ? 200 : 404, result);
      }
      if (url === '/api/session/new' && req.method === 'POST') {
        await runtime.newSession(); return json(res, 200, { ok: true, files: runtime.fileSnapshot() });
      }
      if (url === '/api/session/switch' && req.method === 'POST') {
        const body = await readBody(req);
        const ok = await runtime.switchSession(String(body?.id || '').trim());
        if (!ok) return json(res, 404, { ok: false, error: '会话不存在' });
        return json(res, 200, { ok: true, files: runtime.fileSnapshot() });
      }
      if (url === '/api/prompt' && req.method === 'POST') {
        const { text, displayText, workspaceChanges } = await readBody(req);
        if (!text) return json(res, 400, { error: 'missing "text"' });
        // Fire and forget — the assistant reply streams back over /api/events.
        void runtime.prompt(text, { displayText, workspaceChanges });
        return json(res, 200, { ok: true });
      }
      if (url === '/api/steer' && req.method === 'POST') {
        const { text, displayText, workspaceChanges } = await readBody(req);
        if (!text) return json(res, 400, { ok: false, error: 'missing "text"' });
        const result = await runtime.steer(String(text), { displayText, workspaceChanges });
        return json(res, result.ok ? 200 : 409, result);
      }
      if (url === '/api/interrupt' && req.method === 'POST') {
        const { text, displayText, workspaceChanges } = await readBody(req);
        if (!text) return json(res, 400, { ok: false, error: 'missing "text"' });
        const result = await runtime.interruptAndSteer(String(text), { displayText, workspaceChanges });
        return json(res, result.ok ? 200 : 409, result);
      }
      if (url.startsWith('/api/file/raw?') && req.method === 'GET') {
        const u = new URL(url, 'http://localhost');
        const requestedPath = u.searchParams.get('path') || '';
        const result = runtime.readCanvasBinary(requestedPath);
        if (!result.ok || !result.data) return json(res, 404, { ok: false, error: result.error || '文件不可预览' });
        const filename = requestedPath.replace(/\\/g, '/').split('/').pop() || 'download';
        const disposition = u.searchParams.get('download') === '1'
          ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
          : 'inline';
        res.writeHead(200, {
          'content-type': result.contentType || 'application/octet-stream',
          'content-length': result.data.length,
          'content-disposition': disposition,
          'cache-control': 'private, max-age=60',
        });
        res.end(result.data);
        return;
      }
      if (url === '/api/file' && req.method === 'POST') {
        const { path, content } = await readBody(req);
        if (!path) return json(res, 400, { error: 'missing "path"' });
        const result = await runtime.saveFile(path, content);
        return json(res, result.ok ? 200 : 400, result);
      }
      if (url === '/api/file/import' && req.method === 'POST') {
        const { path, data } = await readBody(req);
        if (!path || !data) return json(res, 400, { error: 'missing path/data' });
        const result = await runtime.importFile(String(path), String(data));
        return json(res, result.ok ? 200 : 400, result);
      }
      if (url === '/api/file/rename' && req.method === 'POST') {
        const { path, nextPath } = await readBody(req);
        if (!path || !nextPath) return json(res, 400, { error: 'missing path/nextPath' });
        const result = await runtime.renameFile(String(path), String(nextPath));
        return json(res, result.ok ? 200 : 400, result);
      }
      if (url.startsWith('/api/file?') && req.method === 'DELETE') {
        const u = new URL(url, 'http://localhost');
        const path = u.searchParams.get('path') || '';
        if (!path) return json(res, 400, { error: 'missing path' });
        const result = await runtime.deleteFile(path);
        return json(res, result.ok ? 200 : 400, result);
      }
      if (url === '/api/cwd' && req.method === 'POST') {
        const { path } = await readBody(req);
        if (!path) return json(res, 400, { error: 'missing "path"' });
        const result = await runtime.setCwd(String(path));
        return json(res, result.ok ? 200 : 400, { ...result, ...runtime.health, files: runtime.fileSnapshot() });
      }
      if (url === '/api/thinking' && req.method === 'POST') {
        const { on } = await readBody(req);
        await runtime.setThinking(!!on);
        return json(res, 200, { ok: true, thinking: !!on });
      }
      if (url === '/api/models' && req.method === 'GET') {
        return json(res, 200, { models: await runtime.listModels(), active: runtime.health.model });
      }
      if (url === '/api/models/config' && req.method === 'GET') {
        return json(res, 200, await runtime.getModelConfigFile());
      }
      if (url === '/api/models/config' && req.method === 'PUT') {
        const { content } = await readBody(req);
        const result = await runtime.saveModelConfigFile(String(content || ''));
        return json(res, result.ok ? 200 : 400, { ...result, models: result.ok ? await runtime.listModels() : undefined });
      }
      if (url === '/api/models/config/parse' && req.method === 'POST') {
        const { content } = await readBody(req);
        const result = runtime.parseModelConfigFile(String(content || ''));
        return json(res, result.ok ? 200 : 400, result);
      }
      if (url === '/api/models/custom' && req.method === 'POST') {
        const body = await readBody(req);
        const result = await runtime.addCustomModel(body);
        return json(res, result.ok ? 200 : 400, { ...result, models: await runtime.listModels() });
      }
      if (url === '/api/models/custom' && req.method === 'PUT') {
        const { providerId, modelId, update } = await readBody(req);
        if (!providerId || !modelId || !update) return json(res, 400, { ok: false, error: 'missing model update' });
        const result = await runtime.updateModel(String(providerId), String(modelId), update);
        return json(res, result.ok ? 200 : 400, { ...result, models: result.ok ? await runtime.listModels() : undefined });
      }
      if (url === '/api/models/custom/test' && req.method === 'POST') {
        const body = await readBody(req);
        const { prompt, ...entry } = body || {};
        const result = await runtime.testCustomModel(entry, String(prompt || ''));
        return json(res, 200, result);
      }
      if (url === '/api/models/test' && req.method === 'POST') {
        const { providerId, modelId, benchmark, prompt } = await readBody(req);
        if (!providerId || !modelId) return json(res, 400, { ok: false, error: 'missing providerId/modelId' });
        const result = await runtime.testModel(String(providerId), String(modelId), !!benchmark, String(prompt || ''));
        return json(res, result.ok ? 200 : 400, result);
      }
      if (url.startsWith('/api/models/custom') && req.method === 'DELETE') {
        const u = new URL(url, 'http://localhost');
        const id = u.searchParams.get('id') || '';
        const result = await runtime.removeCustomModel(id);
        return json(res, result.ok ? 200 : 400, { ...result, models: result.ok ? await runtime.listModels() : undefined });
      }
      if (url === '/api/models/active' && req.method === 'POST') {
        const { providerId, modelId } = await readBody(req);
        if (!providerId || !modelId) return json(res, 400, { error: 'missing providerId/modelId' });
        const result = await runtime.setActiveModel(providerId, modelId);
        return json(res, result.ok ? 200 : 400, { ...result, models: await runtime.listModels() });
      }
      return json(res, 404, { error: 'not found' });
    } catch (e: any) {
      return json(res, 500, { error: e?.message || String(e) });
    }
  };
}
