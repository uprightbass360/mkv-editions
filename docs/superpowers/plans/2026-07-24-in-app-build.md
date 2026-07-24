# In-app Build/Export + edition delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click Build button that muxes the editioned MKV(s) from the current project via the existing CLI, plus surface the existing `removeEdition()` as a delete control.

**Architecture:** A new `app/electron/build.ts` orchestrates two spawns in the main process (`python3 gen-editions.py --project <temp> <outdir>` to generate `build.sh`, then `bash build.sh` to mux), with an overwrite-confirm gate and streamed percent progress. The renderer stays filesystem-free and only calls `window.api.buildProject`. Dependency injection (mirroring `createOpener`) keeps the orchestration unit-testable without real subprocesses.

**Tech Stack:** Electron main (TypeScript, tsup CJS, vitest node), SvelteKit adapter-static renderer (Svelte 5 runes, vitest jsdom, Tailwind 4 ARM tokens), Python stdlib CLI (unchanged).

## Global Constraints

- NO em-dashes anywhere (code, comments, commit messages). Use "-" or reword.
- The renderer never imports fs/electron/child_process; only main spawns and reads paths. All new subprocess work lives in `app/electron/`.
- The CLI (`src/gen-editions.py`), `build.sh` generation, and the `.mkvedproj` contract are UNCHANGED by this feature.
- `build.sh` remains the only thing that invokes mkvmerge; the app never constructs mkvmerge arguments itself. The only shell-string invocation is the intentional `bash build.sh`.
- Svelte 5 runes only (`$props`/`$state`/`$derived`), lowercase handlers, NO createEventDispatcher. Targeted single-rule `<!-- svelte-ignore <rule> -->` only where a specific new warning appears.
- The bar for every renderer task: `npm run check` (svelte-check) 0 errors AND 0 warnings, all tests passing. For every electron task: `npx vitest run electron` green and `npm run build` clean.
- The temp `.mkvedproj` written during a build is always removed (a `finally`) on every path.

---

### Task 1: Edition delete control

**Files:**
- Modify: `app/renderer/src/lib/components/EditionTracks.svelte`
- Modify: `app/renderer/src/lib/components/EditionTracks.test.ts`
- Modify: `app/renderer/src/routes/+page.svelte`

**Interfaces:**
- Consumes: existing `removeEdition(p: Project, i: number): Project` from `$lib/project`.
- Produces: `EditionTracks` props gain `ondelete?: (editionIdx: number) => void`; a delete `x` on each edition header calls `e.stopPropagation()` then `ondelete?.(i)`.

- [ ] **Step 1: Write the failing test** (append inside the `describe('EditionTracks', ...)` block in `EditionTracks.test.ts`)

```ts
  it('calls ondelete with the edition index from the header delete button', async () => {
    const p = addEdition(addEdition(newProject('/x'), 'Theatrical'), 'Extended')
    const ondelete = vi.fn()
    render(EditionTracks, {
      project: p, shared: new Set<string>(),
      onappend: () => {}, onremove: () => {}, onrename: () => {}, onadd: () => {}, ondelete,
    })
    const btns = screen.getAllByTitle('delete edition')
    await fireEvent.click(btns[1])
    expect(ondelete).toHaveBeenCalledWith(1)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/components/EditionTracks.test.ts`
Expected: FAIL - `getAllByTitle('delete edition')` finds nothing (Unable to find an element with the title).

- [ ] **Step 3: Add the prop and the delete button** in `EditionTracks.svelte`

Add `ondelete` to the props destructuring and type block:

```svelte
  let { project, shared, clipInfo = {}, onappend, onremove, onrename, onadd, onselect, ondelete }: {
    project: Project; shared: Set<string>
    clipInfo?: Record<string, LibraryClip>
    onappend: (editionIdx: number, clipId: string) => void
    onremove: (editionIdx: number, clipIdx: number) => void
    onrename: (editionIdx: number, name: string) => void
    onadd: () => void
    onselect?: (clipId: string) => void
    ondelete?: (editionIdx: number) => void
  } = $props()
```

