import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AIDA_ASSETS_ROUTE, resolveAidaAsset } from '../src/host/static-assets.ts'

const temporary: string[] = []

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('AIDA static asset route resolver', () => {
  it('serves a one-deep allowlisted image from the bundled assets root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aida-assets-'))
    temporary.push(root)
    writeFileSync(join(root, 'aida-background.png'), 'png')
    await expect(resolveAidaAsset(root, `${AIDA_ASSETS_ROUTE}/aida-background.png?v=4`))
      .resolves.toMatchObject({ ok: true, contentType: 'image/png', bytes: 3 })
  })

  it('rejects traversal, nested paths, and non-asset extensions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aida-assets-'))
    temporary.push(root)
    mkdirSync(join(root, 'nested'))
    writeFileSync(join(root, 'secret.txt'), 'secret')

    for (const path of [
      '/aida-ui-assets/..%2F..%2Fpackage.json',
      '/aida-ui-assets/pets/whale.webp',
      '/aida-ui-assets/secret.txt',
      '/aida-ui-assets',
    ]) {
      await expect(resolveAidaAsset(root, path)).resolves.toEqual({ ok: false, status: 404 })
    }
  })
})
