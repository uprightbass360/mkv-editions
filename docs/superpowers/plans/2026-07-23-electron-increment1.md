# Electron + SvelteKit Workbench - Increment 1 (Runnable Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable Electron desktop app whose renderer is a SvelteKit (adapter-static) SPA, aligned to the owner's ARM ui-neu stack (Vite 8, Svelte 5, TS 6, vitest 4, Tailwind 4). It scans a real BDMV via the existing `gen-editions.py --scan-json --fast`, shows a duration-sorted clip library and playlist list that stay usable at retail-disc scale (~170 playlists), lets you author editions by dragging clips into tracks, and saves a `.mkvedproj` the CLI can build headlessly.

**Architecture:** An `app/` npm-workspaces project. The **electron** side (`app/electron/`) is built to CJS by **tsup**: `main.ts` (window + IPC + `file:` protocol interception) and `preload.ts` (`contextBridge` `window.api`). The **renderer** (`app/renderer/`) is a SvelteKit workspace prerendered to a static SPA by `adapter-static`; Electron loads it via an intercepted `file:///` in production and the Vite dev-server URL in dev. There is NO electron-vite (the Vite 8 stack cannot use it). The renderer's pure logic (disc-model derivation, project model) lives in `src/lib/` and is unit-tested; Svelte components are thin.

**Tech Stack:** Electron 43, tsup 8, TypeScript 6, SvelteKit 2 + @sveltejs/adapter-static 3, Svelte 5, Vite 8, @sveltejs/vite-plugin-svelte 7, vitest 4, @testing-library/svelte 5 + jest-dom 6, jsdom 29, Tailwind 4. Python CLI unchanged.

**Spec:** `docs/superpowers/specs/2026-07-23-electron-workbench-design.md`

## Global Constraints

- No em-dashes in any repo file (the repo removed them all in commit 9117736). Use "-".
- The renderer NEVER touches the filesystem and NEVER spawns a process, and never imports `electron`, `fs`, or `child_process`. All fs/child-process work is in the electron main process, reached over IPC. The renderer calls `window.api.*` only.
- Renderer is **SvelteKit + adapter-static**, fully prerendered: `ssr = false`, `prerender = true` in `src/routes/+layout.ts`. Do NOT switch to hash routing or `paths.relative` - the verified approach keeps the default pathname router and default root-absolute asset paths, and Electron intercepts the `file:` protocol instead (see the appendix and Task 1).
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. `window.api` (exposed by `app/electron/preload.ts`) is the only bridge. Its type is the `ElectronApi` interface in `app/renderer/src/app.d.ts`, extended additively each task.
- Electron main/preload are built by **tsup to CJS** (`dist-electron/`). Do not use ESM/`import.meta` in `electron/*.ts`; use `__dirname` (tsup emits CJS).
- Every main-to-renderer IPC reply is `{ok: true, data}` or `{ok: false, error}`. The renderer has no other path.
- `--fast` is the default and only scan mode in this increment. A bare (non-fast) scan would frame-count the whole disc.
- The `.mkvedproj` the app writes must match the CLI's `--project` schema exactly (version 1): `{version:1, bdmv, title, mode, preserve_chapters, qpfile, editions:[{name,clips}], tracks:[]}`. In this increment `tracks` is always `[]` (track panel is a later increment); the CLI treats an empty selection as "keep all streams".
- App lives entirely under `app/`. Do not modify `src/gen-editions.py` or `samples/` in this increment.
- Node v22.21, npm 10.9 (verified). Electron launches under WSLg with `--no-sandbox` (the SUID sandbox binary is not root-owned on this install).
- **Two test runners, by workspace:** renderer logic + components run under the renderer's vitest (jsdom): `cd app/renderer && npx vitest run [file]`. Electron-side modules (scan, cli, project-io) run under a root vitest (node env): `cd app && npx vitest run [file]`. `cd app && npm test` runs both.

## Verified facts the plan builds on (do not re-derive)