Replace the standalone name `<input>` line (currently `<input class="mb-1 w-full bg-transparent font-semibold" ... />`) with a header row wrapping the input plus a delete button:

```svelte
      <div class="mb-1 flex items-center gap-1">
        <input class="w-full bg-transparent font-semibold" value={ed.name} onchange={(e) => onrename(i, (e.target as HTMLInputElement).value)} />
        <button class="leading-none opacity-50 hover:opacity-100" title="delete edition" onclick={(e) => { e.stopPropagation(); ondelete?.(i) }}>x</button>
      </div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/components/EditionTracks.test.ts`
Expected: PASS (the new test plus the three existing EditionTracks tests).

- [ ] **Step 5: Wire it in `+page.svelte`**

Add `removeEdition` to the existing `$lib/project` import (the import that already brings in `addEdition`, `appendClip`, etc.):

```ts
  import {
    newProject, addEdition, appendClip, removeClip, renameEdition, removeEdition, importPlaylist,
    sharedClipIds, toMkvedproj, fromMkvedproj, type Project,
  } from '$lib/project'
```

In the `<EditionTracks ... />` element, add the `ondelete` handler next to the existing `onadd`:

```svelte
          ondelete={(i) => apply((p) => removeEdition(p, i))}
```

- [ ] **Step 6: Typecheck + full renderer tests**

Run: `cd app/renderer && npx vitest run && npm run check`
Expected: all tests pass; svelte-check 0 errors 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add app/renderer/src/lib/components/EditionTracks.svelte app/renderer/src/lib/components/EditionTracks.test.ts app/renderer/src/routes/+page.svelte
git commit -m "Editions: delete control wired to removeEdition"
```

---

### Task 2: build.sh output parser

**Files:**
- Create: `app/electron/build.ts`
- Create: `app/electron/build.test.ts`

**Interfaces:**
- Produces: `expectedOutputs(buildSh: string): string[]` - the `-o` target filenames (in order) a generated `build.sh` will write; and `unshellFirst(s: string): string` - decode the first shell token as Python `shlex.quote` produces it (a bare token, or a single-quoted string whose inner single quotes are encoded as the 5-char sequence `'"'"'`).

- [ ] **Step 1: Write the failing test** (`app/electron/build.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { expectedOutputs, unshellFirst } from './build'

describe('unshellFirst', () => {
  it('reads a bare token up to the next space', () => {
    expect(unshellFirst('seg0.mkv --no-chapters foo')).toBe('seg0.mkv')
  })
  it('reads a single-quoted token with spaces and braces', () => {
    expect(unshellFirst("'Movie {edition-Theatrical}.mkv' --chapters c.xml")).toBe('Movie {edition-Theatrical}.mkv')
  })
  it('decodes an inner single quote encoded by shlex.quote', () => {
    // shlex.quote("Rock 'n' Roll.mkv") -> 'Rock '"'"'n'"'"' Roll.mkv'
    const s = "'Rock '\"'\"'n'\"'\"' Roll.mkv' --x"
    expect(unshellFirst(s)).toBe("Rock 'n' Roll.mkv")
  })
})

describe('expectedOutputs', () => {
  it('collects the -o targets from a flat build.sh', () => {
    const sh = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      "mkvmerge -o 'Movie {edition-Theatrical}.mkv' --chapters 'Movie {edition-Theatrical}.chapters.xml' foo.m2ts",
      "mkvmerge -o 'Movie {edition-Extended}.mkv' bar.m2ts",
    ].join('\n')
    expect(expectedOutputs(sh)).toEqual([
      'Movie {edition-Theatrical}.mkv',
      'Movie {edition-Extended}.mkv',
    ])
  })
  it('ignores non-mkvmerge lines', () => {
    expect(expectedOutputs('echo hi\nmkvmerge -o out.mkv a.m2ts\n')).toEqual(['out.mkv'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run electron/build.test.ts`
Expected: FAIL - cannot find module `./build` / functions not exported.

- [ ] **Step 3: Implement the parser** in `app/electron/build.ts`

```ts
/** Decode the first shell token as Python shlex.quote produces it: a bare
 * token (read to the next space), or a single-quoted string whose inner single
 * quotes are encoded as the 5-char sequence '"'"' (close, "'", reopen). */
export function unshellFirst(s: string): string {
  if (s[0] !== "'") {
    const sp = s.indexOf(' ')
    return sp < 0 ? s : s.slice(0, sp)
  }
  let i = 1
  let res = ''
  while (i < s.length) {
    if (s[i] === "'") {
      if (s.slice(i, i + 5) === `'"'"'`) { res += "'"; i += 5; continue }
      break
    }
    res += s[i]
    i++
  }
  return res
}

