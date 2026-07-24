# Disc Input Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the workbench's front door from "a BDMV folder" to three input types - a ripped-disc folder, a ZIP archive, and an ISO (guidance-only) - all resolving to a BDMV directory the existing scan consumes, with the open dialog reachable to root-level mounts.

**Architecture:** One cohesive main-process module (`app/electron/disc-input.ts`) with `findBdmv` (discovery), `detectZipTool` + `extractZip` (ZIP), `resolveInput` (router), and `createOpener` (dialog + defaultPath state). A single `openInput(kind)` IPC replaces `pickBdmv` and feeds the unchanged `scanDisc`. The renderer gains three entry points, an ISO help panel, extraction progress, and an "encrypted image" banner. Nothing downstream of the resolved BDMV path changes.

**Tech Stack:** Electron main (tsup CJS, Node fs/child_process), SvelteKit adapter-static renderer (Svelte 5 runes), vitest (node env for electron, jsdom for renderer).

**Spec:** `docs/superpowers/specs/2026-07-23-disc-input-formats-design.md`

## Global Constraints

- No em-dashes in any repo file. Use "-".
- The renderer NEVER imports electron/fs/child_process; it calls `window.api.*` only. All fs/child-process/dialog work lives in `app/electron/`.
- Svelte 5 idioms only: `$props`/`$state`/`$derived`, callback props, lowercase handlers (`onclick`), `bind:`. NO `createEventDispatcher`, NO `on:` directives.
- Zero Svelte compiler warnings (svelte-check 0 errors 0 WARNINGS). A targeted single-rule `<!-- svelte-ignore ... -->` is the only acceptable suppression.
- Every main-to-renderer IPC reply is `{ok:true,...}` or `{ok:false,error}` (dialog-cancelled returns `null`).
- Additive to Increment 1: the scan, disc model, authoring, `.mkvedproj` contract, and the Python CLI are unchanged. `scanDisc(bdmvPath)` is called exactly as today.
- Two test runners: `cd app && npx vitest run` (electron, node env, `app/electron/**/*.test.ts`); `cd app/renderer && npx vitest run` (renderer, jsdom). `cd app && npm test` runs renderer; the electron suite runs via `cd app && npx vitest run`.
- Electron launches with `--no-sandbox` (already in the app's npm scripts).
- Do not modify `src/gen-editions.py` or `samples/`.

## Current code this plan modifies (verified)

- `app/electron/main.ts:53` - `ipcMain.handle('pickBdmv', ...)` (a directory dialog returning a path or null). REPLACED by `openInput`.
- `app/electron/preload.ts` - `api` object exposes `pickBdmv`; REPLACED by `openInput` + `onExtractProgress`.
- `app/renderer/src/app.d.ts` - `ElectronApi` has `pickBdmv`; REPLACED.
- `app/renderer/src/routes/+page.svelte` - header has one "Open BDMV..." button calling `pickAndScan()` which calls `window.api.pickBdmv()` then `scanDisc`. The scan-and-populate body is reused.
- `app/renderer/src/lib/model.ts` - `DiscModel` has `clips: Record<string, Clip>` where each `Clip` has `tracks: ClipTrack[]`. Gains `unreadableRatio`.

## File Structure

```
app/electron/
  disc-input.ts        findBdmv, detectZipTool, extractZip, resolveInput, createOpener, temp tracking + cleanup
  disc-input.test.ts   node-env tests for all of the above
  main.ts              (modify) openInput IPC + extract:progress + will-quit cleanup
  preload.ts           (modify) openInput + onExtractProgress, drop pickBdmv
app/renderer/src/
  app.d.ts             (modify) OpenInputResult, ExtractProgress, ElectronApi surface
  lib/model.ts         (modify) unreadableRatio
  lib/model.test.ts    (modify) unreadableRatio cases
  routes/+page.svelte  (modify) three entry points, ISO help, extract progress, encrypted banner
```

`disc-input.ts` is one module because the pieces are cohesive (all turn a user selection into a BDMV path) and small; splitting would scatter shared temp-dir state.

---

### Task 1: findBdmv discovery helper

**Files:**
- Create: `app/electron/disc-input.ts`, `app/electron/disc-input.test.ts`

**Interfaces:**
- Produces: `findBdmv(rootDir: string): string | null` - returns the directory containing `PLAYLIST/*.mpls`, searching `rootDir` itself, then `rootDir/BDMV`, then one nested level (`rootDir/<child>/BDMV` or `rootDir/<child>`). Null if none.

- [ ] **Step 1: Write the failing test** (`app/electron/disc-input.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findBdmv } from './disc-input'

function mkPlaylist(dir: string) {
  mkdirSync(join(dir, 'PLAYLIST'), { recursive: true })
  writeFileSync(join(dir, 'PLAYLIST', '00001.mpls'), 'x')
}

describe('findBdmv', () => {
  it('finds PLAYLIST at the root itself', () => {
    const root = mkdtempSync(join(tmpdir(), 'fb-'))
    mkPlaylist(root)
    expect(findBdmv(root)).toBe(root)
  })
  it('finds root/BDMV', () => {
    const root = mkdtempSync(join(tmpdir(), 'fb-'))
    mkPlaylist(join(root, 'BDMV'))
    expect(findBdmv(root)).toBe(join(root, 'BDMV'))
  })
  it('finds a nested DiscName/BDMV one level down', () => {
    const root = mkdtempSync(join(tmpdir(), 'fb-'))
    mkPlaylist(join(root, 'Disc', 'BDMV'))
    expect(findBdmv(root)).toBe(join(root, 'Disc', 'BDMV'))
  })
  it('returns null when no PLAYLIST with an mpls exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'fb-'))
    mkdirSync(join(root, 'PLAYLIST'), { recursive: true }) // empty, no .mpls
    expect(findBdmv(root)).toBe(null)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run electron/disc-input.test.ts`
Expected: FAIL - `findBdmv` not exported.

- [ ] **Step 3: Implement `findBdmv` in `app/electron/disc-input.ts`**

```ts
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
```

(`existsSync` is imported here because later tasks in this same file use it; leaving it imported now avoids a churn edit. If your linter flags it as unused at this step, add the import in Task 2 instead.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run electron/disc-input.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/electron/disc-input.ts app/electron/disc-input.test.ts
git commit -m "findBdmv: locate the BDMV directory under any picked root"
```

---

### Task 2: detectZipTool and extractZip

**Files:**
- Modify: `app/electron/disc-input.ts`, `app/electron/disc-input.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime.
- Produces:
  - `detectZipTool(pathEnv?: string): string | null` - returns `'7z'`, `'7za'`, or `'unzip'` (first found on PATH), else null.
  - `type ExtractProgress = { percent: number }`.
  - `extractZip(zipPath: string, destDir: string, onProgress: (p: ExtractProgress) => void, tool: string): Promise<string>` - spawns the tool to extract into `destDir`, fires `onProgress` with `{percent:0}` at start, parsed percents for `7z`/`7za` (`-bsp1`), and `{percent:100}` on success; resolves `destDir`; rejects with stderr on nonzero exit.

- [ ] **Step 1: Write the failing test** (append to `app/electron/disc-input.test.ts`)

```ts
import { execFileSync } from 'node:child_process'
import { detectZipTool, extractZip } from './disc-input'

describe('detectZipTool', () => {
  it('returns null when PATH has none of the tools', () => {
    expect(detectZipTool('/nonexistent-dir')).toBe(null)
  })
})

describe('extractZip', () => {
  const tool = detectZipTool()
  const canZip = tool === '7z' || tool === '7za'
  it.runIf(canZip)('extracts a zip so findBdmv can locate the BDMV, and fires progress', async () => {
    const work = mkdtempSync(join(tmpdir(), 'ez-'))
    // build a source tree with a BDMV/PLAYLIST/*.mpls
    mkPlaylist(join(work, 'src', 'BDMV'))
    const zip = join(work, 'disc.zip')
    execFileSync(tool as string, ['a', zip, join(work, 'src')], { stdio: 'ignore' })
    const dest = mkdtempSync(join(tmpdir(), 'ez-out-'))
    const pcts: number[] = []
    const out = await extractZip(zip, dest, (p) => pcts.push(p.percent), tool as string)
    expect(out).toBe(dest)
    expect(findBdmv(dest)).not.toBe(null)
    expect(pcts[0]).toBe(0)
    expect(pcts[pcts.length - 1]).toBe(100)
  }, 30_000)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run electron/disc-input.test.ts`
Expected: FAIL - `detectZipTool`/`extractZip` not exported. (The extract case is skipped if no 7z; that is expected on a machine without it, but this repo has `/usr/bin/7z`.)

- [ ] **Step 3: Implement in `app/electron/disc-input.ts`** (add below `findBdmv`)

```ts
import { spawn } from 'node:child_process'

export type ExtractProgress = { percent: number }

/** First of 7z/7za/unzip found on PATH, else null. */
export function detectZipTool(pathEnv: string = process.env.PATH || ''): string | null {
  const dirs = pathEnv.split(':').filter(Boolean)
  for (const name of ['7z', '7za', 'unzip']) {
    if (dirs.some((d) => existsSync(join(d, name)))) return name
  }
  return null
}

/** Extract zipPath into destDir with the given tool, streaming percent progress. */
export function extractZip(
  zipPath: string,
  destDir: string,
  onProgress: (p: ExtractProgress) => void,
  tool: string,
): Promise<string> {
  const args =
    tool === 'unzip'
      ? ['-o', zipPath, '-d', destDir]
      : ['x', zipPath, '-o' + destDir, '-y', '-bsp1']
  return new Promise((resolve, reject) => {
    onProgress({ percent: 0 })
    const child = spawn(tool, args)
    let err = ''
    let buf = ''
    child.stdout.on('data', (d) => {
      buf += d
      let m: RegExpExecArray | null
      const re = /(\d{1,3})%/g
      while ((m = re.exec(buf))) {
        const pct = Math.min(100, parseInt(m[1], 10))
        if (pct > 0 && pct < 100) onProgress({ percent: pct })
      }
      buf = buf.slice(-8) // keep a small tail for split percents
    })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => reject(new Error(String(e.message || e))))
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(err.trim() || `${tool} exited ${code}`)); return }
      onProgress({ percent: 100 })
      resolve(destDir)
    })
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run electron/disc-input.test.ts`
Expected: PASS (detectZipTool + extractZip; extract case runs because 7z is present).

- [ ] **Step 5: Commit**

```bash
git add app/electron/disc-input.ts app/electron/disc-input.test.ts
git commit -m "detectZipTool + extractZip: PATH tool detection and progress-reporting extraction"
```

---

### Task 3: resolveInput router and temp-dir cleanup

**Files:**
- Modify: `app/electron/disc-input.ts`, `app/electron/disc-input.test.ts`

**Interfaces:**
- Consumes: `findBdmv`, `detectZipTool`, `extractZip`, `ExtractProgress`.
- Produces:
  - `type OpenInputResult = { ok: true; bdmvPath: string } | { ok: false; error: string }`.
  - `type Selection = { kind: 'folder' | 'zip'; path: string }`.
  - `resolveInput(sel: Selection, onProgress: (p: ExtractProgress) => void, deps?: { detect?: () => string | null }): Promise<OpenInputResult>` - folder -> `findBdmv`; zip -> detect tool (error if none), mkdtemp a tracked dir, `extractZip`, `findBdmv`. Errors: no-BDMV, missing tool, extraction failure (cleans the temp dir).
  - `cleanupExtractions(): void` - remove all tracked temp dirs.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { resolveInput, cleanupExtractions } from './disc-input'

describe('resolveInput', () => {
  it('resolves a folder to its BDMV path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ri-'))
    mkPlaylist(join(root, 'BDMV'))
    const res = await resolveInput({ kind: 'folder', path: root }, () => {})
    expect(res).toEqual({ ok: true, bdmvPath: join(root, 'BDMV') })
  })
  it('errors when a folder has no BDMV', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ri-'))
    const res = await resolveInput({ kind: 'folder', path: root }, () => {})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/No BDMV/i)
  })
  it('errors with an install hint when no zip tool is available', async () => {
    const res = await resolveInput(
      { kind: 'zip', path: '/x.zip' }, () => {}, { detect: () => null },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/7z|unzip/i)
  })
  const tool = detectZipTool()
  const canZip = tool === '7z' || tool === '7za'
  it.runIf(canZip)('resolves a zipped BDMV', async () => {
    const work = mkdtempSync(join(tmpdir(), 'ri-'))
    mkPlaylist(join(work, 'src', 'BDMV'))
    const zip = join(work, 'disc.zip')
    execFileSync(tool as string, ['a', zip, join(work, 'src')], { stdio: 'ignore' })
    const res = await resolveInput({ kind: 'zip', path: zip }, () => {})
    expect(res.ok).toBe(true)
    if (res.ok) expect(findBdmv(res.bdmvPath) === res.bdmvPath || res.bdmvPath.length > 0).toBe(true)
    cleanupExtractions()
  }, 30_000)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run electron/disc-input.test.ts`
Expected: FAIL - `resolveInput`/`cleanupExtractions` not exported.

- [ ] **Step 3: Implement in `app/electron/disc-input.ts`**

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

export type OpenInputResult =
  | { ok: true; bdmvPath: string }
  | { ok: false; error: string }
export type Selection = { kind: 'folder' | 'zip'; path: string }

const extractedDirs = new Set<string>()

export function cleanupExtractions(): void {
  for (const d of extractedDirs) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ }
  }
  extractedDirs.clear()
}

export async function resolveInput(
  sel: Selection,
  onProgress: (p: ExtractProgress) => void,
  deps: { detect?: () => string | null } = {},
): Promise<OpenInputResult> {
  if (sel.kind === 'folder') {
    const bdmv = findBdmv(sel.path)
    return bdmv
      ? { ok: true, bdmvPath: bdmv }
      : { ok: false, error: `No BDMV/PLAYLIST found under ${sel.path}` }
  }
  const tool = (deps.detect ?? detectZipTool)()
  if (!tool) return { ok: false, error: 'No zip tool found - install 7z (p7zip) or unzip' }
  const dest = mkdtempSync(join(tmpdir(), 'mkved-zip-'))
  extractedDirs.add(dest)
  try {
    await extractZip(sel.path, dest, onProgress, tool)
  } catch (e) {
    try { rmSync(dest, { recursive: true, force: true }) } catch { /* ignore */ }
    extractedDirs.delete(dest)
    return { ok: false, error: String((e as Error).message || e) }
  }
  const bdmv = findBdmv(dest)
  return bdmv
    ? { ok: true, bdmvPath: bdmv }
    : { ok: false, error: `No BDMV/PLAYLIST found in the extracted archive` }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run electron/disc-input.test.ts`
