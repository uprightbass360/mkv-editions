import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeProjectFile, readProjectFile } from './project-io'

describe('project-io', () => {
  it('writes atomically and reads back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proj-'))
    const p = join(dir, 't.mkvedproj')
    const obj = { version: 1, title: 'X', editions: [] }
    await writeProjectFile(p, obj)
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual(obj)
    expect(await readProjectFile(p)).toEqual(obj)
  })

  it('rejects invalid JSON on read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proj-'))
    const p = join(dir, 'bad.mkvedproj')
    writeFileSync(p, '{not json')
    await expect(readProjectFile(p)).rejects.toThrow()
  })
})
