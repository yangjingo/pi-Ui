import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('standalone build pipeline', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
    version?: string
  }
  const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.client.json'), 'utf8')) as {
    references?: unknown[]
  }
  const tsdownConfig = readFileSync(join(root, 'tsdown.config.ts'), 'utf8')

  it('compiles types before creating the plugin bundles', () => {
    expect(manifest.scripts?.bundle).toBe('tsc -b tsconfig.client.json && tsdown')
    expect(manifest.devDependencies?.lightningcss).toBeDefined()
  })

  it('keeps project references and the tsdown preset plugin-local', () => {
    expect(tsconfig.references).toBeUndefined()
    expect(tsdownConfig).toContain("from './tsdown.client.ts'")
    expect(tsdownConfig).not.toContain("from '../tsdown.client.ts'")
  })

  it('bundles the live Host source rather than stale generated type output', () => {
    expect(tsdownConfig).toContain("['src/index.ts', 'src/invariant.ts']")
    expect(tsdownConfig).not.toContain("['lib/types/index.js', 'lib/types/invariant.js']")
  })

  it('prints a versioned AIDA startup banner from the Host half', () => {
    const source = readFileSync(join(root, 'src', 'index.ts'), 'utf8')
    const shipped = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
    expect(source).toContain(`const PACKAGE_VERSION = '${manifest.version}'`)
    expect(source).toContain('[aida-ui] 插件已加载 v${PACKAGE_VERSION}')
    expect(shipped).toContain('[aida-ui] 插件已加载 v${PACKAGE_VERSION}')
  })
})