Expected: PASS (all resolveInput cases).

- [ ] **Step 5: Commit**

```bash
git add app/electron/disc-input.ts app/electron/disc-input.test.ts
git commit -m "resolveInput: route folder/zip to a BDMV path, track temp dirs for cleanup"
```

---

### Task 4: createOpener (dialog + root defaultPath) and openInput IPC

**Files:**
- Modify: `app/electron/disc-input.ts`, `app/electron/disc-input.test.ts`, `app/electron/main.ts`, `app/electron/preload.ts`, `app/renderer/src/app.d.ts`

**Interfaces:**
- Consumes: `resolveInput`, `OpenInputResult`, `ExtractProgress`, `cleanupExtractions`.
- Produces:
  - In `disc-input.ts`: `createOpener(deps: { showOpenDialog: (opts: any) => Promise<{ canceled: boolean; filePaths: string[] }>; resolve?: typeof resolveInput }) => { openInput: (kind: 'folder' | 'zip', onProgress: (p: ExtractProgress) => void) => Promise<OpenInputResult | null> }`. Uses `defaultPath: '/'` on the first open and `dirname(lastPickedPath)` after a successful resolve.
  - IPC `openInput` (invoke) returning `OpenInputResult | null`; `extract:progress` (main->renderer send).
  - `window.api.openInput(kind: 'folder'|'zip'): Promise<OpenInputResult | null>` and `window.api.onExtractProgress(cb): () => void`. `pickBdmv` is removed from preload and `app.d.ts`.

