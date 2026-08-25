import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const petsDir = join(root, 'assets', 'pets')
const whaleDir = join(petsDir, 'healing-whale-hit')
const tracks = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review']
const temporary: string[] = []

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('AIDA whale pack', () => {
  it('ships only the requested whale with a complete sprite2d contract', () => {
    expect(readdirSync(petsDir)).toEqual(['healing-whale-hit'])
    expect(readdirSync(whaleDir).sort()).toEqual(['NOTICE.md', 'pet.json', 'spritesheet.webp', 'voice.json'])

    const manifest = JSON.parse(readFileSync(join(whaleDir, 'pet.json'), 'utf8'))
    expect(manifest).toMatchObject({
      petManifestVersion: 2,
      id: 'healing-whale-hit',
      displayName: '鲸得起打',
      renderer: 'sprite2d',
      sprite2d: {
        spritesheetPath: 'spritesheet.webp',
        cell: { width: 192, height: 208 },
        columns: 8,
        atlasRows: 9,
        frames: [6, 8, 8, 4, 5, 8, 6, 6, 6],
      },
    })
    expect(Object.keys(manifest.sprite2d.tracks)).toEqual(tracks)
    for (const [index, track] of tracks.entries()) {
      expect(manifest.sprite2d.tracks[track].durations).toHaveLength(manifest.sprite2d.frames[index])
      expect(manifest.sprite2d.tracks[track].durations.every((duration: number) => duration > 0)).toBe(true)
    }
  })

  it('keeps the eleven runtime voice scenes and tool placeholders intact', () => {
    const voice = JSON.parse(readFileSync(join(whaleDir, 'voice.json'), 'utf8'))
    expect(voice.voicePackVersion).toBe(1)
    expect(Object.keys(voice.status)).toHaveLength(11)
    expect(voice.tools.generic.join(' ')).toContain('{tool}')
    expect(voice.toolRemaining.join(' ')).toContain('{n}')
    expect(voice.panel.labels.feed).toBe('投喂小鱼干')
  })

  it('installs only the runtime files into an isolated DSH home', () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'aida-whale-'))
    temporary.push(dshHome)
    const output = execFileSync(process.execPath, [
      join(root, 'scripts', 'install-whale.mjs'),
      '--dsh-home', dshHome,
    ], { encoding: 'utf8' })
    const result = JSON.parse(output)
    expect(result).toMatchObject({ id: 'healing-whale-hit', displayName: '鲸得起打', installed: true })
    expect(readdirSync(join(dshHome, 'pets'))).toEqual(['healing-whale-hit'])
    expect(readdirSync(join(dshHome, 'pets', 'healing-whale-hit')).sort())
      .toEqual(['NOTICE.md', 'pet.json', 'spritesheet.webp', 'voice.json'])
  })
})
