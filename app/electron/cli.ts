import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface CliPaths { python: string; script: string; repoRoot: string }

/** Locate gen-editions.py: the electron-builder bundled copy first
 * (process.resourcesPath/cli), else walk up to the repo's src/ (dev). */
export function resolveCli(): CliPaths {
  const python = process.env.MKVED_PYTHON || 'python3'
  const rp = process.resourcesPath
  if (rp) {
    const bundled = join(rp, 'cli', 'gen-editions.py')
    if (existsSync(bundled)) return { python, script: bundled, repoRoot: dirname(dirname(bundled)) }
  }
  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    const script = join(dir, 'src', 'gen-editions.py')
    if (existsSync(script)) return { python, script, repoRoot: dir }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('could not locate gen-editions.py (bundled or in a repo checkout)')
}
