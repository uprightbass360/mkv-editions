import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanDisc, enrichPoster } from './scan'
import { resolveCli } from './cli'

let bdmv: string
let cache: string

beforeAll(() => {
  const { repoRoot, python } = resolveCli()
  const out = mkdtempSync(join(tmpdir(), 'mkved-sample-'))
  execFileSync(python, [join(repoRoot, 'samples/make-sample.py'), out], { stdio: 'ignore' })
  bdmv = join(out, 'BDMV')
  cache = mkdtempSync(join(tmpdir(), 'mkved-cache-'))
})

describe('scanDisc', () => {
  it('parses the disc model and reports progress', async () => {
    const seen: number[] = []
    const res = await scanDisc(bdmv, cache, (p) => seen.push(p.done))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const m = res.data
    const files = m.playlists.map((p: any) => p.file).sort()
    expect(files).toContain('00003.mpls')
    expect(m.playlists.find((p: any) => p.file === '00003.mpls').angles).toBe(2)
    expect(Object.keys(m.clips).length).toBeGreaterThan(0)
    expect(seen.length).toBe(Object.keys(m.clips).length)
  }, 60_000)

  it('returns ok:false on a bad path', async () => {
    const res = await scanDisc('/no/such/bdmv', cache, () => {})
    expect(res.ok).toBe(false)
  })
})

describe('enrichPoster', () => {
  it('replaces a poster path with a base64 data url and drops the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poster-'))
    const jpg = join(dir, 'p.jpg')
    writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))
    const model: any = { disc: { title: 'X', poster: jpg } }
    enrichPoster(model)
    expect(model.disc.poster).toBeUndefined()
    expect(model.disc.poster_data_url).toMatch(/^data:image\/jpeg;base64,/)
  })
  it('yields null when the poster is missing or disc is absent', () => {
    const m1: any = { disc: { title: 'X', poster: '/no/such.jpg' } }
    enrichPoster(m1)
    expect(m1.disc.poster_data_url).toBe(null)
    const m2: any = {}
    enrichPoster(m2) // must not throw when disc is absent
    expect(m2.disc).toBeUndefined()
  })
})
