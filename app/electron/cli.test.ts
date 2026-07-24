import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolveCli } from './cli'

describe('resolveCli', () => {
  it('finds gen-editions.py and defaults python', () => {
    const { python, script, repoRoot } = resolveCli()
    expect(python).toBe('python3')
    expect(existsSync(script)).toBe(true)
    expect(script).toBe(repoRoot + '/src/gen-editions.py')
  })
})
