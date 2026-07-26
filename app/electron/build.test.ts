import { describe, it, expect, vi, afterAll } from 'vitest'
import { expectedOutputs, unshellFirst, friendlyToolError } from './build'
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

function fakeChild(opts: { stdout?: string[]; stderr?: string[]; code?: number; errorMsg?: string; err?: string }) {
  const child: any = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  queueMicrotask(() => {
    if (opts.errorMsg) { child.emit('error', new Error(opts.errorMsg)); return }
    for (const s of opts.stdout ?? []) child.stdout.emit('data', s)
    for (const s of opts.stderr ?? []) child.stderr.emit('data', s)
    if (opts.err) child.stderr.emit('data', opts.err)
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

describe('friendlyToolError', () => {
  it('maps missing tools to install hints and passes other errors through', () => {
    expect(friendlyToolError('spawn python3 ENOENT')).toMatch(/python3 not found/i)
    expect(friendlyToolError('/bin/sh: mkvmerge: command not found')).toMatch(/mkvtoolnix/i)
    expect(friendlyToolError('ffprobe: not found')).toMatch(/ffmpeg/i)
    expect(friendlyToolError('some unrelated failure')).toBe('some unrelated failure')
  })
})

describe('runBuild', () => {
  it('surfaces a friendly message when the muxer is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mkved-fte-'))
    // gen succeeds (writes a build.sh), build spawn fails as if mkvmerge is absent.
    let call = 0
    const spawnFn: any = (cmd: string) => {
      call++
      // first spawn = gen-editions (python) writes build.sh and exits 0
      if (call === 1) { writeFileSync(join(dir, 'build.sh'), 'mkvmerge -o out.mkv in.mkv\n'); return fakeChild({ code: 0 }) }
      // second spawn = the build (bash build.sh) fails with a not-found stderr
      return fakeChild({ code: 1, err: '/bin/sh: 1: mkvmerge: not found' })
    }
    const res = await runBuild({ version: 1 }, dir, true, () => {}, () => {}, { spawnFn })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/mkvtoolnix/i)
    rmSync(dir, { recursive: true, force: true })
  })

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

  it('streams carriage-return progress lines to the log (mkvmerge uses CR)', async () => {
    const dir = outdirWith(SAMPLE_SH)
    let n = 0
    const spawnFn: any = () => {
      n++
      return n === 1 ? fakeChild({ code: 0 }) : fakeChild({ stdout: ['Muxing\rProgress: 10%\rProgress: 20%\r'], code: 0 })
    }
    const logs: string[] = []
    await runBuild({ version: 1 }, dir, false, () => {}, (l) => logs.push(l), { spawnFn })
    expect(logs).toContain('Muxing')
    expect(logs).toContain('Progress: 20%')
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

  it('surfaces a spawn error as a friendly missing-tool message', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const spawnFn: any = () => fakeChild({ errorMsg: 'spawn python3 ENOENT' })
    const res = await runBuild({ version: 1 }, dir, false, () => {}, () => {}, { spawnFn })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/python3 not found/i)
  })

  it('always passes --fast to gen (frame-counting a disc build is impractical)', async () => {
    for (const qpfile of [false, true]) {
      const dir = outdirWith(SAMPLE_SH)
      let genArgs: string[] = []
      await runBuild({ version: 1, qpfile }, dir, false, () => {}, () => {}, {
        spawnFn: ((_c: string, args: string[]) => { if (!genArgs.length) genArgs = args; return fakeChild({ code: 0 }) }) as any,
      })
      expect(genArgs).toContain('--fast')
    }
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
