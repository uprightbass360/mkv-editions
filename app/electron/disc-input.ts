import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

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
      buf += d
      let m: RegExpExecArray | null
      const re = /(\d{1,3})%/g
      while ((m = re.exec(buf))) {
        const pct = Math.min(100, parseInt(m[1], 10))
        if (pct > 0 && pct < 100) onProgress({ percent: pct })
      }
      buf = buf.slice(-8) // keep a small tail for split percents
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