- [ ] **Step 1: Write the failing test** for `createOpener` (append to `disc-input.test.ts`)

```ts
import { createOpener } from './disc-input'

describe('createOpener defaultPath', () => {
  it('uses / first, then the dirname of the last successful pick', async () => {
    const calls: any[] = []
    const opener = createOpener({
      showOpenDialog: async (opts) => { calls.push(opts); return { canceled: false, filePaths: ['/mnt/br/BDMV'] } },
      resolve: async () => ({ ok: true, bdmvPath: '/mnt/br/BDMV' }),
    })
    await opener.openInput('folder', () => {})
    await opener.openInput('folder', () => {})
    expect(calls[0].defaultPath).toBe('/')
    expect(calls[1].defaultPath).toBe('/mnt/br')
  })
  it('returns null when the dialog is cancelled', async () => {
    const opener = createOpener({
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      resolve: async () => ({ ok: true, bdmvPath: 'x' }),
    })
    expect(await opener.openInput('zip', () => {})).toBe(null)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run electron/disc-input.test.ts`
Expected: FAIL - `createOpener` not exported.

- [ ] **Step 3: Implement `createOpener` in `app/electron/disc-input.ts`** (add `dirname` to the `node:path` import)

```ts
// update the path import at the top of the file to:
// import { join, dirname } from 'node:path'

export function createOpener(deps: {
  showOpenDialog: (opts: any) => Promise<{ canceled: boolean; filePaths: string[] }>
  resolve?: typeof resolveInput
}) {
  let lastDir: string | undefined
  const resolve = deps.resolve ?? resolveInput
  async function openInput(
    kind: 'folder' | 'zip',
    onProgress: (p: ExtractProgress) => void,
  ): Promise<OpenInputResult | null> {
    const base = { defaultPath: lastDir ?? '/' }
    const opts =
      kind === 'folder'
        ? { ...base, properties: ['openDirectory'] }
        : { ...base, properties: ['openFile'], filters: [{ name: 'zip', extensions: ['zip'] }] }
    const r = await deps.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    const picked = r.filePaths[0]
    const res = await resolve({ kind, path: picked }, onProgress)
    if (res.ok) lastDir = dirname(picked)
    return res
  }
  return { openInput }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run electron/disc-input.test.ts`
