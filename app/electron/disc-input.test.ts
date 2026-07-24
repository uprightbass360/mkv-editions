import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findBdmv, detectZipTool, extractZip, feedPercents, resolveInput, cleanupExtractions } from './disc-input'

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

describe('feedPercents', () => {
  it('emits each percent exactly once across chunk boundaries, incl. a split token', () => {
    const seen: number[] = []
    let buf = ''
    buf = feedPercents(buf, ' 10%', (p) => seen.push(p))
    buf = feedPercents(buf, ' 20%', (p) => seen.push(p))
    buf = feedPercents(buf, ' 30%', (p) => seen.push(p))
    buf = feedPercents(buf, ' 45', (p) => seen.push(p))
    buf = feedPercents(buf, '%', (p) => seen.push(p))
    expect(seen).toEqual([10, 20, 30, 45])
  })
})

describe('detectZipTool', () => {
  it('returns null when PATH has none of the tools', () => {
    expect(detectZipTool('/nonexistent-dir')).toBe(null)
  })
})

describe('extractZip', () => {
  const tool = detectZipTool()
  const canZip = tool === '7z' || tool === '7za'
  it.runIf(canZip)('extracts a zip so findBdmv can locate the BDMV, and fires progress', async () => {
    const work = mkdtempSync(join(tmpdir(), 'ez-'))
    // build a source tree with a BDMV/PLAYLIST/*.mpls
    mkPlaylist(join(work, 'src', 'BDMV'))
    const zip = join(work, 'disc.zip')
    execFileSync(tool as string, ['a', zip, join(work, 'src')], { stdio: 'ignore' })
    const dest = mkdtempSync(join(tmpdir(), 'ez-out-'))
    const pcts: number[] = []
    const out = await extractZip(zip, dest, (p) => pcts.push(p.percent), tool as string)
    expect(out).toBe(dest)
    expect(findBdmv(dest)).not.toBe(null)
    expect(pcts[0]).toBe(0)
    expect(pcts[pcts.length - 1]).toBe(100)
  }, 30_000)
})

describe('resolveInput', () => {
  it('resolves a folder to its BDMV path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ri-'))
    mkPlaylist(join(root, 'BDMV'))
    const res = await resolveInput({ kind: 'folder', path: root }, () => {})
    expect(res).toEqual({ ok: true, bdmvPath: join(root, 'BDMV') })
  })
  it('errors when a folder has no BDMV', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ri-'))
    const res = await resolveInput({ kind: 'folder', path: root }, () => {})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/No BDMV/i)
  })
  it('errors with an install hint when no zip tool is available', async () => {
    const res = await resolveInput(
      { kind: 'zip', path: '/x.zip' }, () => {}, { detect: () => null },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/7z|unzip/i)
  })
  const tool = detectZipTool()
  const canZip = tool === '7z' || tool === '7za'
  it.runIf(canZip)('resolves a zipped BDMV', async () => {
    const work = mkdtempSync(join(tmpdir(), 'ri-'))
    mkPlaylist(join(work, 'src', 'BDMV'))
    const zip = join(work, 'disc.zip')
    execFileSync(tool as string, ['a', zip, join(work, 'src')], { stdio: 'ignore' })
    const res = await resolveInput({ kind: 'zip', path: zip }, () => {})
    expect(res.ok).toBe(true)
    if (res.ok) expect(findBdmv(res.bdmvPath) === res.bdmvPath || res.bdmvPath.length > 0).toBe(true)
    cleanupExtractions()
  }, 30_000)
})
