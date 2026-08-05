#!/usr/bin/env node
// Pi UI 反向代理：把公网/局域网地址的请求转发到仅允许 loopback 监听的 Pi UI 服务。
// 保留原始 Host / Origin 头，使服务的同源 API 校验通过。
//
// 用法:
//   node scripts/proxy-server.mjs [--port 4173] [--upstream http://127.0.0.1:4174]
// 环境变量:
//   PI_UI_PROXY_PORT  监听端口（默认 4173）
//   PI_UI_UPSTREAM    上游地址（默认 http://127.0.0.1:4174）
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { connect as tcpConnect } from 'node:net';

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const PORT = Number(argValue('--port', process.env.PI_UI_PROXY_PORT || 4173));
const UPSTREAM = new URL(argValue('--upstream', process.env.PI_UI_UPSTREAM || 'http://127.0.0.1:4174'));

const server = createServer((req, res) => {
  const upstreamReq = httpRequest(
    {
      protocol: UPSTREAM.protocol,
      hostname: UPSTREAM.hostname,
      port: UPSTREAM.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on('error', (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Proxy error: ${error.message}`);
  });

  req.pipe(upstreamReq);
});

// WebSocket 升级透传（当前应用未使用，保留以兼容未来升级）。
server.on('upgrade', (req, socket, head) => {
  const upstreamSocket = tcpConnect(
    { host: UPSTREAM.hostname, port: Number(UPSTREAM.port) },
    () => {
      upstreamSocket.write(`${req.method} ${req.url} HTTP/1.1\r\n`);
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) upstreamSocket.write(`${name}: ${item}\r\n`);
        } else {
          upstreamSocket.write(`${name}: ${value}\r\n`);
        }
      }
      upstreamSocket.write('\r\n');
      if (head && head.length) upstreamSocket.write(head);
      socket.pipe(upstreamSocket).pipe(socket);
    },
  );
  upstreamSocket.on('error', () => socket.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] listening on 0.0.0.0:${PORT} -> ${UPSTREAM.href}`);
});
