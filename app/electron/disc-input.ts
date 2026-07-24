import { existsSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

/** True if dir/PLAYLIST holds at least one .mpls file. */
function hasPlaylist(dir: string): boolean {
  const pl = join(dir, 'PLAYLIST')
  try {
    return readdirSync(pl).some((f) => f.toLowerCase().endsWith('.mpls'))
  } catch {
    return false
  }
}

/**
 * Return the directory to pass gen-editions.py as <BDMV>: the one containing
 * PLAYLIST/*.mpls. Searches rootDir, rootDir/BDMV, then one nested level.
 */
export function findBdmv(rootDir: string): string | null {
  if (hasPlaylist(rootDir)) return rootDir
  const bd = join(rootDir, 'BDMV')
  if (hasPlaylist(bd)) return bd
  let children: string[]
  try {
    children = readdirSync(rootDir)
  } catch {
    return null
  }
  for (const name of children) {
    const child = join(rootDir, name)
    try {
      if (!statSync(child).isDirectory()) continue
    } catch {
      continue
    }
    const childBd = join(child, 'BDMV')
    if (hasPlaylist(childBd)) return childBd
    if (hasPlaylist(child)) return child
  }
  return null
}

export type ExtractProgress = { percent: number }

/**
 * Scan buf+chunk for complete "NN%" tokens, calling onPct once per token
 * (only for 0 < pct < 100), and return the unprocessed remainder (which may
 * hold a partial token like " 4" of a coming "45%").
 */
export function feedPercents(buf: string, chunk: string, onPct: (pct: number) => void): string {
  buf += chunk
  const re = /(\d{1,3})%/g
  let m: RegExpExecArray | null
  let lastEnd = 0
  while ((m = re.exec(buf))) {
    const pct = Math.min(100, parseInt(m[1], 10))
    if (pct > 0 && pct < 100) onPct(pct)
    lastEnd = re.lastIndex
  }
  // keep only the unprocessed remainder after the last full match (may hold a
  // partial token like " 4" of a coming "45%"); cap it so non-percent output
  // cannot grow the buffer without bound.
  buf = buf.slice(lastEnd)
  if (buf.length > 16) buf = buf.slice(-16)
  return buf
}

/** First of 7z/7za/unzip found on PATH, else null. */
export function detectZipTool(pathEnv: string = process.env.PATH || ''): string | null {
  const dirs = pathEnv.split(':').filter(Boolean)
  for (const name of ['7z', '7za', 'unzip']) {
    if (dirs.some((d) => existsSync(join(d, name)))) return name
  }
  return null
}

/** Extract zipPath into destDir with the given tool, streaming percent progress. */
export function extractZip(
  zipPath: string,
  destDir: string,
  onProgress: (p: ExtractProgress) => void,
  tool: string,
): Promise<string> {
  const args =
    tool === 'unzip'
      ? ['-o', zipPath, '-d', destDir]
      : ['x', zipPath, '-o' + destDir, '-y', '-bsp1']
  return new Promise((resolve, reject) => {
    onProgress({ percent: 0 })
    const child = spawn(tool, args)
    let err = ''
    let buf = ''
    child.stdout.on('data', (d) => {
      buf = feedPercents(buf, String(d), (pct) => onProgress({ percent: pct }))
    })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => reject(new Error(String(e.message || e))))
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(err.trim() || `${tool} exited ${code}`)); return }
      onProgress({ percent: 100 })
      resolve(destDir)
    })
  })
}

export type OpenInputResult =
  | { ok: true; bdmvPath: string }
  | { ok: false; error: string }
export type Selection = { kind: 'folder' | 'zip'; path: string }

const extractedDirs = new Set<string>()

export function cleanupExtractions(): void {
  for (const d of extractedDirs) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ }
  }
  extractedDirs.clear()
}

/** Route a user selection (folder or zip) to a BDMV path. */
export async function resolveInput(
  sel: Selection,
  onProgress: (p: ExtractProgress) => void,
  deps: { detect?: () => string | null } = {},
): Promise<OpenInputResult> {
  if (sel.kind === 'folder') {
    const bdmv = findBdmv(sel.path)
    return bdmv
      ? { ok: true, bdmvPath: bdmv }
      : { ok: false, error: `No BDMV/PLAYLIST found under ${sel.path}` }
  }
  const tool = (deps.detect ?? detectZipTool)()
  if (!tool) return { ok: false, error: 'No zip tool found - install 7z (p7zip) or unzip' }
  const dest = mkdtempSync(join(tmpdir(), 'mkved-zip-'))
  extractedDirs.add(dest)
  try {
    await extractZip(sel.path, dest, onProgress, tool)
  } catch (e) {
    try { rmSync(dest, { recursive: true, force: true }) } catch { /* ignore */ }
    extractedDirs.delete(dest)
    return { ok: false, error: String((e as Error).message || e) }
  }
  const bdmv = findBdmv(dest)
  return bdmv
    ? { ok: true, bdmvPath: bdmv }
    : { ok: false, error: `No BDMV/PLAYLIST found in the extracted archive` }
}

export function createOpener(deps: {
  showOpenDialog: (opts: any) => Promise<{ canceled: boolean; filePaths: string[] }>
  resolve?: typeof resolveInput
}) {
  let lastDir: string | undefined
  const resolve = deps.resolve ?? resolveInput
  async function openInput(
    kind: 'folder' | 'zip',
    onProgress: (p: ExtractProgress) => void,
  ): Promise<OpenInputResult | null> {
    const base = { defaultPath: lastDir ?? '/' }
    const opts =
      kind === 'folder'
        ? { ...base, properties: ['openDirectory'] }
        : { ...base, properties: ['openFile'], filters: [{ name: 'zip', extensions: ['zip'] }] }
    const r = await deps.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    const picked = r.filePaths[0]
    const res = await resolve({ kind, path: picked }, onProgress)
    if (res.ok) lastDir = dirname(picked)
    return res
  }
  return { openInput }
}
