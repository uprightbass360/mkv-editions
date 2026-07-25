# Build modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot Build flow with a renderer modal that confirms/edits settings, shows output-file collisions inline, and streams the live build log + progress.

**Architecture:** The main-process orchestration in `app/electron/build.ts` splits into `inspectBuild` (generate build.sh into a throwaway temp dir, compute outputs + collisions, no muxing) and a restructured `runBuild` (overwrite becomes a boolean, plus an `onLog` line stream on a new `build:log` channel). The renderer gets a `BuildModal.svelte` driven by three IPC calls (`buildPickFolder`/`buildInspect`/`buildRun`) and two event channels; the header Build button just opens it.

**Tech Stack:** Electron main (TypeScript, tsup->CJS, vitest node), SvelteKit adapter-static renderer (Svelte 5 runes, vitest jsdom, Tailwind 4 ARM tokens), Python CLI (unchanged).

## Global Constraints

- NO em-dashes anywhere (code, comments, commit messages). Use "-" or reword.
- The renderer never imports fs/electron/child_process; only main spawns/reads paths. All subprocess work stays in `app/electron/`.
- The CLI (`src/gen-editions.py`), `build.sh` generation, and the `.mkvedproj` contract are UNCHANGED.
- `build.sh` remains the only thing that invokes mkvmerge; the only shell-string spawn is the intentional `bash build.sh`. `python3 gen-editions.py` uses an argv array.
- Svelte 5 runes only (`$props`/`$state`/`$derived`), lowercase handlers, NO createEventDispatcher. Targeted single-rule `<!-- svelte-ignore <rule> -->` only where a specific new warning appears.
- Renderer bar: `npm run check` (svelte-check) 0 errors AND 0 warnings, all renderer tests passing. Electron bar: `npx vitest run electron` green and (from Task 1 onward) `npm run build` clean.
- Every temp file/dir created during inspect or run is removed in a `finally` on every path.
- The two event channels are exactly `build:progress` (`{ percent }`) and `build:log` (`{ line }`); the IPC invoke channels are exactly `buildPickFolder`, `buildInspect`, `buildRun`.

---

### Task 1: Split orchestration (inspectBuild + runBuild) and rewire IPC

**Files:**
- Modify: `app/electron/build.ts`
- Modify: `app/electron/build.test.ts`
- Modify: `app/electron/main.ts`
- Modify: `app/electron/preload.ts`
- Modify: `app/renderer/src/app.d.ts`

**Interfaces:**
- Consumes: existing `expectedOutputs`, `spawnOnce`, `resolveCli`, `feedPercents`.
- Produces:
  - `interface BuildLog { line: string }`.
  - `type InspectResult = { ok: true; outputs: string[]; existing: string[] } | { ok: false; error: string }`.
  - `inspectBuild(json: unknown, outdir: string, deps?: { spawnFn?: typeof spawn }): Promise<InspectResult>`.
  - `runBuild(json: unknown, outdir: string, overwrite: boolean, onProgress: (p: BuildProgress) => void, onLog: (line: string) => void, deps?: { spawnFn?: typeof spawn }): Promise<BuildResult>` (the `confirmOverwrite` callback is REMOVED; `createBuilder` and the `buildProject` IPC/api are REMOVED).
  - IPC: `buildPickFolder` -> `string | null`; `buildInspect(json, outdir)` -> `InspectResult`; `buildRun(json, outdir, overwrite)` -> `BuildResult`; events `build:progress`, `build:log`.
  - `window.api`: `buildPickFolder()`, `buildInspect(json, outdir)`, `buildRun(json, outdir, overwrite)`, `onBuildProgress(cb)`, `onBuildLog(cb)`.

- [ ] **Step 1: Rewrite the build.test.ts runBuild/createBuilder sections** (in `app/electron/build.test.ts`)

