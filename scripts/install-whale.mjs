#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PET_ID = 'healing-whale-hit'
const RUNTIME_FILES = Object.freeze(['pet.json', 'voice.json', 'spritesheet.webp', 'NOTICE.md'])
const sourceDir = fileURLToPath(new URL(`../assets/pets/${PET_ID}/`, import.meta.url))

function parseArgs(argv) {
  const options = { dshHome: process.env.DSH_HOME?.trim() || join(homedir(), '.dsh') }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dsh-home') {
      const value = argv[index + 1]
      if (value === undefined || value.trim() === '') throw new Error('--dsh-home requires a path')
      options.dshHome = value
      index += 1
      continue
    }
    if (arg === '--check') {
      options.check = true
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function validateSource() {
  if (!existsSync(sourceDir)) throw new Error(`whale source is missing: ${sourceDir}`)
  const entries = readdirSync(sourceDir, { withFileTypes: true })
  const names = entries.filter(entry => entry.isFile()).map(entry => entry.name).sort()
  const expected = [...RUNTIME_FILES].sort()
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`whale source must contain only ${expected.join(', ')}`)
  }

  const manifest = JSON.parse(readFileSync(join(sourceDir, 'pet.json'), 'utf8'))
  if (manifest.petManifestVersion !== 2 || manifest.id !== PET_ID || manifest.renderer !== 'sprite2d') {
    throw new Error('whale manifest identity or renderer is invalid')
  }
  if (manifest.sprite2d?.spritesheetPath !== 'spritesheet.webp') {
    throw new Error('whale manifest does not point at spritesheet.webp')
  }
  return manifest
}

export function installWhale({ dshHome, check = false }) {
  const manifest = validateSource()
  const home = resolve(dshHome)
  const targetDir = join(home, 'pets', PET_ID)
  if (!check) {
    mkdirSync(targetDir, { recursive: true })
    for (const file of RUNTIME_FILES) copyFileSync(join(sourceDir, file), join(targetDir, file))
  }
  return {
    id: PET_ID,
    displayName: manifest.displayName,
    sourceDir,
    targetDir,
    installed: !check,
    files: [...RUNTIME_FILES],
  }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1])
if (invokedPath !== '' && invokedPath === resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = installWhale(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`aida-install-whale: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
