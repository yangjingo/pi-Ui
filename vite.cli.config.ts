import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};
const dependencies = Object.keys(packageJson.dependencies || {});
const builtins = [...builtinModules, ...builtinModules.map(name => `node:${name}`)];

export default defineConfig({
  build: {
    target: 'node20',
    ssr: resolve('src/core/pi/cli.ts'),
    outDir: 'dist-node',
    emptyOutDir: true,
    rollupOptions: {
      external: [...dependencies, ...builtins],
      output: {
        entryFileNames: 'cli.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