Keep the existing `describe('unshellFirst', ...)` and `describe('expectedOutputs', ...)` blocks and the imports/helpers at the top (`EventEmitter`, `fakeChild`, `outdirWith`, `SAMPLE_SH`). Add `mkdirSync` to the `node:fs` import in the test and add `inspectBuild` + `runBuild` to the `./build` import (remove `createBuilder`). DELETE the entire `describe('createBuilder', ...)` block. REPLACE the entire `describe('runBuild', ...)` block with:

```ts
describe('runBuild', () => {
  it('runs build.sh, streams percent + log lines, returns outputs (no collision)', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const calls: string[][] = []
    const spawnFn: any = (_cmd: string, args: string[]) => {
      calls.push(args)
      return calls.length === 1
        ? fakeChild({ code: 0 })
        : fakeChild({ stdout: ['mux start\n', 'Progress: 50%\n'], stderr: ['a warning\n'], code: 0 })
    }
    const pcts: number[] = []
    const logs: string[] = []
    const res = await runBuild({ version: 1 }, dir, false, (p) => pcts.push(p.percent), (l) => logs.push(l), { spawnFn })
    expect(res).toEqual({ ok: true, outputs: [join(dir, 'Movie.mkv')] })
    expect(pcts).toContain(50)
    expect(logs).toContain('mux start')
    expect(logs).toContain('a warning')
    expect(calls.length).toBe(2)
  })

  it('refuses when a target exists and overwrite is false, without running build.sh', async () => {
    const dir = outdirWith(SAMPLE_SH, ['Movie.mkv'])
    let n = 0
    const spawnFn: any = () => { n++; return fakeChild({ code: 0 }) }
    const res = await runBuild({ version: 1 }, dir, false, () => {}, () => {}, { spawnFn })
    expect(res).toEqual({ ok: false, error: 'overwrite-declined' })
    expect(n).toBe(1) // gen ran; bash build.sh did not
  })

  it('proceeds when a target exists and overwrite is true', async () => {
    const dir = outdirWith(SAMPLE_SH, ['Movie.mkv'])
    let n = 0
    const spawnFn: any = () => { n++; return fakeChild({ code: 0 }) }
    const res = await runBuild({ version: 1 }, dir, true, () => {}, () => {}, { spawnFn })
    expect(res).toEqual({ ok: true, outputs: [join(dir, 'Movie.mkv')] })
    expect(n).toBe(2)
  })

  it('returns an error when gen-editions exits nonzero', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const spawnFn: any = () => fakeChild({ stderr: ['bad project\n'], code: 1 })
    const res = await runBuild({ version: 1 }, dir, false, () => {}, () => {}, { spawnFn })
    expect(res).toEqual({ ok: false, error: 'bad project' })
  })

  it('surfaces a spawn error as an error result', async () => {
    const dir = outdirWith(SAMPLE_SH)
    const spawnFn: any = () => fakeChild({ errorMsg: 'spawn python3 ENOENT' })
    const res = await runBuild({ version: 1 }, dir, false, () => {}, () => {}, { spawnFn })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('ENOENT')
  })
})

describe('inspectBuild', () => {
  it('returns outputs and the subset that already exists in outdir', async () => {
    // outdir already has Movie.mkv; the temp gen dir will hold the sample build.sh
    const outdir = mkdtempSync(join(tmpdir(), 'mkved-realout-'))
    writeFileSync(join(outdir, 'Movie.mkv'), 'old')
    const spawnFn: any = (_cmd: string, args: string[]) => {
      // gen writes build.sh into args[3] (the gen dir); emulate that here
      const genDir = args[3]
      writeFileSync(join(genDir, 'build.sh'), SAMPLE_SH)
      return fakeChild({ code: 0 })
    }
    const res = await inspectBuild({ version: 1 }, outdir, { spawnFn })
    expect(res).toEqual({ ok: true, outputs: ['Movie.mkv'], existing: ['Movie.mkv'] })
  })

  it('returns an error when gen-editions exits nonzero', async () => {
    const outdir = mkdtempSync(join(tmpdir(), 'mkved-realout-'))
    const spawnFn: any = () => fakeChild({ stderr: ['bad project\n'], code: 1 })
    const res = await inspectBuild({ version: 1 }, outdir, { spawnFn })
    expect(res).toEqual({ ok: false, error: 'bad project' })
  })
})
```

