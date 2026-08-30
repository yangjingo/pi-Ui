import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const petsDir = join(root, 'assets', 'pets')
const petIds = ['burger-king-refined', 'flamingo-refined', 'healing-whale-hit'] as const
const runtimeFiles = ['NOTICE.md', 'pet.json', 'spritesheet.webp', 'voice.json'] as const
const tracks = [
  'idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review',
] as const
const temporary: string[] = []

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('AIDA pet packs', () => {
  it('ships the whale plus the two requested companions with complete sprite contracts', () => {
    expect(readdirSync(petsDir).sort()).toEqual([...petIds])

    for (const id of petIds) {
      const petDir = join(petsDir, id)
      expect(readdirSync(petDir).sort()).toEqual([...runtimeFiles])
      const manifest = JSON.parse(readFileSync(join(petDir, 'pet.json'), 'utf8'))
      expect(manifest).toMatchObject({
        petManifestVersion: 2,
        id,
        renderer: 'sprite2d',
        sprite2d: {
          spritesheetPath: 'spritesheet.webp',
          cell: { width: 192, height: 208 },
          columns: 8,
          atlasRows: 9,
        },
      })
      expect(Object.keys(manifest.sprite2d.tracks)).toEqual(tracks)
      for (const [index, track] of tracks.entries()) {
        expect(manifest.sprite2d.tracks[track].durations).toHaveLength(manifest.sprite2d.frames[index])
        expect(manifest.sprite2d.tracks[track].durations.every((duration: number) => duration > 0)).toBe(true)
      }

      const voice = JSON.parse(readFileSync(join(petDir, 'voice.json'), 'utf8'))
      expect(voice.voicePackVersion).toBe(1)
      expect(Object.keys(voice.status)).toHaveLength(11)
    }
  })

  it('installs all three runtime packs without source frames into an isolated DSH home', () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'aida-pets-'))
    temporary.push(dshHome)
    const output = execFileSync(process.execPath, [
      join(root, 'scripts', 'install-pets.mjs'),
      '--dsh-home', dshHome,
    ], { encoding: 'utf8' })
    const result = JSON.parse(output)
    expect(result).toMatchObject({ installed: true, defaultPetId: 'healing-whale-hit' })
    expect(result.pets.map(pet => pet.id)).toEqual([
      'healing-whale-hit', 'burger-king-refined', 'flamingo-refined',
    ])
    expect(readdirSync(join(dshHome, 'pets')).sort()).toEqual([...petIds])
    for (const id of petIds) {
      expect(readdirSync(join(dshHome, 'pets', id)).sort()).toEqual([...runtimeFiles])
    }
  })

  it('keeps the legacy whale command as an alias over the multi-pet installer', () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'aida-whale-'))
    temporary.push(dshHome)
    const output = execFileSync(process.execPath, [
      join(root, 'scripts', 'install-whale.mjs'),
      '--dsh-home', dshHome,
    ], { encoding: 'utf8' })
    const result = JSON.parse(output)
    expect(result).toMatchObject({ installed: true, defaultPetId: 'healing-whale-hit' })
    expect(result.pets).toHaveLength(3)
  })
})
