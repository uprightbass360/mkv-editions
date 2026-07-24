import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
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

export interface BuildProgress { percent: number }
export type BuildResult =
  | { ok: true; outputs: string[] }
  | { ok: false; error: string }

/** Promisified single spawn: resolves { code, err } (code -1 on spawn error). */
function spawnOnce(
  spawnFn: typeof spawn,
  cmd: string,
  args: string[],
  cwd: string | undefined,
  onStdout?: (chunk: string) => void,
): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const child = spawnFn(cmd, args, cwd ? { cwd } : {})
    let err = ''
    child.stdout?.on('data', (d: any) => onStdout?.(String(d)))
    child.stderr?.on('data', (d: any) => { err += d })
    child.on('error', (e: any) => resolve({ code: -1, err: String(e?.message || e) }))
    child.on('close', (code: number | null) => resolve({ code: code ?? 0, err }))
  })
}

/** Generate build.sh from the project, gate on overwrite, then mux. */
export async function runBuild(
  json: unknown,
  outdir: string,
  confirmOverwrite: (names: string[]) => Promise<boolean>,
  onProgress: (p: BuildProgress) => void,
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
    // Step 1: generate build.sh (+ aux files) into outdir. No MKV yet.
    const gen = await spawnOnce(sp, cli.python, [cli.script, '--project', tmpProject, outdir], undefined)
    if (gen.code !== 0) return { ok: false, error: gen.err.trim() || `gen-editions exited ${gen.code}` }
    // Step 2: overwrite gate.
    let names: string[]
    try { names = expectedOutputs(readFileSync(join(outdir, 'build.sh'), 'utf8')) }
    catch (e) { return { ok: false, error: 'could not read generated build.sh: ' + String((e as Error).message || e) } }
    const existing = names.filter((n) => existsSync(join(outdir, n)))
    if (existing.length && !(await confirmOverwrite(existing))) {
      return { ok: false, error: 'cancelled' }
    }
    // Step 3: mux via the hardened build.sh.
    let buf = ''
    const build = await spawnOnce(sp, 'bash', ['build.sh'], outdir, (chunk) => {
      buf = feedPercents(buf, chunk, (pct) => onProgress({ percent: pct }))
    })
    if (build.code !== 0) return { ok: false, error: build.err.trim() || `build exited ${build.code}` }
    return { ok: true, outputs: names.map((n) => join(outdir, n)) }
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) }
  } finally {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ } }
  }
}

/** Folder-pick + build, remembering the last output dir. */
export function createBuilder(deps: {
  showOpenDialog: (opts: any) => Promise<{ canceled: boolean; filePaths: string[] }>
  confirmOverwrite: (names: string[]) => Promise<boolean>
  run?: typeof runBuild
}) {
  let lastDir: string | undefined
  const run = deps.run ?? runBuild
  async function buildProject(
    json: unknown,
    onProgress: (p: BuildProgress) => void,
  ): Promise<BuildResult | null> {
    const r = await deps.showOpenDialog({ properties: ['openDirectory'], defaultPath: lastDir ?? '/' })
    if (r.canceled || r.filePaths.length === 0) return null
    const outdir = r.filePaths[0]
    lastDir = outdir
    return run(json, outdir, deps.confirmOverwrite, onProgress)
  }
  return { buildProject }
}
