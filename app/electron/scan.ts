import { spawn } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { resolveCli } from './cli'

export interface ScanProgress { clip: string; done: number; total: number }
export type ScanResult =
  | { ok: true; data: Record<string, any> }
  | { ok: false; error: string }

const POSTER_MAX = 4 * 1024 * 1024

/** Replace disc.poster (a path) with disc.poster_data_url (base64), best-effort. */
export function enrichPoster(model: Record<string, any>): void {
  const disc = model?.disc
  if (!disc || typeof disc !== 'object') return
  const path = disc.poster
  delete disc.poster
  disc.poster_data_url = null
  if (!path || typeof path !== 'string') return
  try {
    if (statSync(path).size > POSTER_MAX) return
    const ext = extname(path).toLowerCase() === '.png' ? 'png' : 'jpeg'
    disc.poster_data_url = `data:image/${ext};base64,` + readFileSync(path).toString('base64')
  } catch { /* unreadable, stays null */ }
}

export function scanDisc(
  bdmv: string,
  cacheDir: string,
  onProgress: (p: ScanProgress) => void,
): Promise<ScanResult> {
  return new Promise((resolve) => {
    let python: string
    let script: string
    try {
      ;({ python, script } = resolveCli())
    } catch (e) {
      resolve({ ok: false, error: String((e as Error).message || e) })
      return
    }
    const child = spawn(python, [script, bdmv, '--scan-json', '--fast', '--cache', cacheDir])
    let out = ''
    let err = ''
    let errLine = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => {
      err += d
      errLine += d
      let nl: number
      while ((nl = errLine.indexOf('\n')) >= 0) {
        const line = errLine.slice(0, nl).trim()
        errLine = errLine.slice(nl + 1)
        if (!line.startsWith('{')) continue
        try {
          const j = JSON.parse(line)
          if (j.type === 'progress') onProgress({ clip: j.clip, done: j.done, total: j.total })
        } catch { /* not a progress line */ }
      }
    })
    child.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }))
    child.on('close', (code) => {
      if (code !== 0) { resolve({ ok: false, error: err.trim() || `scan exited ${code}` }); return }
      try {
        const data = JSON.parse(out)
        enrichPoster(data)
        resolve({ ok: true, data })
      }
      catch (e) { resolve({ ok: false, error: 'scan produced invalid JSON: ' + String(e) }) }
    })
  })
}