Note the inspect test relies on the fake `spawnFn` writing `build.sh` into the gen dir passed as `args[3]`; this mirrors what the real `gen-editions.py --project <tmpProject> <genDir>` does, so `inspectBuild` must pass the gen dir as the 4th argv element (`[script, '--project', tmpProject, genDir]`).

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd app && npx vitest run electron/build.test.ts`
Expected: FAIL - `inspectBuild` not exported; `runBuild` signature mismatch.

- [ ] **Step 3: Rewrite `runBuild`, add `inspectBuild` and `emitLines`, remove `createBuilder`** in `app/electron/build.ts`

Add `mkdirSync` to the `node:fs` import:

```ts
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
```

Add the new types after the existing `BuildResult`:

```ts
export interface BuildLog { line: string }
export type InspectResult =
  | { ok: true; outputs: string[]; existing: string[] }
  | { ok: false; error: string }
```

Extend `spawnOnce` to also stream stderr chunks (used for the log). Change its signature and the stderr handler:

```ts
function spawnOnce(
  spawnFn: typeof spawn,
  cmd: string,
  args: string[],
  cwd: string | undefined,
  onStdout?: (chunk: string) => void,
  onStderr?: (chunk: string) => void,
): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const child = spawnFn(cmd, args, cwd ? { cwd } : {})
    let err = ''
    child.stdout?.on('data', (d: any) => onStdout?.(String(d)))
    child.stderr?.on('data', (d: any) => { err += d; onStderr?.(String(d)) })
    child.on('error', (e: any) => resolve({ code: -1, err: String(e?.message || e) }))
    child.on('close', (code: number | null) => resolve({ code: code ?? 0, err }))
  })
}

/** Emit each complete newline-terminated line from buf+chunk; return the remainder. */
function emitLines(buf: string, chunk: string, onLine: (line: string) => void): string {
  buf += chunk
  let nl: number
  while ((nl = buf.indexOf('\n')) >= 0) {
    onLine(buf.slice(0, nl))
    buf = buf.slice(nl + 1)
  }
  return buf
}
```

Add `inspectBuild` (generate into a throwaway temp dir, compute collisions against the real outdir):

```ts
/** Preflight: generate build.sh in a throwaway dir, return the output names and
 * which already exist in outdir. Never writes to outdir. */
export async function inspectBuild(
  json: unknown,
  outdir: string,
  deps: { spawnFn?: typeof spawn } = {},
): Promise<InspectResult> {
  const sp = deps.spawnFn ?? spawn
  let cli
  try { cli = resolveCli() } catch (e) { return { ok: false, error: String((e as Error).message || e) } }
  let tmpDir: string | undefined
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'mkved-inspect-'))
    const tmpProject = join(tmpDir, 'project.mkvedproj')
    const genDir = join(tmpDir, 'gen')
    mkdirSync(genDir)
    writeFileSync(tmpProject, JSON.stringify(json))
    const gen = await spawnOnce(sp, cli.python, [cli.script, '--project', tmpProject, genDir], undefined)
    if (gen.code !== 0) return { ok: false, error: gen.err.trim() || `gen-editions exited ${gen.code}` }
    let names: string[]
    try { names = expectedOutputs(readFileSync(join(genDir, 'build.sh'), 'utf8')) }
    catch (e) { return { ok: false, error: 'could not read generated build.sh: ' + String((e as Error).message || e) } }
    const existing = names.filter((n) => existsSync(join(outdir, n)))
    return { ok: true, outputs: names, existing }
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) }
  } finally {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ } }
  }
}
```

REPLACE the entire existing `runBuild` function with the restructured version (overwrite boolean + onLog):

```ts
/** Generate build.sh into outdir, gate on the overwrite flag, then mux, streaming
 * percent + log lines. */