/** The -o target filenames (in order) a generated build.sh will write. */
export function expectedOutputs(buildSh: string): string[] {
  const out: string[] = []
  const prefix = 'mkvmerge -o '
  for (const raw of buildSh.split('\n')) {
    const line = raw.trimStart()
    if (!line.startsWith(prefix)) continue
    out.push(unshellFirst(line.slice(prefix.length)))
  }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run electron/build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/electron/build.ts app/electron/build.test.ts
git commit -m "Build: parse -o output targets from generated build.sh"
```

---

### Task 3: Build orchestration (runBuild + createBuilder)

**Files:**
- Modify: `app/electron/build.ts`
- Modify: `app/electron/build.test.ts`

**Interfaces:**
- Consumes: `expectedOutputs` (Task 2); `resolveCli()` from `./cli`; `feedPercents` from `./disc-input`.
- Produces:
  - `BuildProgress = { percent: number }`.
  - `BuildResult = { ok: true; outputs: string[] } | { ok: false; error: string }`.
  - `runBuild(json: unknown, outdir: string, confirmOverwrite: (names: string[]) => Promise<boolean>, onProgress: (p: BuildProgress) => void, deps?: { spawnFn?: typeof import('node:child_process').spawn }): Promise<BuildResult>`.
  - `createBuilder(deps: { showOpenDialog: (opts: any) => Promise<{ canceled: boolean; filePaths: string[] }>; confirmOverwrite: (names: string[]) => Promise<boolean>; run?: typeof runBuild }): { buildProject(json: unknown, onProgress: (p: BuildProgress) => void): Promise<BuildResult | null> }` (null when the folder picker is cancelled).

- [ ] **Step 1: Write the failing tests** (append to `app/electron/build.test.ts`)

Add these imports at the top of the file:

```ts
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBuild, createBuilder } from './build'

function fakeChild(opts: { stdout?: string[]; stderr?: string[]; code?: number; errorMsg?: string }) {
  const child: any = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  queueMicrotask(() => {
    if (opts.errorMsg) { child.emit('error', new Error(opts.errorMsg)); return }
    for (const s of opts.stdout ?? []) child.stdout.emit('data', s)
    for (const s of opts.stderr ?? []) child.stderr.emit('data', s)
    child.emit('close', opts.code ?? 0)
  })
  return child
}

function outdirWith(buildSh: string, existingTargets: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'mkved-out-'))
  writeFileSync(join(dir, 'build.sh'), buildSh)
  for (const t of existingTargets) writeFileSync(join(dir, t), 'old')
  return dir
}