Expected: PASS (createOpener cases + all prior).

- [ ] **Step 5: Wire the IPC in `app/electron/main.ts`**

Replace the `pickBdmv` handler (line 53) with:
```ts
import { createOpener, cleanupExtractions } from './disc-input'
const opener = createOpener({ showOpenDialog: (opts) => dialog.showOpenDialog(opts) })
ipcMain.handle('openInput', async (event, kind: 'folder' | 'zip') =>
  opener.openInput(kind, (p) => event.sender.send('extract:progress', p)))
```
And add cleanup on quit near the existing `window-all-closed` line:
```ts
app.on('will-quit', () => cleanupExtractions())
```

- [ ] **Step 6: Update `app/electron/preload.ts`** - remove `pickBdmv`, add:
```ts
  openInput: (kind: 'folder' | 'zip') => ipcRenderer.invoke('openInput', kind),
  onExtractProgress: (cb: (p: { percent: number }) => void) => {
    const h = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on('extract:progress', h)
    return () => ipcRenderer.removeListener('extract:progress', h)
  },
```

- [ ] **Step 7: Update `app/renderer/src/app.d.ts`** - remove `pickBdmv` from `ElectronApi`, add the types and methods:
```ts
  type OpenInputResult = { ok: true; bdmvPath: string } | { ok: false; error: string }
  interface ExtractProgress { percent: number }
```
and in `ElectronApi`:
```ts
    openInput: (kind: 'folder' | 'zip') => Promise<OpenInputResult | null>
    onExtractProgress: (cb: (p: ExtractProgress) => void) => () => void
```

