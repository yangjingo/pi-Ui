#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PET_IDS = Object.freeze(['healing-whale-hit', 'burger-king-refined', 'flamingo-refined'])
export const RUNTIME_FILES = Object.freeze(['pet.json', 'voice.json', 'spritesheet.webp', 'NOTICE.md'])
const DEFAULT_PET_ID = 'healing-whale-hit'
const TRACKS = Object.freeze([
  'idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review',
])
const VOICE_SCENES = Object.freeze([
  'prepare', 'waiting', 'thinking', 'review', 'toolResult', 'done', 'failed', 'toolFailed',
  'maxTokens', 'interrupted', 'blocked',
])
const sourceRoot = fileURLToPath(new URL('../assets/pets/', import.meta.url))

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

function validatePet(id) {
  const sourceDir = join(sourceRoot, id)
  if (!existsSync(sourceDir)) throw new Error(`pet source is missing: ${sourceDir}`)
  const names = readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort()
  const expected = [...RUNTIME_FILES].sort()
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`${id} source must contain only ${expected.join(', ')}`)
  }

  const manifest = JSON.parse(readFileSync(join(sourceDir, 'pet.json'), 'utf8'))
  if (manifest.petManifestVersion !== 2 || manifest.id !== id || manifest.renderer !== 'sprite2d') {
    throw new Error(`${id} manifest identity or renderer is invalid`)
  }
  const sprite = manifest.sprite2d
  if (sprite?.spritesheetPath !== 'spritesheet.webp' || !Array.isArray(sprite.frames)) {
    throw new Error(`${id} sprite2d contract is invalid`)
  }
  if (sprite.frames.length !== TRACKS.length || sprite.frames.some(frames => frames <= 0)) {
    throw new Error(`${id} sprite2d frame table is invalid`)
  }
  if (JSON.stringify(Object.keys(sprite.tracks)) !== JSON.stringify(TRACKS)) {
    throw new Error(`${id} sprite2d tracks are invalid`)
  }
  for (const [index, track] of TRACKS.entries()) {
    const durations = sprite.tracks[track]?.durations
    if (!Array.isArray(durations) || durations.length !== sprite.frames[index]) {
      throw new Error(`${id} ${track} duration table is invalid`)
    }
    if (durations.some(duration => duration <= 0)) throw new Error(`${id} ${track} has a non-positive duration`)
  }

  const voice = JSON.parse(readFileSync(join(sourceDir, 'voice.json'), 'utf8'))
  if (voice.voicePackVersion !== 1 || JSON.stringify(Object.keys(voice.status)) !== JSON.stringify(VOICE_SCENES)) {
    throw new Error(`${id} voice scene table is invalid`)
  }
  return manifest
}

function seedDefaultPetSelection(home) {
  const persistPath = join(home, 'pet.json')
  const settingsPath = join(home, 'settings.yaml')
  const existing = existsSync(persistPath) ? JSON.parse(readFileSync(persistPath, 'utf8')) : {}
  const currentPersistId = typeof existing.petId === 'string' ? existing.petId : ''
  const persistSeeded = currentPersistId === '' || currentPersistId === 'whale-girl'
  if (persistSeeded) {
    writeFileSync(persistPath, `${JSON.stringify({ ...existing, petId: DEFAULT_PET_ID }, null, 2)}\n`, 'utf8')
  }

  let settingsSeeded = false
  if (existsSync(settingsPath)) {
    const yaml = readFileSync(settingsPath, 'utf8')
    const match = /^pet:\r?\n((?:[ \t].*(?:\r?\n|$))*)/m.exec(yaml)
    if (match) {
      const current = /^\s*petId:\s*(\S+)\s*$/m.exec(match[1])?.[1] ?? ''
      if (current === '' || current === 'whale-girl') {
        const body = match[1]
        const nextBody = /^\s*petId:/m.test(body)
          ? body.replace(/^(\s*petId:\s*)\S+.*$/m, `$1${DEFAULT_PET_ID}`)
          : `  petId: ${DEFAULT_PET_ID}\n${body}`
        writeFileSync(settingsPath, yaml.replace(match[0], `pet:\n${nextBody}`), 'utf8')
        settingsSeeded = true
      }
    } else {
      writeFileSync(
        settingsPath,
        `${yaml.endsWith('\n') ? yaml : `${yaml}\n`}pet:\n  petId: ${DEFAULT_PET_ID}\n`,
        'utf8',
      )
      settingsSeeded = true
    }
  }
  return { defaultPetId: DEFAULT_PET_ID, persistSeeded, settingsSeeded }
}

export function installPets({ dshHome, check = false }) {
  const pets = PET_IDS.map(id => {
    const manifest = validatePet(id)
    return {
      id,
      displayName: manifest.displayName,
      sourceDir: join(sourceRoot, id),
      targetDir: join(resolve(dshHome), 'pets', id),
      installed: !check,
      files: [...RUNTIME_FILES],
    }
  })

  const home = resolve(dshHome)
  const seeded = check ? {} : {
    ...seedDefaultPetSelection(home),
    petsHome: join(home, 'pets'),
  }
  if (!check) {
    for (const pet of pets) {
      mkdirSync(pet.targetDir, { recursive: true })
      for (const file of RUNTIME_FILES) {
        copyFileSync(join(pet.sourceDir, file), join(pet.targetDir, file))
      }
    }
  }
  return { installed: !check, pets, ...seeded }
}

export function main(argv = process.argv.slice(2)) {
  try {
    const result = installPets(parseArgs(argv))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1])
if (invokedPath !== '' && invokedPath === resolve(fileURLToPath(import.meta.url))) main()