const SAMPLE_SH = "#!/usr/bin/env bash\nset -euo pipefail\n\nmkvmerge -o 'Movie.mkv' a.m2ts\n"
```

Then the tests:

```ts
describe('runBuild', () => {
  it('generates, finds no collision, runs build.sh, streams percent, returns outputs', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const calls: string[][] = []
    const spawnFn: any = (_cmd: string, args: string[]) => {
      calls.push(args)
      // first call = gen (success, build.sh already on disk); second = bash build.sh
      return calls.length === 1 ? fakeChild({ code: 0 }) : fakeChild({ stdout: ['Progress: 50%\n'], code: 0 })
    }
    const seen: number[] = []
    const confirm = vi.fn(async () => true)
    const res = await runBuild({ version: 1 }, dir, confirm, (p) => seen.push(p.percent), { spawnFn })
    expect(res).toEqual({ ok: true, outputs: [join(dir, 'Movie.mkv')] })
    expect(confirm).not.toHaveBeenCalled()
    expect(seen).toContain(50)
    expect(calls.length).toBe(2)
    // no temp mkvedproj left in tmpdir roots we created (the build dir has only build.sh + nothing extra)
    expect(existsSync(join(dir, 'build.sh'))).toBe(true)
  })

  it('asks to confirm when a target exists and aborts on Cancel without running build.sh', async () => {
    const dir = outdirWith(SAMPLE_SH, ['Movie.mkv'])
    let n = 0
    const spawnFn: any = () => { n++; return fakeChild({ code: 0 }) }
    const confirm = vi.fn(async () => false)
    const res = await runBuild({ version: 1 }, dir, confirm, () => {}, { spawnFn })
    expect(confirm).toHaveBeenCalledWith(['Movie.mkv'])
    expect(res).toEqual({ ok: false, error: 'cancelled' })
    expect(n).toBe(1) // only the gen spawn ran, not bash build.sh
  })

  it('returns an error when gen-editions exits nonzero', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const spawnFn: any = () => fakeChild({ stderr: ['bad project\n'], code: 1 })
    const res = await runBuild({ version: 1 }, dir, async () => true, () => {}, { spawnFn })
    expect(res).toEqual({ ok: false, error: 'bad project' })
  })

  it('surfaces a spawn error (e.g. python missing) as an error result', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const spawnFn: any = () => fakeChild({ errorMsg: 'spawn python3 ENOENT' })
    const res = await runBuild({ version: 1 }, dir, async () => true, () => {}, { spawnFn })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('ENOENT')
  })
})

describe('createBuilder', () => {
  it('returns null when the folder picker is cancelled', async () => {
    const run = vi.fn()
    const b = createBuilder({
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      confirmOverwrite: async () => true, run: run as any,
    })
    expect(await b.buildProject({}, () => {})).toBe(null)
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the build in the chosen dir and passes confirmOverwrite through', async () => {
    const run = vi.fn(async () => ({ ok: true, outputs: ['/out/Movie.mkv'] }))
    const confirmOverwrite = async () => true
    const b = createBuilder({
      showOpenDialog: async () => ({ canceled: false, filePaths: ['/out'] }),
      confirmOverwrite, run: run as any,
    })
    const res = await b.buildProject({ version: 1 }, () => {})
    expect(res).toEqual({ ok: true, outputs: ['/out/Movie.mkv'] })
    expect(run).toHaveBeenCalledWith({ version: 1 }, '/out', confirmOverwrite, expect.any(Function))
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run electron/build.test.ts`
Expected: FAIL - `runBuild`/`createBuilder` not exported.

- [ ] **Step 3: Implement the orchestration** (append to `app/electron/build.ts`; add the imports at the top of the file)

Top-of-file imports:

```ts
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveCli } from './cli'
import { feedPercents } from './disc-input'
```

Types and functions:

```ts
export interface BuildProgress { percent: number }
export type BuildResult =
  | { ok: true; outputs: string[] }
  | { ok: false; error: string }

/** Promisified single spawn: resolves { code, err } (code -1 on spawn error). */
function spawnOnce(
  spawnFn: typeof spawn,
  cmd: string,
  args: string[],
  cwd: string | undefined,
  onStdout?: (chunk: string) => void,
): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const child = spawnFn(cmd, args, cwd ? { cwd } : {})
    let err = ''
    child.stdout?.on('data', (d: any) => onStdout?.(String(d)))
    child.stderr?.on('data', (d: any) => { err += d })
    child.on('error', (e: any) => resolve({ code: -1, err: String(e?.message || e) }))
    child.on('close', (code: number | null) => resolve({ code: code ?? 0, err }))
  })
}