- `gen-editions.py <BDMV> --scan-json --fast --cache <DIR>` writes ONE JSON document to **stdout** and `{"type":"progress","clip":"..","done":N,"total":M}` lines to **stderr**, exit 0 on success. Validated on a real disc: 165 clips in 14 s.
- Scan JSON top-level keys: `bdmv`, `clips` (object keyed by clip id), `playlists` (array), `slots` (array), `warnings` (array). Exact per-key shape is in Task 3.
- The scan only includes clips referenced by some playlist. There are no unreferenced/orphan clips in the model, so this increment has no "orphan toggle". A referenced-but-corrupt clip appears with an empty `tracks` array - render it as "unreadable".
- A multi-angle playlist is ALREADY expanded in the scan: its `editions` array has one entry per angle. The app consumes that expansion; it does not re-expand.
- Real disc scale: ~170 playlists, ~180 clips, most playlists decoys (e.g. 101 PlayItems cycling 2 clips). The feature is one long clip reached by a 1-item playlist.
- **The `file://` fix is load-bearing and verified**: `loadFile` breaks (SvelteKit pathname router 404s on the absolute path; adapter-static's asset paths are root-absolute and 404 under `file://`). The fix is `protocol.handle('file', ...)` resolving against the build dir plus `loadURL('file:///')`. Task 1's appendix has the exact, launch-verified code.

## File Structure

```
app/
  package.json              workspaces root: electron, tsup, typescript, cross-env, vitest
  tsconfig.json             electron/*.ts typecheck
  tsup.config.ts            builds electron/{main,preload}.ts -> dist-electron/ (CJS)
  vitest.config.ts          NODE-env vitest for electron/**/*.test.ts
  electron/
    main.ts                 window, file: protocol interception, IPC registration
    preload.ts              contextBridge -> window.api
    cli.ts                  resolve gen-editions.py path + repo root (PURE, tested)
    scan.ts                 spawn gen-editions.py --scan-json, parse (PURE, tested)
    project-io.ts           read/write .mkvedproj (atomic) (PURE, tested)
    cli.test.ts, scan.test.ts, project-io.test.ts
  renderer/                 SvelteKit workspace (adapter-static)
    package.json, svelte.config.js, vite.config.ts, tsconfig.json, vitest-setup.ts
    src/
      app.html, app.css
      app.d.ts              window.api (ElectronApi) type - extended each task
      routes/
        +layout.ts          ssr=false; prerender=true
        +layout.svelte
        +page.svelte        the workbench shell (scan orchestration, panes)
      lib/
        model.ts            DiscModel types + derivation (PURE, tested)
        project.ts          Project type + ops + mkvedproj serialize (PURE, tested)
        model.test.ts, project.test.ts
        components/
          ClipLibrary.svelte + ClipLibrary.test.ts
          PlaylistPicker.svelte + PlaylistPicker.test.ts
          EditionTracks.svelte + EditionTracks.test.ts
```

Two files carry the load-bearing logic and get thorough unit tests: `renderer/src/lib/model.ts` (taming disc scale) and `renderer/src/lib/project.ts` (the authoring model + the `.mkvedproj` contract). Components are thin, verified by render/event tests plus one manual launch. Electron-side `scan.ts`/`cli.ts`/`project-io.ts` are pure Node modules tested under the root vitest.

---

### Task 1: Scaffold - runnable Electron + SvelteKit app with file:// IPC

**Files:**
- Create: every file listed in the appendix "Verified scaffold (Task 1 files)" (workspaces root, `electron/main.ts` + `preload.ts`, `tsup.config.ts`, the SvelteKit `renderer/` workspace, the Hello component + its test).
- Modify: `.gitignore` (add `app/node_modules/`, `app/dist-electron/`, `app/renderer/build/`, `app/renderer/.svelte-kit/`)

**Interfaces:**
- Produces: a launchable app (`cd app && npm run build && npm start` opens a window that loads the SvelteKit build over intercepted `file:///`); `window.api.ping(): Promise<string>` proving the renderer->preload->main->renderer IPC path; the `ElectronApi` interface in `app/renderer/src/app.d.ts` that every later task extends; a passing example vitest (`Hello.test.ts`) proving the Svelte-5 + `svelteTesting()` test setup works.

> NOTE TO IMPLEMENTER: The exact scaffold files and pinned dependency versions
> are in the appendix at the end of this plan. They were built, type-checked, and
> launch-verified on this machine (production `file://` load + IPC round-trip).
> Use them exactly. The `file:` protocol interception in `main.ts` is required -
> do not simplify it to `loadFile`.

- [ ] **Step 1: Create the scaffold files** from the appendix verbatim.

- [ ] **Step 2: Install and ensure the electron binary**

```bash
cd app && npm install
# electron's postinstall can silently no-op; ensure the binary:
test -f node_modules/electron/path.txt || node node_modules/electron/install.js
```
Expected: install completes; `node_modules/electron/path.txt` exists.

- [ ] **Step 3: Add build artifacts to .gitignore**

Append to `/home/upb/src/mkv-editions/.gitignore`:
```
app/node_modules/
app/dist-electron/
app/renderer/build/
app/renderer/.svelte-kit/
```

- [ ] **Step 4: Build and typecheck**

Run: `cd app && npm run build && npm run check --workspace renderer`
Expected: `renderer/build/` produced (index.html + `_app/`), `dist-electron/main.js` + `preload.js` produced, `svelte-check` reports 0 errors 0 warnings.

- [ ] **Step 5: Verify the example test runs** (proves the Svelte 5 + svelteTesting setup)

Run: `cd app/renderer && npx vitest run`
Expected: `Hello.test.ts` passes (1 test).

- [ ] **Step 6: Verify it launches** (production `file://` path)

Run: `cd app && timeout 25 npm start` (scripts already pass `--no-sandbox`).
Expected: logs `[main] loading file:/// (intercepted ...)` then `[main] did-finish-load` then `[main] ready-to-show`, with no resource errors, and the window shows the ping page. Clicking "Ping main process" shows `pong from main @ ...`. If the window cannot render in this session, confirm those logs and no crash. Record what you observed.

- [ ] **Step 7: Commit**

```bash
git add app/ .gitignore
git commit -m "Electron+SvelteKit scaffold: static renderer over intercepted file://, IPC ping"
```

---

### Task 2: Scan IPC - spawn gen-editions.py --scan-json, parse result and progress

**Files:**
- Create: `app/electron/cli.ts`, `app/electron/scan.ts`, `app/vitest.config.ts`, `app/electron/scan.test.ts`, `app/electron/cli.test.ts`
- Modify: `app/package.json` (add root vitest devDep + `test:electron`/`test` scripts), `app/electron/main.ts` (register `scan` IPC), `app/electron/preload.ts` + `app/renderer/src/app.d.ts` (expose `scanDisc` + `onScanProgress`)

**Interfaces:**
- Consumes: `window.api` bridge from Task 1.
- Produces:
  - `app/electron/cli.ts`: `resolveCli(): { python: string; script: string; repoRoot: string }` - locates `src/gen-editions.py` by walking up from `__dirname` until a directory contains it; `python = process.env.MKVED_PYTHON || 'python3'`.
  - `app/electron/scan.ts`: `scanDisc(bdmv: string, cacheDir: string, onProgress: (p: ScanProgress) => void): Promise<ScanResult>` where `ScanProgress = { clip: string; done: number; total: number }` and `ScanResult = { ok: true; data: Record<string, any> } | { ok: false; error: string }`.
  - IPC channel `"scan"` (invoke) and `"scan:progress"` (main->renderer send).
  - `window.api.scanDisc(bdmv: string): Promise<ScanResult>` and `window.api.onScanProgress(cb: (p: ScanProgress) => void): () => void` (returns an unsubscribe fn).

- [ ] **Step 1: Add the root (node-env) vitest** for electron-side tests.

Create `app/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['electron/**/*.test.ts'] }
})
```

In `app/package.json`, add `vitest` to root devDependencies and set scripts:
```json
"test:electron": "vitest run",
"test:renderer": "npm run test --workspace renderer",
"test": "npm run test:electron && npm run test:renderer"
```
Then `cd app && npm install` (installs the root vitest).

- [ ] **Step 2: Write the failing test** (`app/electron/scan.test.ts`)

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanDisc } from './scan'
import { resolveCli } from './cli'

let bdmv: string
let cache: string

beforeAll(() => {
  const { repoRoot, python } = resolveCli()
  const out = mkdtempSync(join(tmpdir(), 'mkved-sample-'))
  execFileSync(python, [join(repoRoot, 'samples/make-sample.py'), out], { stdio: 'ignore' })
  bdmv = join(out, 'BDMV')
  cache = mkdtempSync(join(tmpdir(), 'mkved-cache-'))
})