export async function runBuild(
  json: unknown,
  outdir: string,
  overwrite: boolean,
  onProgress: (p: BuildProgress) => void,
  onLog: (line: string) => void,
  deps: { spawnFn?: typeof spawn } = {},
): Promise<BuildResult> {
  const sp = deps.spawnFn ?? spawn
  let cli
  try { cli = resolveCli() } catch (e) { return { ok: false, error: String((e as Error).message || e) } }
  let tmpDir: string | undefined
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'mkved-build-'))
    const tmpProject = join(tmpDir, 'project.mkvedproj')
    writeFileSync(tmpProject, JSON.stringify(json))
    const gen = await spawnOnce(sp, cli.python, [cli.script, '--project', tmpProject, outdir], undefined)
    if (gen.code !== 0) return { ok: false, error: gen.err.trim() || `gen-editions exited ${gen.code}` }
    let names: string[]
    try { names = expectedOutputs(readFileSync(join(outdir, 'build.sh'), 'utf8')) }
    catch (e) { return { ok: false, error: 'could not read generated build.sh: ' + String((e as Error).message || e) } }
    const existing = names.filter((n) => existsSync(join(outdir, n)))
    if (existing.length && !overwrite) return { ok: false, error: 'overwrite-declined' }
    let pbuf = ''
    let outLine = ''
    let errLine = ''
    const build = await spawnOnce(sp, 'bash', ['build.sh'], outdir,
      (chunk) => {
        pbuf = feedPercents(pbuf, chunk, (pct) => onProgress({ percent: pct }))
        outLine = emitLines(outLine, chunk, onLog)
      },
      (chunk) => { errLine = emitLines(errLine, chunk, onLog) },
    )
    if (outLine) onLog(outLine)
    if (errLine) onLog(errLine)
    if (build.code !== 0) return { ok: false, error: build.err.trim() || `build exited ${build.code}` }
    return { ok: true, outputs: names.map((n) => join(outdir, n)) }
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) }
  } finally {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ } }
  }
}
```

DELETE the entire `createBuilder` function (the last function in the file).

- [ ] **Step 4: Run the build.ts unit tests**

Run: `cd app && npx vitest run electron/build.test.ts`
Expected: PASS (unshellFirst + expectedOutputs + the rewritten runBuild + inspectBuild).

- [ ] **Step 5: Rewire `main.ts`**

Change the build import from `createBuilder` to the two functions:

```ts
import { inspectBuild, runBuild } from './build'
```

DELETE the `const builder = createBuilder({ ... })` block (including its `dialog.showMessageBox` confirmOverwrite) and the `ipcMain.handle('buildProject', ...)` handler. In their place add:

```ts
let lastBuildDir: string | undefined
ipcMain.handle('buildPickFolder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: lastBuildDir ?? '/' })
  if (r.canceled || r.filePaths.length === 0) return null
  lastBuildDir = r.filePaths[0]
  return lastBuildDir
})
ipcMain.handle('buildInspect', async (_e, json: unknown, outdir: string) => inspectBuild(json, outdir))
ipcMain.handle('buildRun', async (event, json: unknown, outdir: string, overwrite: boolean) =>
  runBuild(json, outdir, overwrite,
    (p) => event.sender.send('build:progress', p),
    (line) => event.sender.send('build:log', { line })))
```

- [ ] **Step 6: Rewire `preload.ts`**

In the `api` object, REMOVE the `buildProject` entry. Keep `onBuildProgress`. Add:

```ts
  buildPickFolder: (): Promise<string | null> => ipcRenderer.invoke('buildPickFolder'),
  buildInspect: (json: unknown, outdir: string) => ipcRenderer.invoke('buildInspect', json, outdir),
  buildRun: (json: unknown, outdir: string, overwrite: boolean) => ipcRenderer.invoke('buildRun', json, outdir, overwrite),
  onBuildLog: (cb: (p: { line: string }) => void) => {
    const h = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on('build:log', h)
    return () => ipcRenderer.removeListener('build:log', h)
  },
