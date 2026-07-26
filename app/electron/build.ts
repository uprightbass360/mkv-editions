import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveCli } from './cli'
import { feedPercents } from './disc-input'

/** Decode the first shell token as Python shlex.quote produces it: a bare
 * token (read to the next space), or a single-quoted string whose inner single
 * quotes are encoded as the 5-char sequence '"'"' (close, "'", reopen). */
export function unshellFirst(s: string): string {
  if (s[0] !== "'") {
    const sp = s.indexOf(' ')
    return sp < 0 ? s : s.slice(0, sp)
  }
  let i = 1
  let res = ''
  while (i < s.length) {
    if (s[i] === "'") {
      if (s.slice(i, i + 5) === `'"'"'`) { res += "'"; i += 5; continue }
      break
    }
    res += s[i]
    i++
  }
  return res
}

/** The -o target filenames (in order) a generated build.sh will write. */
export function expectedOutputs(buildSh: string): string[] {
  const out: string[] = []
  const prefix = 'mkvmerge -o '
  for (const raw of buildSh.split('\n')) {
    const line = raw.trimStart()
    if (!line.startsWith(prefix)) continue
    out.push(unshellFirst(line.slice(prefix.length)))
  }
  return out
}

/** Map a raw spawn/gen/build error to a human message so a missing system
 * tool never reads as a hang. Unknown errors pass through unchanged. */
export function friendlyToolError(raw: string): string {
  const s = raw.toLowerCase()
  const missing = (name: string) =>
    s.includes(name) && (s.includes('enoent') || s.includes('not found') || s.includes('command not found'))
  if (missing('python3')) return 'python3 not found - install Python 3 and ensure it is on PATH'
  if (missing('mkvmerge')) return 'mkvmerge not found - install MKVToolNix'
  if (missing('ffprobe')) return 'ffprobe not found - install FFmpeg'
  return raw
}

export interface BuildProgress { percent: number }
export type BuildResult =
  | { ok: true; outputs: string[] }
  | { ok: false; error: string }

export interface BuildLog { line: string }
export type InspectResult =
  | { ok: true; outputs: string[]; existing: string[] }
  | { ok: false; error: string }

/** Promisified single spawn: resolves { code, err } (code -1 on spawn error). */
function spawnOnce(
  spawnFn: typeof spawn,
  cmd: string,
  args: string[],
  cwd: string | undefined,
  onStdout?: (chunk: string) => void,
  onStderr?: (chunk: string) => void,
): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const child = spawnFn(cmd, args, cwd ? { cwd } : {})
    let err = ''
    child.stdout?.on('data', (d: any) => onStdout?.(String(d)))
    child.stderr?.on('data', (d: any) => { err += d; onStderr?.(String(d)) })
    child.on('error', (e: any) => resolve({ code: -1, err: String(e?.message || e) }))
    child.on('close', (code: number | null) => resolve({ code: code ?? 0, err }))
  })
}

/** Emit each complete line from buf+chunk, breaking on \n OR \r (mkvmerge
 * reports progress as "Progress: NN%\r" with no newline, so \r-only output
 * would otherwise never stream). Empty segments (e.g. the \n of a \r\n) are
 * skipped. Returns the unterminated remainder. */
function emitLines(buf: string, chunk: string, onLine: (line: string) => void): string {
  buf += chunk
  let i: number
  while ((i = buf.search(/[\r\n]/)) >= 0) {
    const line = buf.slice(0, i)
    if (line) onLine(line)
    buf = buf.slice(i + 1)
  }
  return buf
}

/** Preflight: generate build.sh in a throwaway dir, return the output names and
 * which already exist in outdir. Never writes to outdir. */
export async function inspectBuild(
  json: unknown,
  outdir: string,
  deps: { spawnFn?: typeof spawn } = {},
): Promise<InspectResult> {
  const sp = deps.spawnFn ?? spawn
  let cli
  try { cli = resolveCli() } catch (e) { return { ok: false, error: String((e as Error).message || e) } }
  let tmpDir: string | undefined
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'mkved-inspect-'))
    const tmpProject = join(tmpDir, 'project.mkvedproj')
    const genDir = join(tmpDir, 'gen')
    mkdirSync(genDir)
    writeFileSync(tmpProject, JSON.stringify(json))
    // --fast: inspect only needs the output filenames from build.sh, never
    // frame-accurate probing. Without it, gen-editions frame-counts every real
    // m2ts end-to-end (minutes on a mounted disc) and the modal hangs.
    const gen = await spawnOnce(sp, cli.python, [cli.script, '--project', tmpProject, genDir, '--fast'], undefined)
    if (gen.code !== 0) return { ok: false, error: friendlyToolError(gen.err.trim() || `gen-editions exited ${gen.code}`) }
    let names: string[]
    try { names = expectedOutputs(readFileSync(join(genDir, 'build.sh'), 'utf8')) }
    catch (e) { return { ok: false, error: 'could not read generated build.sh: ' + String((e as Error).message || e) } }
    const existing = names.filter((n) => existsSync(join(outdir, n)))
    return { ok: true, outputs: names, existing }
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) }
  } finally {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ } }
  }
}

/** Generate build.sh into outdir, gate on the overwrite flag, then mux, streaming
 * percent + log lines. */
export async function runBuild(
  json: unknown,
  outdir: string,
  overwrite: boolean,
  onProgress: (p: BuildProgress) => void,
  onLog: (line: string) => void,
  deps: { spawnFn?: typeof spawn } = {},
): Promise<BuildResult> {
  const sp = deps.spawnFn ?? spawn
  let cli
  try { cli = resolveCli() } catch (e) { return { ok: false, error: String((e as Error).message || e) } }
  let tmpDir: string | undefined
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'mkved-build-'))
    const tmpProject = join(tmpDir, 'project.mkvedproj')
    writeFileSync(tmpProject, JSON.stringify(json))
    // Always --fast: the only thing non-fast adds is frame counting (for
    // qpfile), and -count_frames decodes every clip end-to-end - minutes to
    // tens-of-minutes per m2ts on a real disc, i.e. the build appears hung at
    // 0%. Disc builds cannot afford it, so qpfile is not offered in the app.
    const gen = await spawnOnce(sp, cli.python, [cli.script, '--project', tmpProject, outdir, '--fast'], undefined)
    if (gen.code !== 0) return { ok: false, error: friendlyToolError(gen.err.trim() || `gen-editions exited ${gen.code}`) }
    let names: string[]
    try { names = expectedOutputs(readFileSync(join(outdir, 'build.sh'), 'utf8')) }
    catch (e) { return { ok: false, error: 'could not read generated build.sh: ' + String((e as Error).message || e) } }
    const existing = names.filter((n) => existsSync(join(outdir, n)))
    if (existing.length && !overwrite) return { ok: false, error: 'overwrite-declined' }
    let pbuf = ''
    let outLine = ''
    let errLine = ''
    const build = await spawnOnce(sp, 'bash', ['build.sh'], outdir,
      (chunk) => {
        pbuf = feedPercents(pbuf, chunk, (pct) => onProgress({ percent: pct }))
        outLine = emitLines(outLine, chunk, onLog)
      },
      (chunk) => { errLine = emitLines(errLine, chunk, onLog) },
    )
    if (outLine) onLog(outLine)
    if (errLine) onLog(errLine)
    if (build.code !== 0) return { ok: false, error: friendlyToolError(build.err.trim() || `build exited ${build.code}`) }
    return { ok: true, outputs: names.map((n) => join(outdir, n)) }
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) }
  } finally {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ } }
  }
}