describe('scanDisc', () => {
  it('parses the disc model and reports progress', async () => {
    const seen: number[] = []
    const res = await scanDisc(bdmv, cache, (p) => seen.push(p.done))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const m = res.data
    const files = m.playlists.map((p: any) => p.file).sort()
    expect(files).toContain('00003.mpls')
    expect(m.playlists.find((p: any) => p.file === '00003.mpls').angles).toBe(2)
    expect(Object.keys(m.clips).length).toBeGreaterThan(0)
    expect(seen.length).toBe(Object.keys(m.clips).length)
  }, 60_000)

  it('returns ok:false on a bad path', async () => {
    const res = await scanDisc('/no/such/bdmv', cache, () => {})
    expect(res.ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd app && npx vitest run electron/scan.test.ts`
Expected: FAIL - `scanDisc` / `resolveCli` not found.

- [ ] **Step 4: Implement `app/electron/cli.ts`**

```ts
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
```

- [ ] **Step 5: Write `app/electron/cli.test.ts`**

```ts
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
```

- [ ] **Step 6: Implement `app/electron/scan.ts`**

```ts
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
  const { python, script } = resolveCli()
  return new Promise((resolve) => {
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
```

- [ ] **Step 7: Run the electron tests to verify they pass**

Run: `cd app && npx vitest run`
Expected: PASS (scan + cli; sample generation + scan runs in a few seconds).

- [ ] **Step 8: Wire the IPC handler and preload bridge**

In `app/electron/main.ts`, register (using userData for the cache):
```ts
import { ipcMain, app } from 'electron'
import { join } from 'node:path'
import { scanDisc } from './scan'
// inside app.whenReady(), after the ping handler:
ipcMain.handle('scan', async (event, bdmv: string) => {
  const cacheDir = join(app.getPath('userData'), 'probe-cache')
  return scanDisc(bdmv, cacheDir, (p) => event.sender.send('scan:progress', p))
})
```

In `app/electron/preload.ts`, extend `api`:
```ts
const api = {
  ping: () => ipcRenderer.invoke('ping'),
  scanDisc: (bdmv: string) => ipcRenderer.invoke('scan', bdmv),
  onScanProgress: (cb: (p: { clip: string; done: number; total: number }) => void) => {
    const h = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on('scan:progress', h)
    return () => ipcRenderer.removeListener('scan:progress', h)
  },
}
```

In `app/renderer/src/app.d.ts`, extend `ElectronApi` with `scanDisc` and `onScanProgress` (types matching the above), plus the `ScanResult`/`ScanProgress` shapes.

- [ ] **Step 9: Build to confirm both sides compile**

Run: `cd app && npm run build && npm run check --workspace renderer`
Expected: build clean, svelte-check 0/0.

- [ ] **Step 10: Commit**

```bash
git add app/electron app/vitest.config.ts app/package.json app/renderer/src/app.d.ts
git commit -m "Scan IPC: spawn gen-editions.py --scan-json --fast, parse model + progress"
```

---

### Task 3: Disc model types and scale-taming derivation (pure renderer logic)

**Files:**
- Create: `app/renderer/src/lib/model.ts`, `app/renderer/src/lib/model.test.ts`

**Interfaces:**
- Produces (all in `model.ts`):
  - Types: `Stream { pid: number|null; kind: 'video'|'audio'|'subtitle'|'other'; codec: string; lang: string|null }`; `ClipTrack { tid: number; type: string; pid: number|null }`; `Clip { path: string; frames: number|null; fps: [number, number]; dur_ns: number; codec: string; exact: boolean; marks_ns: number[]; streams: Stream[]; tracks: ClipTrack[] }`; `PlaylistEdition { name: string; clips: string[] }`; `Playlist { file: string; angles: number; editions: PlaylistEdition[] }`; `Slot { id: string; kind: string; lang: string; codec: string; ordinal: number; present_in: string[]; missing_from: string[] }`; `Warning { kind: string; clips: string[]; message: string }`; `DiscModel { bdmv: string; clips: Record<string, Clip>; playlists: Playlist[]; slots: Slot[]; warnings: Warning[] }`.
  - `libraryClips(m: DiscModel): LibraryClip[]` where `LibraryClip = { id: string; durNs: number; codec: string; readable: boolean; audioCount: number; subCount: number }`, sorted by `durNs` descending, id ascending as tiebreak. `readable = clip.tracks.length > 0`.
  - `playlistRows(m: DiscModel): PlaylistRow[]` where `PlaylistRow = { file: string; angles: number; itemCount: number; uniqueCount: number; durNs: number; isDecoy: boolean }`, sorted by `durNs` descending. `itemCount = editions[0].clips.length`; `uniqueCount = new Set(editions[0].clips).size`; `durNs = sum of clips[c].dur_ns over editions[0].clips` (repeats counted); `isDecoy = itemCount >= 10 && itemCount / uniqueCount >= 5`.
  - `longestRealPlaylist(m: DiscModel): string | null` - the `file` of the non-decoy playlist row with the greatest `durNs`, or null.
  - `fmtDuration(ns: number): string` - `H:MM:SS`.

- [ ] **Step 1: Write the failing test** (`app/renderer/src/lib/model.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { libraryClips, playlistRows, longestRealPlaylist, fmtDuration, type DiscModel } from './model'

const NS = 1_000_000_000
function clip(dur: number, tracks = 1, aud = 1, sub = 0) {
  return {
    path: '', frames: null, fps: [24, 1] as [number, number], dur_ns: dur * NS,
    codec: 'h264', exact: false, marks_ns: [],
    streams: [
      { pid: 1, kind: 'video' as const, codec: 'h264', lang: null },
      ...Array.from({ length: aud }, (_, i) => ({ pid: 10 + i, kind: 'audio' as const, codec: 'ac3', lang: 'eng' })),
      ...Array.from({ length: sub }, (_, i) => ({ pid: 20 + i, kind: 'subtitle' as const, codec: 'pgs', lang: 'eng' })),
    ],
    tracks: Array.from({ length: tracks }, (_, i) => ({ tid: i, type: 'video', pid: i })),
  }
}
const model: DiscModel = {
  bdmv: '/x/BDMV',
  clips: {
    '00368': clip(9600, 1, 2, 2), '00364': clip(108, 1, 2, 2),
    '00099': clip(23, 1, 0, 0), '00098': clip(30, 1, 0, 0), '00666': clip(40, 0),
  },
  playlists: [
    { file: '00342.mpls', angles: 1, editions: [{ name: '00342', clips: ['00368'] }] },
    { file: '00095.mpls', angles: 1, editions: [{ name: '00095', clips: Array.from({ length: 101 }, (_, i) => (i % 2 ? '00098' : '00099')) }] },
    { file: '00666.mpls', angles: 1, editions: [{ name: '00666', clips: ['00666'] }] },
  ],
  slots: [], warnings: [],
}

describe('libraryClips', () => {
  it('is duration-sorted and flags unreadable clips', () => {
    const lib = libraryClips(model)
    expect(lib.map((c) => c.id)).toEqual(['00368', '00364', '00666', '00098', '00099'])
    expect(lib.find((c) => c.id === '00666')!.readable).toBe(false)
    expect(lib.find((c) => c.id === '00368')!.audioCount).toBe(2)
  })
})

describe('playlistRows', () => {
  it('computes counts, duration and decoy flag', () => {
    const rows = playlistRows(model)
    expect(rows.find((r) => r.file === '00342.mpls')!.isDecoy).toBe(false)
    const decoy = rows.find((r) => r.file === '00095.mpls')!
    expect(decoy.itemCount).toBe(101)
    expect(decoy.uniqueCount).toBe(2)
    expect(decoy.isDecoy).toBe(true)
    expect(rows[0].file).toBe('00342.mpls')
  })
})

describe('longestRealPlaylist', () => {
  it('picks the longest non-decoy playlist', () => {
    expect(longestRealPlaylist(model)).toBe('00342.mpls')
  })
})

describe('fmtDuration', () => {
  it('formats H:MM:SS', () => {
    expect(fmtDuration(9600 * NS)).toBe('2:40:00')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/model.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `app/renderer/src/lib/model.ts`** with the types listed under Interfaces and:

```ts
export interface LibraryClip { id: string; durNs: number; codec: string; readable: boolean; audioCount: number; subCount: number }
export interface PlaylistRow { file: string; angles: number; itemCount: number; uniqueCount: number; durNs: number; isDecoy: boolean }

export function libraryClips(m: DiscModel): LibraryClip[] {
  const rows = Object.entries(m.clips).map(([id, c]) => ({
    id, durNs: c.dur_ns, codec: c.codec, readable: c.tracks.length > 0,
    audioCount: c.streams.filter((s) => s.kind === 'audio').length,
    subCount: c.streams.filter((s) => s.kind === 'subtitle').length,
  }))
  rows.sort((a, b) => b.durNs - a.durNs || a.id.localeCompare(b.id))
  return rows
}

export function playlistRows(m: DiscModel): PlaylistRow[] {
  const rows = m.playlists.map((p) => {
    const clips = p.editions[0]?.clips ?? []
    const itemCount = clips.length
    const uniqueCount = new Set(clips).size
    const durNs = clips.reduce((s, c) => s + (m.clips[c]?.dur_ns ?? 0), 0)
    const isDecoy = itemCount >= 10 && uniqueCount > 0 && itemCount / uniqueCount >= 5
    return { file: p.file, angles: p.angles, itemCount, uniqueCount, durNs, isDecoy }
  })
  rows.sort((a, b) => b.durNs - a.durNs || a.file.localeCompare(b.file))
  return rows
}

export function longestRealPlaylist(m: DiscModel): string | null {
  const real = playlistRows(m).filter((r) => !r.isDecoy)
  return real.length ? real[0].file : null
}

export function fmtDuration(ns: number): string {
  const s = Math.round(ns / 1_000_000_000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/lib/model.ts app/renderer/src/lib/model.test.ts
git commit -m "Disc model types + scale-taming derivation (library, playlist rows, decoy flag)"
```

---

### Task 4: Project model, edition operations, and .mkvedproj serialization (pure renderer logic)

**Files:**
- Create: `app/renderer/src/lib/project.ts`, `app/renderer/src/lib/project.test.ts`

**Interfaces:**
- Consumes: `Playlist` from `model.ts`.
- Produces (all in `project.ts`):
  - Types: `ProjectEdition { name: string; clips: string[] }`; `Project { bdmv: string; title: string; mode: 'flat'|'linked'|'xin1'; preserve_chapters: boolean; qpfile: boolean; editions: ProjectEdition[] }`.
  - `newProject(bdmv: string): Project` - `{ bdmv, title: 'movie', mode: 'flat', preserve_chapters: false, qpfile: false, editions: [] }`.
  - Immutable ops returning a NEW Project (never mutate input): `addEdition(p, name)`, `renameEdition(p, i, name)`, `removeEdition(p, i)`, `appendClip(p, i, clipId)`, `removeClip(p, i, clipIdx)`, `moveClip(p, i, from, to)`, `importPlaylist(p, pl: Playlist)` (appends one edition per entry in `pl.editions`).
  - `sharedClipIds(p: Project): Set<string>` - clip ids in more than one edition.
  - `toMkvedproj(p: Project): object` - `{ version: 1, bdmv, title, mode, preserve_chapters, qpfile, editions, tracks: [] }`.
  - `fromMkvedproj(json: any): Project` - validates `json.version === 1` and required keys; throws otherwise; drops any `tracks`.

- [ ] **Step 1: Write the failing test** (`app/renderer/src/lib/project.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import {
  newProject, addEdition, appendClip, moveClip, removeClip, importPlaylist,
  sharedClipIds, toMkvedproj, fromMkvedproj,
} from './project'

describe('edition ops are immutable and correct', () => {
  it('adds an edition and appends/moves/removes clips without mutating input', () => {
    const p0 = newProject('/x/BDMV')
    const p1 = addEdition(p0, 'Theatrical')
    expect(p0.editions.length).toBe(0)
    const p2 = appendClip(appendClip(appendClip(p1, 0, 'A'), 0, 'B'), 0, 'C')
    expect(p2.editions[0].clips).toEqual(['A', 'B', 'C'])
    expect(moveClip(p2, 0, 2, 0).editions[0].clips).toEqual(['C', 'A', 'B'])
    expect(removeClip(p2, 0, 1).editions[0].clips).toEqual(['A', 'C'])
  })

  it('appends a repeated clip (documented supported case)', () => {
    const p = appendClip(appendClip(addEdition(newProject('/x'), 'E'), 0, 'A'), 0, 'A')
    expect(p.editions[0].clips).toEqual(['A', 'A'])
  })

  it('imports a multi-angle playlist as one edition per angle', () => {
    const pl = { file: '00003.mpls', angles: 2, editions: [
      { name: '00003', clips: ['1', '2'] }, { name: '00003 (Angle 2)', clips: ['1', '11'] },
    ] }
    const p = importPlaylist(newProject('/x'), pl)
    expect(p.editions.map((e) => e.name)).toEqual(['00003', '00003 (Angle 2)'])
  })
})

describe('sharedClipIds', () => {
  it('finds clips used by more than one edition', () => {
    let p = addEdition(addEdition(newProject('/x'), 'A'), 'B')
    p = appendClip(appendClip(p, 0, 'shared'), 0, 'onlyA')
    p = appendClip(p, 1, 'shared')
    expect([...sharedClipIds(p)]).toEqual(['shared'])
  })
})

describe('mkvedproj serialization round-trips', () => {
  it('emits version 1 with tracks:[] and reads it back', () => {
    let p = appendClip(addEdition(newProject('/x/BDMV'), 'Cut'), 0, 'A')
    p = { ...p, title: 'Film', mode: 'xin1', preserve_chapters: true }
    const j = toMkvedproj(p) as any
    expect(j.version).toBe(1)
    expect(j.tracks).toEqual([])
    expect(j.editions).toEqual([{ name: 'Cut', clips: ['A'] }])
    const back = fromMkvedproj(j)
    expect(back.title).toBe('Film')
    expect(back.mode).toBe('xin1')
    expect(back.editions).toEqual(p.editions)
  })

  it('rejects a wrong version', () => {
    expect(() => fromMkvedproj({ version: 2 })).toThrow(/version/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/project.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `app/renderer/src/lib/project.ts`**

```ts
import type { Playlist } from './model'

export interface ProjectEdition { name: string; clips: string[] }
export interface Project {
  bdmv: string; title: string; mode: 'flat' | 'linked' | 'xin1'
  preserve_chapters: boolean; qpfile: boolean; editions: ProjectEdition[]
}

export function newProject(bdmv: string): Project {
  return { bdmv, title: 'movie', mode: 'flat', preserve_chapters: false, qpfile: false, editions: [] }
}

function mapEdition(p: Project, i: number, fn: (e: ProjectEdition) => ProjectEdition): Project {
  return { ...p, editions: p.editions.map((e, k) => (k === i ? fn(e) : e)) }
}

export function addEdition(p: Project, name: string): Project {
  return { ...p, editions: [...p.editions, { name, clips: [] }] }
}
export function renameEdition(p: Project, i: number, name: string): Project {
  return mapEdition(p, i, (e) => ({ ...e, name }))
}
export function removeEdition(p: Project, i: number): Project {
  return { ...p, editions: p.editions.filter((_, k) => k !== i) }
}
export function appendClip(p: Project, i: number, clipId: string): Project {
  return mapEdition(p, i, (e) => ({ ...e, clips: [...e.clips, clipId] }))
}
export function removeClip(p: Project, i: number, clipIdx: number): Project {
  return mapEdition(p, i, (e) => ({ ...e, clips: e.clips.filter((_, k) => k !== clipIdx) }))
}
export function moveClip(p: Project, i: number, from: number, to: number): Project {
  return mapEdition(p, i, (e) => {
    const clips = [...e.clips]
    const [x] = clips.splice(from, 1)
    clips.splice(to, 0, x)
    return { ...e, clips }
  })
}
export function importPlaylist(p: Project, pl: Playlist): Project {
  const added = pl.editions.map((e) => ({ name: e.name, clips: [...e.clips] }))
  return { ...p, editions: [...p.editions, ...added] }
}

export function sharedClipIds(p: Project): Set<string> {
  const per = new Map<string, Set<number>>()
  p.editions.forEach((e, i) => {
    for (const c of e.clips) {
      if (!per.has(c)) per.set(c, new Set())
      per.get(c)!.add(i)
    }
  })
  return new Set([...per].filter(([, s]) => s.size > 1).map(([c]) => c))
}

export function toMkvedproj(p: Project): object {
  return {
    version: 1, bdmv: p.bdmv, title: p.title, mode: p.mode,
    preserve_chapters: p.preserve_chapters, qpfile: p.qpfile,
    editions: p.editions.map((e) => ({ name: e.name, clips: [...e.clips] })),
    tracks: [],
  }
}
export function fromMkvedproj(json: any): Project {
  if (json?.version !== 1) throw new Error('unsupported project version ' + json?.version)
  for (const k of ['bdmv', 'title', 'mode', 'editions']) {
    if (!(k in json)) throw new Error('missing ' + k)
  }
  return {
    bdmv: json.bdmv, title: json.title, mode: json.mode,
    preserve_chapters: !!json.preserve_chapters, qpfile: !!json.qpfile,
    editions: json.editions.map((e: any) => ({ name: e.name, clips: [...e.clips] })),
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/project.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/lib/project.ts app/renderer/src/lib/project.test.ts
git commit -m "Project model: immutable edition ops + .mkvedproj serialization"
```

---

### Task 5: ClipLibrary and PlaylistPicker components

**Files:**
- Create: `app/renderer/src/lib/components/ClipLibrary.svelte`, `app/renderer/src/lib/components/PlaylistPicker.svelte`, `app/renderer/src/lib/components/ClipLibrary.test.ts`, `app/renderer/src/lib/components/PlaylistPicker.test.ts`

**Interfaces:**
- Consumes: `libraryClips`, `playlistRows`, `LibraryClip`, `PlaylistRow`, `fmtDuration` from `$lib/model`.
- Produces:
  - `ClipLibrary.svelte` props (Svelte 5 runes: `let { clips }: { clips: LibraryClip[] } = $props()`): renders each clip as a draggable chip (`draggable`, `ondragstart` sets `dataTransfer` text to the clip id) showing id, duration, audio/sub counts. An unreadable clip renders greyed with an "unreadable" badge and `draggable={false}`.
  - `PlaylistPicker.svelte` props `{ rows: PlaylistRow[] }` plus a callback prop `onimport: (file: string) => void`: a search input filtering rows by `file` substring; each row shows file, duration, item/clip counts, an angle marker when `angles > 1`, a muted style + "likely decoy" tag when `isDecoy`, and an "import" button calling `onimport(file)`.
  (Svelte 5 note: use callback props `onimport`, not `createEventDispatcher`, for consistency with the ARM Svelte-5 codebase.)

- [ ] **Step 1: Write the failing tests** (`ClipLibrary.test.ts` and `PlaylistPicker.test.ts`)

`app/renderer/src/lib/components/ClipLibrary.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import ClipLibrary from './ClipLibrary.svelte'
import type { LibraryClip } from '$lib/model'

const clips: LibraryClip[] = [
  { id: '00368', durNs: 9600e9, codec: 'h264', readable: true, audioCount: 2, subCount: 2 },
  { id: '00666', durNs: 40e9, codec: 'h264', readable: false, audioCount: 0, subCount: 0 },
]

describe('ClipLibrary', () => {
  it('renders clips and marks the unreadable one', () => {
    render(ClipLibrary, { clips })
    expect(screen.getByText('00368')).toBeInTheDocument()
    expect(screen.getByText(/unreadable/i)).toBeInTheDocument()
  })
})
```

`app/renderer/src/lib/components/PlaylistPicker.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import PlaylistPicker from './PlaylistPicker.svelte'
import type { PlaylistRow } from '$lib/model'

const rows: PlaylistRow[] = [
  { file: '00342.mpls', angles: 1, itemCount: 1, uniqueCount: 1, durNs: 9700e9, isDecoy: false },
  { file: '00095.mpls', angles: 1, itemCount: 101, uniqueCount: 2, durNs: 4000e9, isDecoy: true },
]

describe('PlaylistPicker', () => {
  it('filters by search text', async () => {
    render(PlaylistPicker, { rows, onimport: () => {} })
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '342' } })
    expect(screen.queryByText('00342.mpls')).toBeInTheDocument()
    expect(screen.queryByText('00095.mpls')).toBeNull()
  })
  it('calls onimport with the file', async () => {
    const onimport = vi.fn()
    render(PlaylistPicker, { rows, onimport })
    await fireEvent.click(screen.getAllByText(/import/i)[0])
    expect(onimport).toHaveBeenCalledWith('00342.mpls')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app/renderer && npx vitest run src/lib/components`
Expected: FAIL - components not found.

- [ ] **Step 3: Implement `ClipLibrary.svelte`**

```svelte
<script lang="ts">
  import type { LibraryClip } from '$lib/model'
  import { fmtDuration } from '$lib/model'
  let { clips }: { clips: LibraryClip[] } = $props()
  function onDragStart(e: DragEvent, id: string) {
    e.dataTransfer?.setData('text/plain', id)
  }
</script>

<div class="flex flex-col gap-1 overflow-y-auto">
  {#each clips as c (c.id)}
    <div
      class="flex gap-2 rounded border border-slate-600 px-1.5 py-1 text-xs {c.readable ? 'cursor-grab' : 'cursor-not-allowed opacity-50'}"
      draggable={c.readable}
      ondragstart={(e) => onDragStart(e, c.id)}
    >
      <span class="font-medium">{c.id}</span>
      <span class="opacity-70">{fmtDuration(c.durNs)}</span>
      {#if c.readable}
        <span class="opacity-70">{c.audioCount}a {c.subCount}s</span>
      {:else}
        <span class="text-red-400">unreadable</span>
      {/if}
    </div>
  {/each}
</div>
```

- [ ] **Step 4: Implement `PlaylistPicker.svelte`**

```svelte
<script lang="ts">
  import type { PlaylistRow } from '$lib/model'
  import { fmtDuration } from '$lib/model'
  let { rows, onimport }: { rows: PlaylistRow[]; onimport: (file: string) => void } = $props()
  let q = $state('')
  let shown = $derived(rows.filter((r) => r.file.includes(q)))
</script>

<div class="flex flex-col gap-1 overflow-y-auto">
  <input class="mb-1.5 bg-slate-800 px-1" type="text" placeholder="filter playlists" bind:value={q} />
  {#each shown as r (r.file)}
    <div class="flex items-center gap-2 px-1 py-0.5 text-xs {r.isDecoy ? 'opacity-50' : ''}">
      <span>{r.file}</span>
      <span class="opacity-70">{fmtDuration(r.durNs)}</span>
      <span class="opacity-70">{r.itemCount} items / {r.uniqueCount} clips</span>
      {#if r.angles > 1}<span class="text-indigo-300">{r.angles} angles</span>{/if}
      {#if r.isDecoy}<span class="text-amber-400 text-[10px]">likely decoy</span>{/if}
      <button class="ml-auto rounded bg-slate-700 px-1.5" onclick={() => onimport(r.file)}>import</button>
    </div>
  {/each}
</div>
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd app/renderer && npx vitest run src/lib/components`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/renderer/src/lib/components/ClipLibrary.svelte app/renderer/src/lib/components/PlaylistPicker.svelte app/renderer/src/lib/components/ClipLibrary.test.ts app/renderer/src/lib/components/PlaylistPicker.test.ts
git commit -m "ClipLibrary + PlaylistPicker components (drag source, search, decoy styling)"
```

---

### Task 6: EditionTracks component (drag target, reorder, remove)

**Files:**
- Create: `app/renderer/src/lib/components/EditionTracks.svelte`, `app/renderer/src/lib/components/EditionTracks.test.ts`

**Interfaces:**
- Consumes: `Project`, `sharedClipIds` from `$lib/project`.
- Produces: `EditionTracks.svelte` props `{ project: Project; shared: Set<string>; onappend: (editionIdx: number, clipId: string) => void; onremove: (editionIdx: number, clipIdx: number) => void; onrename: (editionIdx: number, name: string) => void; onadd: () => void }`. Renders each edition as a row of clip chips; a chip in `shared` gets a distinct style. A drop on an edition row reads `dataTransfer.getData('text/plain')` and calls `onappend`. A chip delete button calls `onremove`. The name input calls `onrename`. A "+ new edition" button calls `onadd`. (moveClip/reorder within a row is wired but not unit-tested this increment; keep the handler.)

- [ ] **Step 1: Write the failing test** (`app/renderer/src/lib/components/EditionTracks.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import EditionTracks from './EditionTracks.svelte'
import { newProject, addEdition, appendClip, sharedClipIds } from '$lib/project'

describe('EditionTracks', () => {
  it('renders editions with their clips and calls onappend on drop', async () => {
    const p = appendClip(addEdition(newProject('/x'), 'Theatrical'), 0, '00368')
    const onappend = vi.fn()
    render(EditionTracks, { project: p, shared: sharedClipIds(p), onappend, onremove: () => {}, onrename: () => {}, onadd: () => {} })
    expect(screen.getByText('00368')).toBeInTheDocument()
    const row = screen.getByText('00368').closest('[data-edition]') as HTMLElement
    await fireEvent.drop(row, { dataTransfer: { getData: () => '00364' } })
    expect(onappend).toHaveBeenCalledWith(0, '00364')
  })

  it('calls onadd from the new-edition button', async () => {
    const onadd = vi.fn()
    render(EditionTracks, { project: newProject('/x'), shared: new Set(), onappend: () => {}, onremove: () => {}, onrename: () => {}, onadd })
    await fireEvent.click(screen.getByText(/new edition/i))
    expect(onadd).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/components/EditionTracks.test.ts`
Expected: FAIL - EditionTracks not found.

- [ ] **Step 3: Implement `EditionTracks.svelte`**

```svelte
<script lang="ts">
  import type { Project } from '$lib/project'
  let { project, shared, onappend, onremove, onrename, onadd }: {
    project: Project; shared: Set<string>
    onappend: (editionIdx: number, clipId: string) => void
    onremove: (editionIdx: number, clipIdx: number) => void
    onrename: (editionIdx: number, name: string) => void
    onadd: () => void
  } = $props()

  function onDrop(e: DragEvent, i: number) {
    e.preventDefault()
    const id = e.dataTransfer?.getData('text/plain')
    if (id) onappend(i, id)
  }
</script>

<div class="flex flex-col gap-2">
  {#each project.editions as ed, i (i)}
    <div
      data-edition
      class="rounded-md border border-dashed border-slate-600 p-1.5"
      ondrop={(e) => onDrop(e, i)}
      ondragover={(e) => e.preventDefault()}
    >
      <input class="mb-1 bg-transparent font-semibold" value={ed.name} onchange={(e) => onrename(i, (e.target as HTMLInputElement).value)} />
      <div class="flex min-h-6 flex-wrap gap-1">
        {#each ed.clips as c, k (k)}
          <span class="rounded border px-1 text-xs {shared.has(c) ? 'border-indigo-400 bg-indigo-500/20' : 'border-slate-600'}">
            {c}
            <button class="opacity-60" onclick={() => onremove(i, k)}>x</button>
          </span>
        {/each}
      </div>
    </div>
  {/each}
  <button class="self-start rounded bg-slate-700 px-2 py-1 text-sm" onclick={() => onadd()}>+ new edition</button>
</div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/components/EditionTracks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/lib/components/EditionTracks.svelte app/renderer/src/lib/components/EditionTracks.test.ts
git commit -m "EditionTracks component: drop target, remove, shared-clip coloring"
```

---

### Task 7: Workbench shell - pick a disc, scan, populate, suggest the feature

**Files:**
- Modify: `app/renderer/src/routes/+page.svelte` (replace the placeholder), `app/electron/main.ts` (add a `pickBdmv` dialog IPC), `app/electron/preload.ts` + `app/renderer/src/app.d.ts` (expose `pickBdmv`)

**Interfaces:**
- Consumes: `window.api.scanDisc`, `window.api.onScanProgress`, new `window.api.pickBdmv(): Promise<string | null>`; all of `$lib/model` and `$lib/project`.
- Produces: the working shell. `+page.svelte` holds `DiscModel | null`, a `Project | null` (Svelte 5 `$state`), and scan progress. It wires: pick a BDMV folder -> scan (showing progress) -> derive `libraryClips`/`playlistRows` -> render `ClipLibrary`, `PlaylistPicker`, `EditionTracks`, applying their callbacks through `$lib/project` ops. On scan completion it seeds one edition from `longestRealPlaylist` (suggested feature). New IPC `window.api.pickBdmv()` opens a directory chooser, returns the path or null.

- [ ] **Step 1: Add the `pickBdmv` IPC** in `app/electron/main.ts`:

```ts
import { dialog } from 'electron'
ipcMain.handle('pickBdmv', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
})
```

Expose in `app/electron/preload.ts`: `pickBdmv: () => ipcRenderer.invoke('pickBdmv')`, and add it to `ElectronApi` in `app/renderer/src/app.d.ts`.

- [ ] **Step 2: Replace `app/renderer/src/routes/+page.svelte`**

```svelte
<script lang="ts">
  import ClipLibrary from '$lib/components/ClipLibrary.svelte'
  import PlaylistPicker from '$lib/components/PlaylistPicker.svelte'
  import EditionTracks from '$lib/components/EditionTracks.svelte'
  import { libraryClips, playlistRows, longestRealPlaylist, type DiscModel } from '$lib/model'
  import {
    newProject, addEdition, appendClip, removeClip, renameEdition, importPlaylist,
    sharedClipIds, type Project,
  } from '$lib/project'

  let model = $state<DiscModel | null>(null)
  let project = $state<Project | null>(null)
  let progress = $state('')
  let scanning = $state(false)

  async function pickAndScan() {
    const bdmv = await window.api.pickBdmv()
    if (!bdmv) return
    scanning = true
    progress = 'scanning...'
    const off = window.api.onScanProgress((p) => { progress = `probing ${p.clip} (${p.done}/${p.total})` })
    const res = await window.api.scanDisc(bdmv)
    off()
    scanning = false
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
  }

  function apply(fn: (p: Project) => Project) { if (project) project = fn(project) }

  let lib = $derived(model ? libraryClips(model) : [])
  let rows = $derived(model ? playlistRows(model) : [])
  let shared = $derived(project ? sharedClipIds(project) : new Set<string>())
</script>

<header class="flex items-center gap-2.5 border-b border-slate-700 p-2">
  <button class="rounded bg-indigo-600 px-3 py-1" onclick={pickAndScan} disabled={scanning}>Open BDMV...</button>
  {#if project}
    <input class="bg-slate-800 px-1" bind:value={project.title} />
    <select class="bg-slate-800" bind:value={project.mode}>
      <option value="flat">flat</option><option value="linked">linked</option><option value="xin1">xin1</option>
    </select>
    <label><input type="checkbox" bind:checked={project.preserve_chapters} /> preserve chapters</label>
  {/if}
  <span class="ml-auto text-xs opacity-70">{progress}</span>
</header>

<main class="grid h-[calc(100vh-52px)] grid-cols-[220px_1fr_300px] gap-2.5 p-2.5">
  <section class="flex flex-col overflow-hidden"><h3 class="mb-1.5 text-sm">Clips</h3><ClipLibrary clips={lib} /></section>
  <section class="flex flex-col overflow-hidden">
    <h3 class="mb-1.5 text-sm">Editions</h3>
    {#if project}
      <EditionTracks
        {project} {shared}
        onappend={(i, id) => apply((p) => appendClip(p, i, id))}
        onremove={(i, k) => apply((p) => removeClip(p, i, k))}
        onrename={(i, name) => apply((p) => renameEdition(p, i, name))}
        onadd={() => apply((p) => addEdition(p, `Edition ${p.editions.length + 1}`))}
      />
    {/if}
  </section>
  <section class="flex flex-col overflow-hidden">
    <h3 class="mb-1.5 text-sm">Playlists</h3>
    <PlaylistPicker {rows} onimport={(file) => {
      const pl = model?.playlists.find((p) => p.file === file)
      if (pl) apply((p) => importPlaylist(p, pl))
    }} />
  </section>
</main>
```

- [ ] **Step 3: Verify build, typecheck, and existing tests**

Run: `cd app && npm run build && npm run check --workspace renderer && npx vitest run && cd renderer && npx vitest run`
Expected: build clean, svelte-check 0/0, all tests pass.

- [ ] **Step 4: Manual launch verification against the real disc**

With the disc mounted at `/mnt/br`, run `cd app && npm run dev:renderer` in one terminal and `npm run dev:electron` in another. Click "Open BDMV...", choose `/mnt/br/BDMV`, and confirm: progress updates during scan, the clip library fills duration-sorted, the playlist picker lists playlists with decoys de-emphasized, the suggested feature edition appears, and dragging a clip onto an edition adds it. Record what you observed.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/routes/+page.svelte app/electron/main.ts app/electron/preload.ts app/renderer/src/app.d.ts
git commit -m "Workbench shell: pick BDMV, scan with progress, populate library/editions, suggest feature"
```

---

### Task 8: Save and open .mkvedproj (closes the GUI->CLI loop)

**Files:**
- Create: `app/electron/project-io.ts`, `app/electron/project-io.test.ts`
- Modify: `app/electron/main.ts` (register `saveProject`/`openProject` IPC), `app/electron/preload.ts` + `app/renderer/src/app.d.ts`, `app/renderer/src/routes/+page.svelte` (Save/Open buttons)

**Interfaces:**
- Produces:
  - `app/electron/project-io.ts`: `writeProjectFile(path: string, json: unknown): Promise<void>` (atomic: temp in same dir, then `rename`); `readProjectFile(path: string): Promise<unknown>` (parse JSON, throw on invalid).
  - IPC: `window.api.saveProject(json: unknown, title: string): Promise<{ok:true,path:string}|{ok:false,error:string}>` (save dialog defaulting to `<title>.mkvedproj`); `window.api.openProject(): Promise<{ok:true,json:unknown}|{ok:false,error:string}|null>` (open dialog; null if cancelled).
  - `+page.svelte`: a "Save project..." button calling `toMkvedproj(project)` then `window.api.saveProject`, and an "Open project..." button calling `window.api.openProject` then `fromMkvedproj`.

- [ ] **Step 1: Write the failing test** (`app/electron/project-io.test.ts`)

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run electron/project-io.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `app/electron/project-io.ts`**

```ts
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
```

(`Date.now()` is fine here; the ban is only for the deterministic Python round-trip test.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run electron/project-io.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire IPC + preload + shell buttons**

In `app/electron/main.ts`:
```ts
import { writeProjectFile, readProjectFile } from './project-io'
ipcMain.handle('saveProject', async (_e, json: unknown, title: string) => {
  const r = await dialog.showSaveDialog({ defaultPath: `${title || 'movie'}.mkvedproj` })
  if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' }
  try { await writeProjectFile(r.filePath, json); return { ok: true, path: r.filePath } }
  catch (e) { return { ok: false, error: String(e) } }
})
ipcMain.handle('openProject', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'mkvedproj', extensions: ['mkvedproj', 'json'] }] })
  if (r.canceled || r.filePaths.length === 0) return null
  try { return { ok: true, json: await readProjectFile(r.filePaths[0]) } }
  catch (e) { return { ok: false, error: String(e) } }
})
```

In `app/electron/preload.ts` add:
```ts
saveProject: (json: unknown, title: string) => ipcRenderer.invoke('saveProject', json, title),
openProject: () => ipcRenderer.invoke('openProject'),
```
and their types in `ElectronApi` (`app/renderer/src/app.d.ts`).

In `+page.svelte`, import `toMkvedproj, fromMkvedproj` from `$lib/project` and add header buttons (shown when `project`):
```svelte
<button class="rounded bg-slate-700 px-2 py-1" onclick={async () => { if (project) await window.api.saveProject(toMkvedproj(project), project.title) }}>Save project...</button>
<button class="rounded bg-slate-700 px-2 py-1" onclick={async () => {
  const r = await window.api.openProject()
  if (r && r.ok) project = fromMkvedproj(r.json)
}}>Open project...</button>
```

- [ ] **Step 6: Verify build + all tests**

Run: `cd app && npm run build && npm run check --workspace renderer && npx vitest run && cd renderer && npx vitest run`
Expected: all pass, build clean.

- [ ] **Step 7: End-to-end loop check (manual)**

Author an edition in the app, Save to a `.mkvedproj`, then from a terminal run
`python3 src/gen-editions.py --project <that file> /tmp/gui-build --cache ./cache` and confirm it produces a `build.sh` (and `bash build.sh` yields an MKV). This proves the GUI writes a contract the CLI builds. Record the result.

- [ ] **Step 8: Commit**

```bash
git add app/electron/project-io.ts app/electron/project-io.test.ts app/electron/main.ts app/electron/preload.ts app/renderer/src/app.d.ts app/renderer/src/routes/+page.svelte
git commit -m "Save/open .mkvedproj: GUI authors a project the CLI builds headlessly"
```

---

## Appendix: Verified scaffold (Task 1 files)

Every file below was built, type-checked (`svelte-check` 0/0), and launch-verified
under WSLg: the production `file://` load rendered and the `window.api.ping()` IPC
round-trip was proven with a scripted click. Use these exact versions and files.
`+page.svelte` here is a placeholder that Task 7 replaces.

### Pinned versions (resolved and co-verified)

Root: electron 43.2.0, tsup 8.5.1, typescript 6.0.3, cross-env 7.0.3.
Renderer: svelte 5.56.7, @sveltejs/kit 2.70.1, @sveltejs/adapter-static 3.0.10,
@sveltejs/vite-plugin-svelte 7.2.0, vite 8.1.5, typescript 6.0.3,
svelte-check 4.7.3, vitest 4.1.10, @testing-library/svelte 5.4.2,
@testing-library/jest-dom 6.9.1, jsdom 29.1.1, tailwindcss 4.3.3,
@tailwindcss/vite 4.3.3. (TS 6 resolved with no peer conflicts.)

### `app/package.json`

```json
{
  "name": "mkv-editions-app",
  "private": true,
  "version": "0.0.1",
  "workspaces": ["renderer"],
  "main": "dist-electron/main.js",
  "scripts": {
    "build:electron": "tsup",
    "build:renderer": "npm run build --workspace renderer",
    "build": "npm run build:renderer && npm run build:electron",
    "start": "electron . --no-sandbox",
    "dev:renderer": "npm run dev --workspace renderer -- --port 5173",
    "dev:electron": "npm run build:electron && cross-env ELECTRON_RENDERER_DEV_URL=http://localhost:5173 electron . --no-sandbox",
    "test": "npm run test --workspace renderer"
  },
  "devDependencies": {
    "electron": "43.2.0",
    "tsup": "8.5.1",
    "typescript": "6.0.3",
    "cross-env": "7.0.3"
  }
}
```

(Task 2 adds root `vitest` + `test:electron`/`test:renderer` scripts.)

### `app/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node", "electron"],
    "noEmit": true
  },
  "include": ["electron/**/*.ts"]
}
```

### `app/tsup.config.ts`

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['electron/main.ts', 'electron/preload.ts'],
  format: ['cjs'],
  outDir: 'dist-electron',
  target: 'node18',
  platform: 'node',
  clean: true,
  sourcemap: true,
  external: ['electron']
})
```

### `app/electron/main.ts`

```ts
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// Built to CJS by tsup, so __dirname is available natively at runtime.
const dirname = __dirname

const DEV_URL = process.env.ELECTRON_RENDERER_DEV_URL
const BUILD_DIR = path.join(dirname, '..', 'renderer', 'build')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2'
}

/**
 * The file:// fix. SvelteKit's default pathname router matches location.pathname
 * against routes; under a plain loadFile(), pathname is the absolute OS path, so
 * route "/" never matches and the router throws "Not found". adapter-static also
 * emits root-absolute asset paths ("/_app/...") which 404 under file://.
 * Intercepting the 'file' scheme to resolve every request against BUILD_DIR, then
 * navigating to "file:///" (pathname "/"), fixes both at once - no local HTTP
 * server, no custom scheme, renderer stays a plain prerendered static build.
 */
function registerBuildProtocol() {
  protocol.handle('file', async (request) => {
    const url = new URL(request.url)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/' || pathname === '') pathname = '/index.html'
    const filePath = path.normalize(path.join(BUILD_DIR, pathname))
    if (!filePath.startsWith(BUILD_DIR)) return new Response('Forbidden', { status: 403 })
    try {
      const data = await fs.readFile(filePath)
      const type = MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream'
      return new Response(data, { headers: { 'content-type': type } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

ipcMain.handle('ping', () => `pong from main @ ${new Date().toISOString()}`)

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 720, show: false,
    webPreferences: {
      preload: path.join(dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  })
  win.webContents.on('console-message', (e) => console.log(`[renderer console] ${e.message}`))
  win.webContents.on('did-finish-load', () => console.log('[main] did-finish-load'))
  win.once('ready-to-show', () => { console.log('[main] ready-to-show'); win.show() })
  if (DEV_URL) { console.log(`[main] loading dev URL: ${DEV_URL}`); win.loadURL(DEV_URL) }
  else { console.log(`[main] loading file:/// (intercepted -> ${BUILD_DIR})`); win.loadURL('file:///') }
  return win
}

app.whenReady().then(() => {
  if (!DEV_URL) registerBuildProtocol()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

### `app/electron/preload.ts`

```ts
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping')
}

contextBridge.exposeInMainWorld('api', api)
```

### `app/renderer/package.json`

```json
{
  "name": "renderer",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "svelte": "5.56.7",
    "@sveltejs/kit": "2.70.1",
    "@sveltejs/adapter-static": "3.0.10",
    "@sveltejs/vite-plugin-svelte": "7.2.0",
    "vite": "8.1.5",
    "typescript": "6.0.3",
    "svelte-check": "4.7.3",
    "vitest": "4.1.10",
    "@testing-library/svelte": "5.4.2",
    "@testing-library/jest-dom": "6.9.1",
    "jsdom": "29.1.1",
    "tailwindcss": "4.3.3",
    "@tailwindcss/vite": "4.3.3"
  }
}
```

### `app/renderer/svelte.config.js`

```js
import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: 'build', assets: 'build', precompress: false, strict: true })
    // Do NOT set paths.relative or router.type:'hash'; the file: protocol
    // interception in electron/main.ts is what makes default root-absolute
    // asset paths + the pathname router work under file://.
  }
}

export default config
```

### `app/renderer/vite.config.ts`

```ts
import { sveltekit } from '@sveltejs/kit/vite'
import { svelteTesting } from '@testing-library/svelte/vite'
import tailwindcss from '@tailwindcss/vite'
// defineConfig from 'vitest/config' (not 'vite') so the `test` key typechecks.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), svelteTesting()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest-setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts}']
  }
})
```

### `app/renderer/tsconfig.json`

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

### `app/renderer/vitest-setup.ts`

```ts
/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom/vitest'
```

### `app/renderer/src/app.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

### `app/renderer/src/app.css`

```css
@import 'tailwindcss';
```

### `app/renderer/src/app.d.ts` (window.api type - LATER TASKS EXTEND `ElectronApi`)

```ts
declare global {
  namespace App {}

  interface ElectronApi {
    ping: () => Promise<string>
  }

  interface Window {
    api: ElectronApi
  }
}

export {}
```

### `app/renderer/src/vitest.d.ts`

```ts
/// <reference types="@testing-library/jest-dom" />
```

### `app/renderer/src/routes/+layout.ts`

```ts
export const ssr = false
export const prerender = true
```

### `app/renderer/src/routes/+layout.svelte`

```svelte
<script lang="ts">
  import '../app.css'
  let { children } = $props()
</script>

{@render children?.()}
```

### `app/renderer/src/routes/+page.svelte` (placeholder; Task 7 replaces it)

```svelte
<script lang="ts">
  let result = $state<string | null>(null)
  async function handlePing() { result = await window.api.ping() }
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 text-white">
  <h1 class="text-2xl font-bold">mkv-editions workbench</h1>
  <button class="rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500" onclick={handlePing}>Ping main process</button>
  {#if result}<p data-testid="result">Result: {result}</p>{/if}
</main>
```

### `app/renderer/static/favicon.png`

The build references a favicon but does not depend on its contents. Drop in any
real PNG, e.g. `cp /usr/share/pixmaps/*.png app/renderer/static/favicon.png` (any
one), or write a valid 1x1 PNG:
```bash
python3 -c "import base64,pathlib; pathlib.Path('app/renderer/static/favicon.png').write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'))"
```
The launch does not depend on it.

### `app/renderer/src/lib/Hello.svelte` and `Hello.test.ts` (example test, delete after Task 3)

```svelte
<script lang="ts">
  let { name }: { name: string } = $props()
</script>

<p>Hello {name}!</p>
```

```ts
import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import Hello from './Hello.svelte'

describe('Hello', () => {
  it('renders the given name', () => {
    render(Hello, { name: 'World' })
    expect(screen.getByText('Hello World!')).toBeInTheDocument()
  })
})
```

### Post-install / launch notes

- After `npm install`, ensure Electron's binary: `test -f node_modules/electron/path.txt || node node_modules/electron/install.js`.
- Launch flag is `--no-sandbox` (already in the `start`/`dev:electron` scripts).
- `svelteTesting()` in `vite.config.ts` is REQUIRED - without it Svelte 5 throws `lifecycle_function_unavailable` under vitest. Verified.
- A harmless `GpuControl.CreateCommandBuffer` stderr line may appear under WSLg.

## Self-review notes

- Spec coverage: scaffold + file:// IPC (T1), `--scan-json --fast` over IPC with progress (T2), disc-scale handling / duration-sorted library / decoy de-emphasis / unreadable clips / feature suggestion (T3, T5, T7), authoring model + repeated clips + angle import (T4, T6), `.mkvedproj` contract round-trip and GUI->CLI build loop (T4, T8). Deferred per scope: track panel, thumbnails, in-app build runner, full-scan upgrade + qpfile gating, Electron smoke test.
- Type consistency: `DiscModel`/`Clip`/`Playlist` in T3 consumed by T4/T5/T6/T7; `Project` in T4 consumed by T6/T7/T8; `ElectronApi` grown additively in T1/T2/T7/T8 in `app/renderer/src/app.d.ts`.
- Two test runners: electron-side (node) at `cd app && npx vitest run`; renderer (jsdom) at `cd app/renderer && npx vitest run`. Both green is the bar.
- Svelte 5 idioms match the ARM codebase: runes (`$props`, `$state`, `$derived`), callback props (not `createEventDispatcher`), Tailwind utility classes.