- [ ] **Step 8: Build to confirm both sides compile** (the renderer still references `pickBdmv` until Task 5, so build the electron side only here)

Run: `cd app && npm run build:electron && npx vitest run`
Expected: tsup build clean, all electron tests pass. (`npm run build:renderer` and svelte-check will fail until Task 5 updates `+page.svelte` - that is expected and fixed in Task 5.)

- [ ] **Step 9: Commit**

```bash
git add app/electron/disc-input.ts app/electron/disc-input.test.ts app/electron/main.ts app/electron/preload.ts app/renderer/src/app.d.ts
git commit -m "openInput IPC: root-default dialog + resolveInput, drop pickBdmv, cleanup on quit"
```

---

### Task 5: Renderer entry points, ISO help, extraction progress

**Files:**
- Modify: `app/renderer/src/routes/+page.svelte`

**Interfaces:**
- Consumes: `window.api.openInput`, `window.api.onExtractProgress`, `window.api.scanDisc`, `window.api.onScanProgress` (all from `app.d.ts`).
- Produces: the shell with three entry points (Open folder / Open ZIP / Open ISO help), a toggled ISO help panel, extraction progress text, and the scan wired to the resolved `bdmvPath`. Replaces the single `pickAndScan`/"Open BDMV..." button.

- [ ] **Step 1: Replace the script's open/scan logic**

In `app/renderer/src/routes/+page.svelte`, replace the `pickAndScan` function with `openAndScan` + a `scanInto` helper and an ISO toggle. The new script region (keeping all existing imports, `pickAndOpen`, `apply`, and the derived views):

