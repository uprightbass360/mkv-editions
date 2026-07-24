import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface CliPaths { python: string; script: string; repoRoot: string }

/** Walk up from this file until a dir contains src/gen-editions.py. */
export function resolveCli(): CliPaths {
  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    const script = join(dir, 'src', 'gen-editions.py')
    if (existsSync(script)) {
      return { python: process.env.MKVED_PYTHON || 'python3', script, repoRoot: dir }
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('could not locate src/gen-editions.py above ' + __dirname)
}
