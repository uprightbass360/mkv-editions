import { describe, it, expect, vi, afterAll } from 'vitest'
import { expectedOutputs, unshellFirst } from './build'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectBuild, runBuild } from './build'

const _tmpDirs: string[] = []
function mktmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  _tmpDirs.push(d)
  return d
}

afterAll(() => {
  for (const d of _tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } }
})

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
  const dir = mktmp('mkved-out-')
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
  it('runs build.sh, streams percent + log lines, returns outputs (no collision)', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const calls: string[][] = []
    const spawnFn: any = (_cmd: string, args: string[]) => {
      calls.push(args)
      return calls.length === 1
        ? fakeChild({ code: 0 })
        : fakeChild({ stdout: ['mux start\n', 'Progress: 50%\n'], stderr: ['a warning\n'], code: 0 })
    }
    const pcts: number[] = []
    const logs: string[] = []
    const res = await runBuild({ version: 1 }, dir, false, (p) => pcts.push(p.percent), (l) => logs.push(l), { spawnFn })
    expect(res).toEqual({ ok: true, outputs: [join(dir, 'Movie.mkv')] })
    expect(pcts).toContain(50)
    expect(logs).toContain('mux start')
    expect(logs).toContain('a warning')
    expect(calls.length).toBe(2)
  })

  it('refuses when a target exists and overwrite is false, without running build.sh', async () => {
    const dir = outdirWith(SAMPLE_SH, ['Movie.mkv'])
    let n = 0
    const spawnFn: any = () => { n++; return fakeChild({ code: 0 }) }
    const res = await runBuild({ version: 1 }, dir, false, () => {}, () => {}, { spawnFn })
    expect(res).toEqual({ ok: false, error: 'overwrite-declined' })
    expect(n).toBe(1) // gen ran; bash build.sh did not
  })

  it('proceeds when a target exists and overwrite is true', async () => {
    const dir = outdirWith(SAMPLE_SH, ['Movie.mkv'])
    let n = 0
    const spawnFn: any = () => { n++; return fakeChild({ code: 0 }) }
    const res = await runBuild({ version: 1 }, dir, true, () => {}, () => {}, { spawnFn })
    expect(res).toEqual({ ok: true, outputs: [join(dir, 'Movie.mkv')] })
    expect(n).toBe(2)
  })

  it('returns an error when gen-editions exits nonzero', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const spawnFn: any = () => fakeChild({ stderr: ['bad project\n'], code: 1 })
    const res = await runBuild({ version: 1 }, dir, false, () => {}, () => {}, { spawnFn })
    expect(res).toEqual({ ok: false, error: 'bad project' })
  })

  it('surfaces a spawn error as an error result', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const spawnFn: any = () => fakeChild({ errorMsg: 'spawn python3 ENOENT' })
    const res = await runBuild({ version: 1 }, dir, false, () => {}, () => {}, { spawnFn })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('ENOENT')
  })

  it('passes --fast to gen when qpfile is off, and omits it when qpfile is on', async () => {
    const off = outdirWith(SAMPLE_SH)
    let offArgs: string[] = []
    await runBuild({ version: 1, qpfile: false }, off, false, () => {}, () => {}, {
      spawnFn: ((_c: string, args: string[]) => { if (!offArgs.length) offArgs = args; return fakeChild({ code: 0 }) }) as any,
    })
    expect(offArgs).toContain('--fast')

    const on = outdirWith(SAMPLE_SH)
    let onArgs: string[] = []
    await runBuild({ version: 1, qpfile: true }, on, false, () => {}, () => {}, {
      spawnFn: ((_c: string, args: string[]) => { if (!onArgs.length) onArgs = args; return fakeChild({ code: 0 }) }) as any,
    })
    expect(onArgs).not.toContain('--fast')
  })
})

describe('inspectBuild', () => {
  it('returns outputs and the subset that already exists in outdir', async () => {
    // outdir already has Movie.mkv; the temp gen dir will hold the sample build.sh
    const outdir = mktmp('mkved-realout-')
    writeFileSync(join(outdir, 'Movie.mkv'), 'old')
    const spawnFn: any = (_cmd: string, args: string[]) => {
      // gen writes build.sh into args[3] (the gen dir); emulate that here
      const genDir = args[3]
      writeFileSync(join(genDir, 'build.sh'), SAMPLE_SH)
      return fakeChild({ code: 0 })
    }
    const res = await inspectBuild({ version: 1 }, outdir, { spawnFn })
    expect(res).toEqual({ ok: true, outputs: ['Movie.mkv'], existing: ['Movie.mkv'] })
  })

  it('returns an error when gen-editions exits nonzero', async () => {
    const outdir = mktmp('mkved-realout-')
    const spawnFn: any = () => fakeChild({ stderr: ['bad project\n'], code: 1 })
    const res = await inspectBuild({ version: 1 }, outdir, { spawnFn })
    expect(res).toEqual({ ok: false, error: 'bad project' })
  })

  it('always runs gen-editions with --fast (inspect never frame-counts)', async () => {
    const outdir = mktmp('mkved-realout-')
    let genArgs: string[] = []
    const spawnFn: any = (_cmd: string, args: string[]) => {
      genArgs = args
      writeFileSync(join(args[3], 'build.sh'), SAMPLE_SH)
      return fakeChild({ code: 0 })
    }
    const res = await inspectBuild({ version: 1 }, outdir, { spawnFn })
    expect(res.ok).toBe(true)
    expect(genArgs).toContain('--fast')
  })
})
