import { describe, it, expect, vi } from 'vitest'
import { expectedOutputs, unshellFirst } from './build'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBuild, createBuilder } from './build'

function fakeChild(opts: { stdout?: string[]; stderr?: string[]; code?: number; errorMsg?: string }) {
  const child: any = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  queueMicrotask(() => {
    if (opts.errorMsg) { child.emit('error', new Error(opts.errorMsg)); return }
    for (const s of opts.stdout ?? []) child.stdout.emit('data', s)
    for (const s of opts.stderr ?? []) child.stderr.emit('data', s)
    child.emit('close', opts.code ?? 0)
  })
  return child
}

function outdirWith(buildSh: string, existingTargets: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'mkved-out-'))
  writeFileSync(join(dir, 'build.sh'), buildSh)
  for (const t of existingTargets) writeFileSync(join(dir, t), 'old')
  return dir
}

const SAMPLE_SH = "#!/usr/bin/env bash\nset -euo pipefail\n\nmkvmerge -o 'Movie.mkv' a.m2ts\n"

describe('unshellFirst', () => {
  it('reads a bare token up to the next space', () => {
    expect(unshellFirst('seg0.mkv --no-chapters foo')).toBe('seg0.mkv')
  })
  it('reads a single-quoted token with spaces and braces', () => {
    expect(unshellFirst("'Movie {edition-Theatrical}.mkv' --chapters c.xml")).toBe('Movie {edition-Theatrical}.mkv')
  })
  it('decodes an inner single quote encoded by shlex.quote', () => {
    // shlex.quote("Rock 'n' Roll.mkv") -> 'Rock '"'"'n'"'"' Roll.mkv'
    const s = "'Rock '\"'\"'n'\"'\"' Roll.mkv' --x"
    expect(unshellFirst(s)).toBe("Rock 'n' Roll.mkv")
  })
})

describe('expectedOutputs', () => {
  it('collects the -o targets from a flat build.sh', () => {
    const sh = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      "mkvmerge -o 'Movie {edition-Theatrical}.mkv' --chapters 'Movie {edition-Theatrical}.chapters.xml' foo.m2ts",
      "mkvmerge -o 'Movie {edition-Extended}.mkv' bar.m2ts",
    ].join('\n')
    expect(expectedOutputs(sh)).toEqual([
      'Movie {edition-Theatrical}.mkv',
      'Movie {edition-Extended}.mkv',
    ])
  })
  it('ignores non-mkvmerge lines', () => {
    expect(expectedOutputs('echo hi\nmkvmerge -o out.mkv a.m2ts\n')).toEqual(['out.mkv'])
  })
})

describe('runBuild', () => {
  it('generates, finds no collision, runs build.sh, streams percent, returns outputs', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const calls: string[][] = []
    const spawnFn: any = (_cmd: string, args: string[]) => {
      calls.push(args)
      // first call = gen (success, build.sh already on disk); second = bash build.sh
      return calls.length === 1 ? fakeChild({ code: 0 }) : fakeChild({ stdout: ['Progress: 50%\n'], code: 0 })
    }
    const seen: number[] = []
    const confirm = vi.fn(async () => true)
    const res = await runBuild({ version: 1 }, dir, confirm, (p) => seen.push(p.percent), { spawnFn })
    expect(res).toEqual({ ok: true, outputs: [join(dir, 'Movie.mkv')] })
    expect(confirm).not.toHaveBeenCalled()
    expect(seen).toContain(50)
    expect(calls.length).toBe(2)
    // no temp mkvedproj left in tmpdir roots we created (the build dir has only build.sh + nothing extra)
    expect(existsSync(join(dir, 'build.sh'))).toBe(true)
  })

  it('asks to confirm when a target exists and aborts on Cancel without running build.sh', async () => {
    const dir = outdirWith(SAMPLE_SH, ['Movie.mkv'])
    let n = 0
    const spawnFn: any = () => { n++; return fakeChild({ code: 0 }) }
    const confirm = vi.fn(async () => false)
    const res = await runBuild({ version: 1 }, dir, confirm, () => {}, { spawnFn })
    expect(confirm).toHaveBeenCalledWith(['Movie.mkv'])
    expect(res).toEqual({ ok: false, error: 'cancelled' })
    expect(n).toBe(1) // only the gen spawn ran, not bash build.sh
  })

  it('returns an error when gen-editions exits nonzero', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const spawnFn: any = () => fakeChild({ stderr: ['bad project\n'], code: 1 })
    const res = await runBuild({ version: 1 }, dir, async () => true, () => {}, { spawnFn })
    expect(res).toEqual({ ok: false, error: 'bad project' })
  })

  it('surfaces a spawn error (e.g. python missing) as an error result', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const spawnFn: any = () => fakeChild({ errorMsg: 'spawn python3 ENOENT' })
    const res = await runBuild({ version: 1 }, dir, async () => true, () => {}, { spawnFn })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('ENOENT')
  })
})

describe('createBuilder', () => {
  it('returns null when the folder picker is cancelled', async () => {
    const run = vi.fn()
    const b = createBuilder({
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      confirmOverwrite: async () => true, run: run as any,
    })
    expect(await b.buildProject({}, () => {})).toBe(null)
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the build in the chosen dir and passes confirmOverwrite through', async () => {
    const run = vi.fn(async () => ({ ok: true, outputs: ['/out/Movie.mkv'] }))
    const confirmOverwrite = async () => true
    const b = createBuilder({
      showOpenDialog: async () => ({ canceled: false, filePaths: ['/out'] }),
      confirmOverwrite, run: run as any,
    })
    const res = await b.buildProject({ version: 1 }, () => {})
    expect(res).toEqual({ ok: true, outputs: ['/out/Movie.mkv'] })
    expect(run).toHaveBeenCalledWith({ version: 1 }, '/out', confirmOverwrite, expect.any(Function))
  })
})
