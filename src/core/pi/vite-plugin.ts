// Dev: mounts the Core API as a Vite dev-server middleware so `npm run dev`
// runs the Pi agent live in the same process — no second server to start.

import type { Plugin } from 'vite';
import { createApiHandler } from './transport';
import { runtime } from './runtime';

export function piAgentPlugin(): Plugin {
  return {
    name: 'pi-agent-core',
    configureServer(server) {
      const api = createApiHandler();
      // Plugin middlewares install before Vite's transform/SPA-fallback, so /api/* is intercepted cleanly.
      server.middlewares.use((req, res, next) => api(req, res, next));
      runtime.init().catch((e: any) =>
        server.config.logger.error('[pi] runtime init failed: ' + (e?.message || e)),
      );
    },
  };
}
