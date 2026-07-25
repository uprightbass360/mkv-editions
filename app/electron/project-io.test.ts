import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeProjectFile, readProjectFile } from './project-io'

const _tmpDirs: string[] = []
function mktmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  _tmpDirs.push(d)
  return d
}

afterAll(() => {
  for (const d of _tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } }
})

describe('project-io', () => {
  it('writes atomically and reads back', async () => {
    const dir = mktmp('proj-')
    const p = join(dir, 't.mkvedproj')
    const obj = { version: 1, title: 'X', editions: [] }
    await writeProjectFile(p, obj)
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual(obj)
    expect(await readProjectFile(p)).toEqual(obj)
  })

  it('rejects invalid JSON on read', async () => {
    const dir = mktmp('proj-')
    const p = join(dir, 'bad.mkvedproj')
    writeFileSync(p, '{not json')
    await expect(readProjectFile(p)).rejects.toThrow()
  })
})
