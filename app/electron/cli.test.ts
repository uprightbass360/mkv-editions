import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCli } from './cli'

describe('resolveCli', () => {
  it('finds gen-editions.py and defaults python', () => {
    const { python, script, repoRoot } = resolveCli()
    expect(python).toBe('python3')
    expect(existsSync(script)).toBe(true)
    expect(script).toBe(repoRoot + '/src/gen-editions.py')
  })
})

describe('resolveCli packaged', () => {
  it('finds the bundled CLI via process.resourcesPath first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mkved-rp-'))
    mkdirSync(join(dir, 'cli'))
    writeFileSync(join(dir, 'cli', 'gen-editions.py'), '# stub')
    const prev = (process as any).resourcesPath
    try {
      ;(process as any).resourcesPath = dir
      const { python, script, repoRoot } = resolveCli()
      expect(python).toBe('python3')
      expect(script).toBe(join(dir, 'cli', 'gen-editions.py'))
      expect(repoRoot).toBe(dir)
    } finally {
      ;(process as any).resourcesPath = prev
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
