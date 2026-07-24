import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findBdmv } from './disc-input'

function mkPlaylist(dir: string) {
  mkdirSync(join(dir, 'PLAYLIST'), { recursive: true })
  writeFileSync(join(dir, 'PLAYLIST', '00001.mpls'), 'x')
}

describe('findBdmv', () => {
  it('finds PLAYLIST at the root itself', () => {
    const root = mkdtempSync(join(tmpdir(), 'fb-'))
    mkPlaylist(root)
    expect(findBdmv(root)).toBe(root)
  })
  it('finds root/BDMV', () => {
    const root = mkdtempSync(join(tmpdir(), 'fb-'))
    mkPlaylist(join(root, 'BDMV'))
    expect(findBdmv(root)).toBe(join(root, 'BDMV'))
  })
  it('finds a nested DiscName/BDMV one level down', () => {
    const root = mkdtempSync(join(tmpdir(), 'fb-'))
    mkPlaylist(join(root, 'Disc', 'BDMV'))
    expect(findBdmv(root)).toBe(join(root, 'Disc', 'BDMV'))
  })
  it('returns null when no PLAYLIST with an mpls exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'fb-'))
    mkdirSync(join(root, 'PLAYLIST'), { recursive: true }) // empty, no .mpls
    expect(findBdmv(root)).toBe(null)
  })
})