```

- [ ] **Step 7: Update the ambient types in `app.d.ts`**

After the `BuildResult` type add:

```ts
  interface BuildLog { line: string }
  type InspectResult =
    | { ok: true; outputs: string[]; existing: string[] }
    | { ok: false; error: string }
```

In `interface ElectronApi`, REMOVE the `buildProject` member and add:

```ts
    buildPickFolder: () => Promise<string | null>
    buildInspect: (json: unknown, outdir: string) => Promise<InspectResult>
    buildRun: (json: unknown, outdir: string, overwrite: boolean) => Promise<BuildResult>
    onBuildLog: (cb: (p: BuildLog) => void) => () => void
```

Keep `onBuildProgress`.

- [ ] **Step 8: Build the electron half + run the electron tests**

Removing `window.api.buildProject` leaves `+page.svelte` (which still calls it) failing to typecheck; that is restored in Task 4. So this task verifies the ELECTRON half only and intentionally defers the renderer build/typecheck to Task 4. Do NOT patch `+page.svelte` here.

Run: `cd app && npx tsup && npx vitest run electron`
Expected: tsup (electron main + preload) builds clean; all electron tests pass. Record in the task report that `npm run build` (full) and `npm run check` are intentionally deferred to Task 4, which re-greens the renderer.

- [ ] **Step 9: Commit**

```bash
git add app/electron/build.ts app/electron/build.test.ts app/electron/main.ts app/electron/preload.ts app/renderer/src/app.d.ts
git commit -m "Build: split inspect/run orchestration, stream log lines, rewire IPC"
```

---

### Task 2: canStartBuild gate helper

**Files:**
- Modify: `app/renderer/src/lib/project.ts`
- Modify: `app/renderer/src/lib/project.test.ts`

**Interfaces:**
- Produces: `canStartBuild(s: { folder: string | null; buildable: boolean; running: boolean; inspected: boolean; existingCount: number; overwrite: boolean }): boolean` - true iff a folder is set, the project is buildable, no run is in progress, an inspect succeeded, and there are no collisions or overwrite is checked.

- [ ] **Step 1: Write the failing test** (append to `app/renderer/src/lib/project.test.ts`)

```ts
import { canStartBuild } from './project'

