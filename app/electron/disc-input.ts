import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

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
