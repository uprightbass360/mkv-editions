import { writeFile, rename, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function writeProjectFile(path: string, json: unknown): Promise<void> {
  const tmp = join(dirname(path), `.${Date.now()}.tmp`)
  await writeFile(tmp, JSON.stringify(json, null, 2))
  await rename(tmp, path)
}

export async function readProjectFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}