```ts
  let showIso = $state(false)

  async function scanInto(bdmv: string) {
    let off: (() => void) | undefined
    try {
      off = window.api.onScanProgress((p) => { progress = `probing ${p.clip} (${p.done}/${p.total})` })
      const res = await window.api.scanDisc(bdmv)
      if (!res.ok) { progress = 'scan failed: ' + res.error; return }
      model = res.data as DiscModel
      let p = newProject(model.bdmv)
      const feat = longestRealPlaylist(model)
      if (feat) {
        const pl = model.playlists.find((x) => x.file === feat)!
        p = importPlaylist(p, pl)
        progress = `scan complete - suggested feature ${feat}`
      } else progress = 'scan complete'
      project = p
    } finally { off?.() }
  }

  async function openAndScan(kind: 'folder' | 'zip') {
    scanning = true
    progress = kind === 'zip' ? 'extracting...' : 'opening...'
    let offX: (() => void) | undefined
    try {
      if (kind === 'zip') offX = window.api.onExtractProgress((p) => { progress = `extracting ${p.percent}%` })
      const res = await window.api.openInput(kind)
      if (!res) { progress = ''; return }
      if (!res.ok) { progress = 'open failed: ' + res.error; return }
      offX?.(); offX = undefined
      await scanInto(res.bdmvPath)
    } finally { offX?.(); scanning = false }
  }
```

Add `unreadableRatio` to the model import (it is added in Task 6; for this task import it now so the banner in Step 2 compiles - if Task 6 has not run yet, add a temporary local `const encrypted = false` instead and replace it in Task 6). To keep tasks independent, this task uses a literal `false` for `encrypted`; Task 6 replaces it.

- [ ] **Step 2: Replace the header markup**

Replace the `<header>` block's first button and add the ISO panel + banner:

```svelte
<header class="flex items-center gap-2.5 border-b border-slate-700 p-2">
  <button class="rounded bg-indigo-600 px-3 py-1" onclick={() => openAndScan('folder')} disabled={scanning}>Open folder...</button>
  <button class="rounded bg-indigo-600 px-3 py-1" onclick={() => openAndScan('zip')} disabled={scanning}>Open ZIP...</button>
  <button class="rounded bg-slate-700 px-2 py-1" onclick={() => (showIso = !showIso)}>Open ISO...</button>
  <button class="rounded bg-slate-700 px-2 py-1" onclick={pickAndOpen}>Open project...</button>
  {#if project}
    <input class="bg-slate-800 px-1" bind:value={project.title} />
    <select class="bg-slate-800" bind:value={project.mode}>
      <option value="flat">flat</option><option value="linked">linked</option><option value="xin1">xin1</option>
    </select>
    <label><input type="checkbox" bind:checked={project.preserve_chapters} /> preserve chapters</label>
    <button class="rounded bg-slate-700 px-2 py-1" onclick={async () => { if (project) await window.api.saveProject(toMkvedproj(project), project.title) }}>Save project...</button>
  {/if}
  <span class="ml-auto text-xs opacity-70">{progress}</span>
</header>

{#if showIso}
  <div class="border-b border-slate-700 bg-slate-800 p-2 text-xs">
    <p>Mount the ISO first, then use "Open folder..." on the mount point:</p>
    <pre class="mt-1 whitespace-pre-wrap">sudo mount -o loop,ro your-disc.iso /mnt/disc
# or rootless (Linux desktop):
udisksctl loop-setup -f your-disc.iso</pre>
  </div>
{/if}
```

- [ ] **Step 3: Build, typecheck, and run the full renderer suite**

Run: `cd app && npm run build && npm run check --workspace renderer && cd renderer && npx vitest run`
Expected: build clean, svelte-check 0 errors 0 WARNINGS, renderer tests pass. (If svelte-check warns on the ISO `<pre>` or a button, add a single-rule `<!-- svelte-ignore ... -->`; do not blanket-ignore.)

- [ ] **Step 4: Launch check**

