import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))
const dshRoot = resolve(here, '../../deepseek-harness')

/** dsh's tsconfig.base.json is JSONC (comment lines and trailing comments). */
function parseJsonc(text: string): any {
  const cleaned = text
    .split(/\r?\n/)
    .map(line => line.trimStart().startsWith('//') ? '' : line.replace(/(\s)\/\/.*$/, '$1'))
    .join('\n')
  return JSON.parse(cleaned)
}

const base = parseJsonc(readFileSync(resolve(dshRoot, 'tsconfig.base.json'), 'utf8'))
const paths = base.compilerOptions.paths as Record<string, string[]>

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Resolve every @deepseek-ai/* import against the local dsh checkout source,
 * mirroring the repository tsconfig paths the upstream plugin tests were
 * written against (the published npm archives do not ship their src/ trees).
 */
const aliases = Object.entries(paths).map(([key, targets]) => {
  const star = key.includes('*')
  const pattern = new RegExp(`^${escapeRegex(key).replace(/\\\*/g, '(.*)')}$`)
  const resolved = targets.map(target => resolve(dshRoot, target))
  return {
    find: pattern,
    replacement: (id: string): string => {
      if (!star) return resolved[0]!
      const match = id.match(pattern)
      const starPart = match?.[1] ?? ''
      const existing = resolved.find(target => existsSync(target.replace('*', starPart)))
      return (existing ?? resolved[0]!).replace('*', starPart)
    },
  }
})

// Deep src/ subpath imports are not covered by the repository tsconfig paths
// map; for every package mapped to a `.../src` directory, alias
// `@deepseek-ai/<pkg>/src/<rest>` to that directory.
const sourcePrefixAliases = Object.entries(paths)
  .filter(([key, targets]) => !key.includes('*') && !key.includes('/src/') && targets[0]!.endsWith('/src'))
  .map(([key, targets]) => ({
    find: new RegExp(`^${escapeRegex(key)}/src/(.*)$`),
    replacement: `${resolve(dshRoot, targets[0]!)}/$1`,
  }))

// dsh source files resolve 'react' from the deepseek-harness workspace, which
// would duplicate the React instance used by the plugin's react-dom in tests.
// Force every react/react-dom import onto the plugin's own copy.
const reactAliases = [
  { find: /^react$/, replacement: resolve(here, 'node_modules/react') },
  { find: /^react\/jsx-runtime$/, replacement: resolve(here, 'node_modules/react/jsx-runtime.js') },
  { find: /^react\/jsx-dev-runtime$/, replacement: resolve(here, 'node_modules/react/jsx-dev-runtime.js') },
  { find: /^react-dom$/, replacement: resolve(here, 'node_modules/react-dom') },
  { find: /^react-dom\/client$/, replacement: resolve(here, 'node_modules/react-dom/client.js') },
  { find: /^react-dom\/test-utils$/, replacement: resolve(here, 'node_modules/react-dom/test-utils.js') },
  // The dsh ui-renderer source imports this shim; resolve it from the plugin
  // tree so its react import lands on the same React instance as react-dom.
  { find: /^use-sync-external-store(\/.*)?$/, replacement: `${resolve(here, 'node_modules/use-sync-external-store')}$1` },
]

export default defineConfig({
  server: {
    fs: {
      // `?inline`/`?raw` style imports from the aliased dsh source tree go
      // through Vite's fs access gate; allow the dsh checkout explicitly.
      allow: [here, dshRoot],
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [...reactAliases, ...sourcePrefixAliases, ...aliases],
  },
  test: {
    environment: 'jsdom',
    pool: 'threads',
    css: true,
    server: {
      deps: {
        // The dsh source graph uses this CJS shim around React; keep it in
        // Vite's transform pipeline so its react import honors the aliases
        // and does not resolve a second React copy from the dsh workspace.
        inline: ['use-sync-external-store'],
      },
    },
  },
})