/** Generate build.sh from the project, gate on overwrite, then mux. */
export async function runBuild(
  json: unknown,
  outdir: string,
  confirmOverwrite: (names: string[]) => Promise<boolean>,
  onProgress: (p: BuildProgress) => void,
  deps: { spawnFn?: typeof spawn } = {},
): Promise<BuildResult> {
  const sp = deps.spawnFn ?? spawn
  let cli
  try { cli = resolveCli() } catch (e) { return { ok: false, error: String((e as Error).message || e) } }
  const tmpDir = mkdtempSync(join(tmpdir(), 'mkved-build-'))
  const tmpProject = join(tmpDir, 'project.mkvedproj')
  try {
    writeFileSync(tmpProject, JSON.stringify(json))
    // Step 1: generate build.sh (+ aux files) into outdir. No MKV yet.
    const gen = await spawnOnce(sp, cli.python, [cli.script, '--project', tmpProject, outdir], undefined)
    if (gen.code !== 0) return { ok: false, error: gen.err.trim() || `gen-editions exited ${gen.code}` }
    // Step 2: overwrite gate.
    let names: string[]
    try { names = expectedOutputs(readFileSync(join(outdir, 'build.sh'), 'utf8')) }
    catch (e) { return { ok: false, error: 'could not read generated build.sh: ' + String((e as Error).message || e) } }
    const existing = names.filter((n) => existsSync(join(outdir, n)))
    if (existing.length && !(await confirmOverwrite(existing))) {
      return { ok: false, error: 'cancelled' }
    }
    // Step 3: mux via the hardened build.sh.
    let buf = ''
    const build = await spawnOnce(sp, 'bash', ['build.sh'], outdir, (chunk) => {
      buf = feedPercents(buf, chunk, (pct) => onProgress({ percent: pct }))
    })
    if (build.code !== 0) return { ok: false, error: build.err.trim() || `build exited ${build.code}` }
    return { ok: true, outputs: names.map((n) => join(outdir, n)) }
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

/** Folder-pick + build, remembering the last output dir. */
export function createBuilder(deps: {
  showOpenDialog: (opts: any) => Promise<{ canceled: boolean; filePaths: string[] }>
  confirmOverwrite: (names: string[]) => Promise<boolean>
  run?: typeof runBuild
}) {
  let lastDir: string | undefined
  const run = deps.run ?? runBuild
  async function buildProject(
    json: unknown,
    onProgress: (p: BuildProgress) => void,
  ): Promise<BuildResult | null> {
    const r = await deps.showOpenDialog({ properties: ['openDirectory'], defaultPath: lastDir ?? '/' })
    if (r.canceled || r.filePaths.length === 0) return null
    const outdir = r.filePaths[0]
    lastDir = outdir
    return run(json, outdir, deps.confirmOverwrite, onProgress)
  }
  return { buildProject }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npx vitest run electron/build.test.ts`
Expected: PASS (all Task 2 + Task 3 tests).

- [ ] **Step 5: Run the whole electron suite**

Run: `cd app && npx vitest run electron`
Expected: all electron tests pass (no regression).

- [ ] **Step 6: Commit**

```bash
git add app/electron/build.ts app/electron/build.test.ts
git commit -m "Build: main-process orchestration (generate, overwrite-gate, mux) with progress"
```

---

### Task 4: Wire buildProject into main + preload + api types

**Files:**
- Modify: `app/electron/main.ts`
- Modify: `app/electron/preload.ts`
- Modify: `app/renderer/src/app.d.ts`

**Interfaces:**
- Consumes: `createBuilder` (Task 3).
- Produces: IPC channel `buildProject` (invoke) and `build:progress` (event); `window.api.buildProject(json)` and `window.api.onBuildProgress(cb)`; ambient `BuildResult`/`BuildProgress` types.

- [ ] **Step 1: Register the handler in `main.ts`**

Add the import near the other electron-module imports (e.g. beside `import { scanDisc } from './scan'`):

```ts
import { createBuilder } from './build'
```

After the existing `openInput` handler block, add:

```ts
const builder = createBuilder({
  showOpenDialog: (opts) => dialog.showOpenDialog(opts),
  confirmOverwrite: async (names) => {
    const r = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Overwrite', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Overwrite existing file(s)?',
      detail: names.join('\n'),
    })
    return r.response === 0
  },
})
ipcMain.handle('buildProject', async (event, json: unknown) =>
  builder.buildProject(json, (p) => event.sender.send('build:progress', p)))
```

- [ ] **Step 2: Expose it in `preload.ts`**

Add to the `api` object (after `openProject`):

```ts
  buildProject: (json: unknown) => ipcRenderer.invoke('buildProject', json),
  onBuildProgress: (cb: (p: { percent: number }) => void) => {
    const h = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on('build:progress', h)
    return () => ipcRenderer.removeListener('build:progress', h)
  },
```

- [ ] **Step 3: Add the ambient types in `app.d.ts`**

After the `ExtractProgress` interface, add:

```ts
  interface BuildProgress { percent: number }
  type BuildResult =
    | { ok: true; outputs: string[] }
    | { ok: false; error: string }
```

Inside `interface ElectronApi`, after `openProject`, add:

```ts
    buildProject: (json: unknown) => Promise<BuildResult | null>
    onBuildProgress: (cb: (p: BuildProgress) => void) => () => void
```

- [ ] **Step 4: Build + typecheck + electron tests**

Run: `cd app && npm run build && npx vitest run electron && npm run check --workspace renderer`
Expected: build clean; electron tests pass; svelte-check 0 errors 0 warnings. (No new unit test: this task is glue over the already-tested `createBuilder`. The build proves main/preload compile and the renderer app.d.ts stays consistent.)

- [ ] **Step 5: Commit**

```bash
git add app/electron/main.ts app/electron/preload.ts app/renderer/src/app.d.ts
git commit -m "Build: wire buildProject IPC + onBuildProgress + api types"
```

---

### Task 5: Build button in the shell

**Files:**
- Modify: `app/renderer/src/lib/project.ts`
- Modify: `app/renderer/src/lib/project.test.ts`
- Modify: `app/renderer/src/routes/+page.svelte`

**Interfaces:**
- Consumes: `window.api.buildProject`/`onBuildProgress` (Task 4); `toMkvedproj` from `$lib/project`.
- Produces: `hasBuildableEdition(p: Project): boolean` (true when at least one edition has >= 1 clip); a header **Build...** button gated on it; a `buildMovie()` handler that streams progress and reports the result.

- [ ] **Step 1: Write the failing test** (append to `app/renderer/src/lib/project.test.ts`)

```ts
import { hasBuildableEdition } from './project'

describe('hasBuildableEdition', () => {
  it('is false with no editions or only empty editions', () => {
    expect(hasBuildableEdition(newProject('/x'))).toBe(false)
    expect(hasBuildableEdition(addEdition(newProject('/x'), 'A'))).toBe(false)
  })
  it('is true once an edition has a clip', () => {
    const p = appendClip(addEdition(newProject('/x'), 'A'), 0, '00001')
    expect(hasBuildableEdition(p)).toBe(true)
  })
})
```

(If `newProject`/`addEdition`/`appendClip` are not already imported at the top of `project.test.ts`, add them to the existing `$lib/project` / `./project` import there.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/project.test.ts`
Expected: FAIL - `hasBuildableEdition` is not exported.

- [ ] **Step 3: Implement the helper** in `app/renderer/src/lib/project.ts`

Append:

```ts
export function hasBuildableEdition(p: Project): boolean {
  return p.editions.some((e) => e.clips.length > 0)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/project.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the button and handler in `+page.svelte`**

Add `hasBuildableEdition` to the existing `$lib/project` import. Add state + derived near the other `$state`/`$derived` declarations:

```ts
  let building = $state(false)
  let canBuild = $derived(!!project && hasBuildableEdition(project))

  async function buildMovie() {
    if (!project) return
    building = true
    progress = 'building...'
    let off: (() => void) | undefined
    try {
      off = window.api.onBuildProgress((p) => { progress = `building ${p.percent}%` })
      const res = await window.api.buildProject(toMkvedproj(project))
      if (!res) { progress = ''; return }
      if (!res.ok) { progress = res.error === 'cancelled' ? '' : 'build failed: ' + res.error; return }
      progress = `built ${res.outputs.length} file(s)`
    } finally { off?.(); building = false }
  }
```

In the `<header>`, immediately after the existing **Save project...** button (inside the `{#if project}` block), add:

```svelte
    <button class="rounded bg-primary px-3 py-1 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50" onclick={buildMovie} disabled={!canBuild || building}>Build...</button>
```

- [ ] **Step 6: Build + typecheck + full renderer tests**

Run: `cd app/renderer && npx vitest run && npm run check`
Expected: all tests pass; svelte-check 0 errors 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add app/renderer/src/lib/project.ts app/renderer/src/lib/project.test.ts app/renderer/src/routes/+page.svelte
git commit -m "Shell: Build button gated on a buildable edition, with progress + result"
```

---

## Real-disc validation (after Task 5)

With `/mnt/br` mounted, `../run-app.sh` (build + start), Open folder on `/mnt/br`, arrange a small edition, then:
- Click **Build...**, choose an empty output folder, confirm a playable `.mkv` is produced with the editions present.
- Re-build into the same folder: the overwrite confirm dialog lists the existing file(s); Cancel leaves them untouched, Overwrite replaces them.
- Delete an edition via its header `x`: the card disappears and a subsequent build omits it.
- The **Build...** button is disabled until at least one edition has a clip.

## Self-review notes

- Spec coverage: edition delete (T1); output-target parsing for the overwrite check and result (T2); main orchestration - temp project, generate, overwrite gate, mux, progress, temp cleanup (T3); IPC/preload/api-type wiring (T4); the gated Build button with progress + result (T5).
- Renderer stays fs-free: all spawning and path reading is in `app/electron/build.ts`; the renderer only calls `window.api.buildProject` and reads `outputs`.
- Progress is percent-only (`BuildProgress { percent }`): per-output-file attribution is not reliable from `bash build.sh` aggregate stdout, so the status line shows overall mkvmerge percent. The spec is aligned to this.
- Type consistency: `BuildResult`/`BuildProgress` are defined identically in `build.ts` (T3) and `app.d.ts` (T4); `createBuilder` (T3) is consumed in `main.ts` (T4); `hasBuildableEdition` (T5) gates the button; `buildProject`/`onBuildProgress` names match across preload (T4), api types (T4), and the renderer (T5).
- Overwrite semantics: a cancelled folder pick resolves `null` (silent no-op); a cancelled overwrite dialog resolves `{ ok: false, error: 'cancelled' }` (the renderer shows nothing for both).
- Linked mode note: `expectedOutputs` returns every `-o` target, so in linked mode the `seg*.mkv` intermediates are included in the overwrite check and the `outputs` count. This is honest (they are written beside the movie) and only surfaces on a re-build into a non-empty folder.