Run: `cd app && timeout 25 npm start`
Expected: the `[main] did-finish-load` then `[main] ready-to-show` logs, no crash. The header now shows Open folder / Open ZIP / Open ISO. Record the logs.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/routes/+page.svelte
git commit -m "Workbench: Open folder/ZIP/ISO entry points, ISO help panel, extraction progress"
```

---

### Task 6: Encrypted-image banner

**Files:**
- Modify: `app/renderer/src/lib/model.ts`, `app/renderer/src/lib/model.test.ts`, `app/renderer/src/routes/+page.svelte`

**Interfaces:**
- Consumes: `DiscModel` (existing).
- Produces: `unreadableRatio(m: DiscModel): number` - the fraction of clips with zero `tracks` (0 when there are no clips). The shell shows a banner when the ratio exceeds 0.5.

- [ ] **Step 1: Write the failing test** (append to `app/renderer/src/lib/model.test.ts`)

```ts
import { unreadableRatio } from './model'

describe('unreadableRatio', () => {
  it('is high when most clips have zero tracks', () => {
    const m: any = { clips: {
      a: { tracks: [] }, b: { tracks: [] }, c: { tracks: [{ tid: 0, type: 'video', pid: 1 }] },
    } }
    expect(unreadableRatio(m)).toBeCloseTo(2 / 3)
    expect(unreadableRatio(m) > 0.5).toBe(true)
  })
  it('is 0 for a healthy disc and 0 for no clips', () => {
    expect(unreadableRatio({ clips: { a: { tracks: [{ tid: 0, type: 'video', pid: 1 }] } } } as any)).toBe(0)
    expect(unreadableRatio({ clips: {} } as any)).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/model.test.ts`
Expected: FAIL - `unreadableRatio` not exported.

- [ ] **Step 3: Implement in `app/renderer/src/lib/model.ts`** (append)

```ts
/** Fraction of clips with zero decodable tracks (a symptom of an encrypted image). */
export function unreadableRatio(m: DiscModel): number {
  const ids = Object.keys(m.clips)
  if (ids.length === 0) return 0
  const bad = ids.filter((id) => m.clips[id].tracks.length === 0).length
  return bad / ids.length
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the banner in `+page.svelte`**

Add `unreadableRatio` to the `$lib/model` import, replace the Task-5 placeholder with a derived value:
```ts
  let encrypted = $derived(model ? unreadableRatio(model) > 0.5 : false)
```
and add the banner just after the ISO `{#if showIso}` block:
```svelte
{#if encrypted}
  <div class="border-b border-amber-600 bg-amber-900/40 p-2 text-xs">
    Most clips are unreadable - this image may be AACS-encrypted or not decrypted.
  </div>
{/if}
```

- [ ] **Step 6: Full verification**

Run: `cd app && npm run build && npm run check --workspace renderer && npx vitest run && cd renderer && npx vitest run`
Expected: build clean, svelte-check 0/0, electron tests pass, renderer tests pass.

- [ ] **Step 7: Update the README input section**

In `README.md`, add one short subsection near the wrapper/usage docs noting the app now accepts a ripped-disc folder, a ZIP archive, or a pre-mounted ISO (with the mount one-liner), and that a mostly-unreadable scan indicates an encrypted image. Keep it terse and in the repo's voice; no em-dashes.

- [ ] **Step 8: Commit**

```bash
git add app/renderer/src/lib/model.ts app/renderer/src/lib/model.test.ts app/renderer/src/routes/+page.svelte README.md
git commit -m "Encrypted-image banner: flag a mostly-unreadable scan; document input formats"
```

---

## Self-review notes

- Spec coverage: findBdmv discovery incl. disc-root pick (T1); ZIP extract + tool detection (T2); resolveInput router + temp cleanup + missing-tool/no-BDMV/extraction-failure errors (T3); openInput IPC + root defaultPath + last-used (T4); three renderer entry points + ISO guidance + extraction progress (T5); encrypted-image banner (T6). Validation against the real disc is the manual checklist in the spec's Validation section, run after T6.
- Type consistency: `OpenInputResult`/`ExtractProgress`/`Selection` defined in T2-T4 and used identically in preload/app.d.ts/renderer; `findBdmv`/`resolveInput`/`createOpener` signatures match across tasks; `scanDisc(bdmvPath)` is the unchanged Increment-1 call.
- Two-runner discipline: electron modules tested with `cd app && npx vitest run`; renderer with `cd app/renderer && npx vitest run`. Task 4 Step 8 deliberately builds only the electron side because the renderer is mid-migration; Task 5 restores a green full build.
- Placeholder note: Task 5 uses a literal `false` for `encrypted` so it is independently testable; Task 6 replaces it with the real derived value. This is called out in both tasks, not left implicit.
