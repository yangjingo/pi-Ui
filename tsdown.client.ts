/**
 * Standalone tsdown preset for the AIDA browser plugin bundle.
 *
 * The upstream dsh monorepo has a repository-wide version of this factory.
 * This plugin checkout is intentionally self-contained, so this copy reads the
 * local package manifest and emits the same ModuleLoader closure contract:
 * requested platform modules stay external, plugin-owned dependencies inline,
 * and CSS Modules become deterministic hashed style injectors.
 */
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const TYPES_MARKER = `${sep}lib${sep}types${sep}`

const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

interface WorkspaceManifest {
  readonly name?: string
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
  readonly dsh?: { readonly client?: { readonly external?: unknown } }
}

interface ClientBundleOptions {
  readonly lib?: UserConfig
}

type BuildFaceConfig = (inlineConfig: Pick<UserConfig, 'env'>) => UserConfig[]

function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const tagId = `${id}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

function localManifest(id: string): WorkspaceManifest {
  const path = fileURLToPath(new URL('./package.json', import.meta.url))
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as WorkspaceManifest
  if (manifest.name !== id) {
    throw new Error(`tsdown: package.json declares ${String(manifest.name)}, but tsdown.config.ts declares ${id}`)
  }
  return manifest
}

function requestedExternals(manifest: WorkspaceManifest): readonly string[] {
  const value = manifest.dsh?.client?.external
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('tsdown: dsh.client.external must be an array of package specifiers')
  }
  return value
}

function escapeSpecifier(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function productionExternals(manifest: WorkspaceManifest): readonly RegExp[] {
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])
  return [...names].sort().map(name => new RegExp(`^${escapeSpecifier(name)}(/|$)`))
}

function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const boundary = emitted.indexOf(TYPES_MARKER)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
}

function clientLibraryConfig(
  id: string,
  libEntry: readonly string[],
  manifest: WorkspaceManifest,
  overrides: UserConfig = {},
): UserConfig {
  const patterns = productionExternals(manifest)
  const isProductionDependency = (specifier: string): boolean =>
    patterns.some(pattern => pattern.test(specifier))
  return {
    name: id,
    entry: [...libEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: isProductionDependency,
      alwaysBundle: specifier => !isBuiltin(specifier) && !isProductionDependency(specifier),
    },
    ...overrides,
  }
}

function clientConfig(
  id: string,
  entry: string,
  manifest: WorkspaceManifest,
): UserConfig {
  const externals = new Set<string>([
    ...PLATFORM_MODULES,
    ...requestedExternals(manifest),
  ])
  const isRequested = (specifier: string): boolean => externals.has(specifier)
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: isRequested,
      alwaysBundle: specifier => !isRequested(specifier),
    },
    define: {
      'process.env': '{}',
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      name: 'aida-client-bundle-purity',
      resolveId(source) {
        if (!source.startsWith('@aida/') && !source.startsWith('@deepseek-ai/')) return null
        if (isRequested(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not in the platform module table or ${id}'s dsh.client.external; `
          + 'declare the module request or collaborate through cordis services',
        )
      },
    }, {
      name: 'aida-css-modules-inline',
      resolveId(source, importer) {
        if (!source.endsWith('.module.css')) return null
        const file = importer === undefined ? source : sourceAssetPath(source, importer)
        return CSS_VIRTUAL_PREFIX + file + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exported] of Object.entries(cssExports ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
          classMap[local] = exported.name
        }
        return styleInjectionModule(id, fileId, code.toString(), classMap)
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      // Required even though Rolldown marks it deprecated: tsdown's
      // top-level codeSplitting switch does not force one artifact for this
      // CJS ModuleLoader factory, and emitted chunks are not registrable.
      inlineDynamicImports: true,
    },
  }
}

/** Build the local Node library and browser ModuleLoader factory together. */
export function clientBundle(
  id: string,
  libEntry: readonly string[],
  options: ClientBundleOptions = {},
): BuildFaceConfig {
  const manifest = localManifest(id)
  const lib = clientLibraryConfig(id, libEntry, manifest, options.lib)
  return () => [
    lib,
    clientConfig(id, 'src/client/index.ts', manifest),
  ]
}
