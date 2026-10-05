#!/usr/bin/env node
/**
 * Copy @deepseek-ai platform packages out of the installed DSH desktop
 * client's app.asar so the AIDA plugin can type-check against the exact
 * runtime version (e.g. 0.2.0-rc.2). Must run under Electron-as-node
 * (ELECTRON_RUN_AS_NODE=1) so fs can read inside the archive.
 *
 * Usage: extract-dsh-asar-packages.mjs <app.asar> <destDir>
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [asarPath, destDir] = process.argv.slice(2)
if (!asarPath || !destDir) {
  console.error('usage: extract-dsh-asar-packages.mjs <app.asar> <destDir>')
  process.exit(2)
}

const srcRoot = join(asarPath, 'dsh', 'node_modules')
let files = 0

function copyRecursive(src, dest) {
  const s = statSync(src)
  if (s.isDirectory()) {
    mkdirSync(dest, { recursive: true })
    for (const name of readdirSync(src)) {
      if (name === '.bin' || name.startsWith('.')) continue
      copyRecursive(join(src, name), join(dest, name))
    }
  } else if (s.isFile()) {
    mkdirSync(join(dest, '..'), { recursive: true })
    writeFileSync(dest, readFileSync(src))
    files += 1
  }
}

mkdirSync(destDir, { recursive: true })
copyRecursive(srcRoot, destDir)

const versions = {}
const scoped = join(destDir, '@deepseek-ai')
for (const name of readdirSync(scoped)) {
  try {
    const pj = JSON.parse(readFileSync(join(scoped, name, 'package.json'), 'utf8'))
    versions[pj.name] = pj.version
  } catch {}
}
console.log('copied files:', files)
console.log('scoped packages:', Object.keys(versions).length)
console.log(JSON.stringify(versions, null, 1))
