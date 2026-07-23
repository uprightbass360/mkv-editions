import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanDisc } from './scan'
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
