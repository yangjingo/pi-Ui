import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('standalone build pipeline', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
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
})