describe('canStartBuild', () => {
  const base = { folder: '/out', buildable: true, running: false, inspected: true, existingCount: 0, overwrite: false }
  it('is true when folder set, buildable, inspected, no collisions, not running', () => {
    expect(canStartBuild(base)).toBe(true)
  })
  it('is false without a folder, when not buildable, while running, or before inspect', () => {
    expect(canStartBuild({ ...base, folder: null })).toBe(false)
    expect(canStartBuild({ ...base, buildable: false })).toBe(false)
    expect(canStartBuild({ ...base, running: true })).toBe(false)
    expect(canStartBuild({ ...base, inspected: false })).toBe(false)
  })
  it('requires overwrite when there are collisions', () => {
    expect(canStartBuild({ ...base, existingCount: 2, overwrite: false })).toBe(false)
    expect(canStartBuild({ ...base, existingCount: 2, overwrite: true })).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/project.test.ts`
Expected: FAIL - `canStartBuild` not exported.

- [ ] **Step 3: Implement** in `app/renderer/src/lib/project.ts` (append)

```ts
export function canStartBuild(s: {
  folder: string | null
  buildable: boolean
  running: boolean
  inspected: boolean
  existingCount: number
  overwrite: boolean
}): boolean {
  return !!s.folder && s.buildable && !s.running && s.inspected &&
    (s.existingCount === 0 || s.overwrite)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/project.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/lib/project.ts app/renderer/src/lib/project.test.ts
git commit -m "Build modal: canStartBuild gate helper"
```

---

### Task 3: BuildModal component

**Files:**
- Create: `app/renderer/src/lib/components/BuildModal.svelte`
- Create: `app/renderer/src/lib/components/BuildModal.test.ts`

**Interfaces:**
- Consumes: `window.api.buildPickFolder/buildInspect/buildRun/onBuildProgress/onBuildLog`; `toMkvedproj`, `hasBuildableEdition`, `canStartBuild` from `$lib/project`; `Project` type.
- Produces: `BuildModal.svelte` props `{ project: Project; onclose: () => void }`.

- [ ] **Step 1: Write the failing test** (`app/renderer/src/lib/components/BuildModal.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import BuildModal from './BuildModal.svelte'
import { newProject, addEdition, appendClip } from '$lib/project'

function buildable() {
  return appendClip(addEdition(newProject('/x'), 'Theatrical'), 0, '00001')
}

beforeEach(() => {
  ;(window as any).api = {
    buildPickFolder: vi.fn(async () => '/out'),
    buildInspect: vi.fn(async () => ({ ok: true, outputs: ['Movie.mkv'], existing: ['Movie.mkv'] })),
    buildRun: vi.fn(async () => ({ ok: true, outputs: ['/out/Movie.mkv'] })),
    onBuildProgress: vi.fn(() => () => {}),
    onBuildLog: vi.fn(() => () => {}),
  }
})

describe('BuildModal', () => {
  it('shows the collision warning and overwrite checkbox after inspecting a folder with existing files', async () => {
    render(BuildModal, { project: buildable(), onclose: () => {} })
    await fireEvent.click(screen.getByText(/choose/i))
    // inspect resolves with existing: ['Movie.mkv'] -> warning + checkbox appear
    expect(await screen.findByText(/will be overwritten/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/overwrite existing files/i)).toBeInTheDocument()
  })

  it('keeps Start disabled until overwrite is checked when there are collisions', async () => {
    render(BuildModal, { project: buildable(), onclose: () => {} })
    await fireEvent.click(screen.getByText(/choose/i))
    await screen.findByText(/will be overwritten/i)
    const start = screen.getByRole('button', { name: /^start$/i }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    await fireEvent.click(screen.getByLabelText(/overwrite existing files/i))
    expect(start.disabled).toBe(false)
  })

  it('calls onclose from the Close button', async () => {
    const onclose = vi.fn()
    render(BuildModal, { project: buildable(), onclose })
    await fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onclose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/components/BuildModal.test.ts`
Expected: FAIL - component not found.

- [ ] **Step 3: Implement `BuildModal.svelte`**

```svelte
<script lang="ts">
  import type { Project } from '$lib/project'
  import { toMkvedproj, hasBuildableEdition, canStartBuild } from '$lib/project'

  let { project, onclose }: { project: Project; onclose: () => void } = $props()

  let folder = $state<string | null>(null)
  let outputs = $state<string[]>([])
  let existing = $state<string[]>([])
  let inspected = $state(false)
  let inspectError = $state('')
  let overwrite = $state(false)
  let running = $state(false)
  let percent = $state(0)
  let log = $state('')
  let result = $state('')

  let buildable = $derived(hasBuildableEdition(project))
  let startable = $derived(
    canStartBuild({ folder, buildable, running, inspected, existingCount: existing.length, overwrite }),
  )

  async function inspect() {
    if (!folder) return
    inspected = false
    inspectError = ''
    const res = await window.api.buildInspect(toMkvedproj(project), folder)
    if (!res.ok) { inspectError = res.error; outputs = []; existing = []; return }
    outputs = res.outputs
    existing = res.existing
    inspected = true
  }

  async function choose() {
    const f = await window.api.buildPickFolder()
    if (!f) return
    folder = f
    overwrite = false
    await inspect()
  }

  // Re-inspect when a filename-affecting setting changes while a folder is set.
  function onSettingChange() { if (folder) inspect() }

  async function start() {
    if (!folder) return
    running = true
    result = ''
    log = ''
    percent = 0
    let offP: (() => void) | undefined
    let offL: (() => void) | undefined
    try {
      offP = window.api.onBuildProgress((p) => { percent = p.percent })
      offL = window.api.onBuildLog((p) => { log += p.line + '\n' })
      const res = await window.api.buildRun(toMkvedproj(project), folder, overwrite)
      result = res.ok ? `Built ${res.outputs.length} file(s) in ${folder}` : 'Build failed: ' + res.error
    } catch (e) {
      result = 'Build failed: ' + String((e as Error).message || e)
    } finally { offP?.(); offL?.(); running = false }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
  <div class="flex max-h-[90vh] w-[560px] flex-col gap-3 overflow-auto rounded-lg border border-primary-border/30 bg-surface p-4 text-sm dark:bg-surface-dark">
    <div class="flex items-center justify-between">
      <h2 class="text-base font-semibold">Build movie</h2>
      <button class="opacity-60 hover:opacity-100" title="close" onclick={onclose} disabled={running}>x</button>
    </div>

    <label class="flex items-center gap-2">Output name
      <input class="flex-1 rounded border border-primary-border/25 bg-page px-1 dark:bg-page-dark" bind:value={project.title} oninput={onSettingChange} />
    </label>
    <label class="flex items-center gap-2">Mode
      <select class="rounded border border-primary-border/25 bg-page px-1 dark:bg-page-dark" bind:value={project.mode} onchange={onSettingChange}>
        <option value="flat">flat</option><option value="linked">linked</option><option value="xin1">xin1</option>
      </select>
    </label>
    <label class="flex items-center gap-2"><input type="checkbox" bind:checked={project.preserve_chapters} /> preserve chapters</label>
    <label class="flex items-center gap-2"><input type="checkbox" bind:checked={project.qpfile} /> qpfile</label>

    <div class="flex items-center gap-2">
      <span class="truncate opacity-80">{folder ?? 'No output folder chosen'}</span>
      <button class="ml-auto rounded border border-primary-border/25 px-2 py-0.5 hover:bg-primary/10" onclick={choose} disabled={running}>Choose...</button>
    </div>

    {#if inspectError}
      <div class="text-red-400">{inspectError}</div>
    {:else if inspected}
      <div class="opacity-80">Will write {outputs.length} file(s): {outputs.join(', ')}</div>
      {#if existing.length}
        <div class="text-amber-400">{existing.length} file(s) will be overwritten: {existing.join(', ')}</div>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={overwrite} /> Overwrite existing files</label>
      {/if}
    {/if}

    {#if running || result || log}
      <div class="h-2 w-full overflow-hidden rounded bg-page dark:bg-page-dark">
        <div class="h-full bg-primary" style="width: {percent}%"></div>
      </div>
      <pre class="h-40 overflow-auto rounded border border-primary-border/20 bg-page p-1 text-xs dark:bg-page-dark">{log}</pre>
      {#if result}<div class="font-medium">{result}</div>{/if}
    {/if}

    <div class="mt-1 flex justify-end gap-2">
      <button class="rounded bg-primary px-3 py-1 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50" onclick={start} disabled={!startable}>Start</button>
      <button class="rounded border border-primary-border/25 px-3 py-1 hover:bg-primary/10 disabled:opacity-50" onclick={onclose} disabled={running}>Close</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/components/BuildModal.test.ts`
Expected: PASS. (If svelte-check later flags an a11y warning on a `<label>`/control association, resolve it minimally per Step 5; the test uses `getByLabelText`, so the checkbox label wrapping must associate the input with its text - the wrapping `<label>` does that.)

- [ ] **Step 5: Typecheck**

Run: `cd app/renderer && npm run check`
Expected: 0 errors 0 warnings. Fix any type/a11y issue with a targeted null-guard or single-rule `svelte-ignore` (do not loosen types). NOTE: `+page.svelte` is still broken until Task 4; if `npm run check` reports errors ONLY in `+page.svelte`, that is the expected Task 1 deferral - confirm `BuildModal.svelte` itself is clean and proceed.

- [ ] **Step 6: Commit**

```bash
git add app/renderer/src/lib/components/BuildModal.svelte app/renderer/src/lib/components/BuildModal.test.ts
git commit -m "Build modal: settings + inspect + inline collisions + live log component"
```

---

### Task 4: Open the modal from the shell

**Files:**
- Modify: `app/renderer/src/routes/+page.svelte`

**Interfaces:**
- Consumes: `BuildModal.svelte`; the existing `canBuild` derived and `hasBuildableEdition`.
- Produces: the header Build button opens the modal; the old one-shot `buildMovie`/`building` path is removed.

- [ ] **Step 1: Remove the old build path and add the modal toggle** in `+page.svelte`

Add the import with the other component imports:

```ts
  import BuildModal from '$lib/components/BuildModal.svelte'
```

DELETE the `let building = $state(false)` line and the entire `async function buildMovie() { ... }` function. Add near the other `$state` declarations:

```ts
  let showBuild = $state(false)
```

Keep the existing `let canBuild = $derived(!!project && hasBuildableEdition(project))`.

- [ ] **Step 2: Update the Build button and mount the modal**

Replace the existing Build button line with:

```svelte
    <button class="rounded bg-primary px-3 py-1 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50" onclick={() => (showBuild = true)} disabled={!canBuild}>Build...</button>
```

Immediately after the `</header>` (or at the end of the markup, top level), add:

```svelte
{#if showBuild && project}
  <BuildModal {project} onclose={() => (showBuild = false)} />
{/if}
```

- [ ] **Step 3: Build + typecheck + full renderer tests**

Run: `cd app && npm run build && npm run check --workspace renderer && cd renderer && npx vitest run`
Expected: build clean (the renderer half is now restored); svelte-check 0 errors 0 warnings; all renderer tests pass. This step re-greens the renderer that Task 1 intentionally left failing.

- [ ] **Step 4: Full electron + renderer suites**

Run: `cd app && npx vitest run electron && cd renderer && npx vitest run`
Expected: all electron and renderer tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/routes/+page.svelte
git commit -m "Shell: header Build button opens the BuildModal"
```

---

## Real-disc validation (after Task 4)

With `/mnt/br` mounted, `../run-app.sh`, Open folder on `/mnt/br`, arrange a small edition, then:
- Click **Build...**: the modal opens with the current settings; edit the output name/mode and see them reflected.
- **Choose...** an empty folder: the modal lists the expected `.mkv` name(s); **Start** streams mkvmerge log lines with the bar advancing to a playable file, then shows "Built N file(s)".
- Re-open, Choose the same folder: the collision warning lists the file(s), Start is disabled until **Overwrite existing files** is ticked.
- Trigger a failure (unwritable folder): the error line + log tail appear, no hang; Close is disabled only while running.

## Self-review notes

- Spec coverage: inspect/run split + log streaming + IPC rewire (T1); Start-gate helper (T2); the modal with editable settings, folder pick, inline collisions + overwrite checkbox, live log + progress + result (T3); header button opens the modal, old path removed (T4).
- Renderer stays fs-free: all spawning/path work is in `build.ts`; the modal only calls `window.api.*` and pure helpers.
- Interim build state: Task 1 removes `window.api.buildProject`, which `+page.svelte` still calls; the renderer typecheck/build is intentionally deferred and re-greened in Task 4. Task 1's gate is the electron half (`tsup` + electron vitest); Tasks 2-3 are renderer-pure and green on their own files; Task 4 restores the full green tree. Reviewers of T1 and T3 are told this deferral is expected.
- Type consistency: `InspectResult`/`BuildLog` defined in `build.ts` (T1) and `app.d.ts` (T1); `buildPickFolder`/`buildInspect`/`buildRun`/`onBuildLog` names match across main, preload, app.d.ts (T1) and the modal (T3); `canStartBuild`'s object shape (T2) matches the modal's call site (T3); channels `build:progress`/`build:log` match main-send and preload-on.
- Overwrite semantics: gated in the modal (Start disabled) AND in `runBuild` (`overwrite-declined`); a folder-pick cancel is a no-op.
