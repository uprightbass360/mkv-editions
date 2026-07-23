import { spawn } from 'node:child_process'
import { resolveCli } from './cli'

export interface ScanProgress { clip: string; done: number; total: number }
export type ScanResult =
  | { ok: true; data: Record<string, any> }
  | { ok: false; error: string }

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
      try { resolve({ ok: true, data: JSON.parse(out) }) }
      catch (e) { resolve({ ok: false, error: 'scan produced invalid JSON: ' + String(e) }) }
    })
  })
}
