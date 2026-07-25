# Undo / redo / revert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add step-wise Undo/Redo over every project edit plus a one-shot Revert to the scan baseline, via a snapshot history of `Project` values.

**Architecture:** A pure `history.ts` holds `past`/`future` stacks. `+page.svelte` makes the existing `apply` edit-gate record history, adds undo/redo/revert ops, a keyboard listener, and baseline/reset on load. The Build modal's four two-way `bind:` settings are converted to an `onedit` path so every edit is an immutable `Project` transform (making snapshots reference-safe). Undo/Redo/Revert appear as disabled-aware File-menu items.

**Tech Stack:** SvelteKit renderer (Svelte 5 runes, vitest jsdom, Tailwind 4 ARM tokens). No CLI change.

## Global Constraints

- NO em-dashes anywhere (code, comments, commit messages). Use "-" or reword.
- The renderer never imports fs/electron/child_process; components take callback/flag props.
- Svelte 5 runes only (`$props`/`$state`/`$derived`/`$effect`), lowercase handlers, NO createEventDispatcher.
- No change to the CLI, `.mkvedproj` contract, save, or build.
- Renderer bar: `npm run check` (svelte-check) 0 errors AND 0 warnings, all tests passing; from Task 2 onward `npm run build` clean and (Task 4) `npx vitest run electron` green.
- Every edit must be an immutable `Project` transform (no two-way `bind:` mutation of `project`), so history snapshots can be plain references.

---

### Task 1: History module

**Files:**
- Create: `app/renderer/src/lib/history.ts`
- Create: `app/renderer/src/lib/history.test.ts`

**Interfaces:**
- Produces: `History<T> { past: T[]; future: T[] }`; `emptyHistory<T>(): History<T>`; `record<T>(h, current, cap=100): History<T>` (push current to past, clear future, cap oldest); `undo<T>(h, current): { history; value } | null`; `redo<T>(h, current): { history; value } | null`.

- [ ] **Step 1: Write the failing test** (`app/renderer/src/lib/history.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { emptyHistory, record, undo, redo } from './history'

describe('history', () => {
  it('record pushes current and clears the redo future', () => {
    expect(record({ past: ['a'], future: ['z'] }, 'b')).toEqual({ past: ['a', 'b'], future: [] })
  })
  it('record honors the cap, dropping oldest', () => {
    let h = emptyHistory<number>()
    for (let i = 0; i < 5; i++) h = record(h, i, 3)
    expect(h.past).toEqual([2, 3, 4])
  })
  it('undo returns the last past and pushes current onto future', () => {
    const r = undo({ past: ['a', 'b'], future: [] }, 'c')!
    expect(r.value).toBe('b')
    expect(r.history).toEqual({ past: ['a'], future: ['c'] })
  })
  it('undo returns null at the start', () => {
    expect(undo(emptyHistory<string>(), 'c')).toBeNull()
  })
  it('redo returns the first future and pushes current onto past', () => {
    const r = redo({ past: ['a'], future: ['c'] }, 'b')!
    expect(r.value).toBe('c')
    expect(r.history).toEqual({ past: ['a', 'b'], future: [] })
  })
  it('redo returns null at the end', () => {
    expect(redo({ past: ['a'], future: [] }, 'b')).toBeNull()
  })
  it('a record after undo drops the redo future', () => {
    let h: any = { past: ['s0', 's1'], future: [] }
    let cur = 's2'
    let r = undo(h, cur)!; h = r.history; cur = r.value // cur=s1, future=[s2]
    h = record(h, cur)
    expect(h.future).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/history.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `history.ts`**

```ts
export interface History<T> { past: T[]; future: T[] }

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] }
}

/** Record `current` as a new past entry and clear the redo future. */
export function record<T>(h: History<T>, current: T, cap = 100): History<T> {
  return { past: [...h.past, current].slice(-cap), future: [] }
}

/** Step back: pop the last past into `value`, push `current` onto future. Null at the start. */
export function undo<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  if (h.past.length === 0) return null
  const value = h.past[h.past.length - 1]
  return { history: { past: h.past.slice(0, -1), future: [current, ...h.future] }, value }
}

/** Step forward: shift the first future into `value`, push `current` onto past. Null at the end. */
export function redo<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  if (h.future.length === 0) return null
  const value = h.future[0]
  return { history: { past: [...h.past, current], future: h.future.slice(1) }, value }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/lib/history.ts app/renderer/src/lib/history.test.ts
git commit -m "History: pure record/undo/redo snapshot stack"
```

---

### Task 2: Make the Build modal settings immutable (onedit)

**Files:**
- Modify: `app/renderer/src/lib/components/BuildModal.svelte`
- Modify: `app/renderer/src/lib/components/BuildModal.test.ts`
- Modify: `app/renderer/src/routes/+page.svelte`

**Interfaces:**
- Produces: `BuildModal` gains a prop `onedit: (fn: (p: Project) => Project) => void`; its four settings (output name, mode, preserve-chapters, qpfile) route through `onedit` instead of two-way `bind:`; re-inspect is driven by a `$effect`. `+page.svelte` passes `onedit={apply}`.

- [ ] **Step 1: Write the failing test** (append to `app/renderer/src/lib/components/BuildModal.test.ts`; add `onedit: vi.fn()` to the EXISTING `render(BuildModal, { ... })` calls so the new required prop is satisfied)

```ts
it('routes an output-name edit through onedit instead of two-way bind', async () => {
  const onedit = vi.fn()
  render(BuildModal, { project: buildable(), onclose: () => {}, onedit })
  const input = screen.getByDisplayValue('movie')
  await fireEvent.change(input, { target: { value: 'My Film' } })
  expect(onedit).toHaveBeenCalled()
  const fn = onedit.mock.calls[0][0]
  expect(fn(buildable()).title).toBe('My Film')
})
```

(The existing `buildable()` helper returns a project whose `title` is `'movie'`; `screen`/`vi`/`fireEvent` are already imported in this file.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/components/BuildModal.test.ts`
Expected: FAIL - `onedit` not a function / settings still use bind.

- [ ] **Step 3: Update `BuildModal.svelte`**

Add `onedit` to the props:

```svelte
  let { project, onclose, onedit }: {
    project: Project
    onclose: () => void
    onedit: (fn: (p: Project) => Project) => void
  } = $props()
```

Replace the `onSettingChange` function with a re-inspect `$effect`. Delete:

```ts
  // Re-inspect when a filename-affecting setting changes while a folder is set.
  function onSettingChange() { if (folder) inspect() }
```

and add (after the `choose` function):

```ts
  // Re-inspect whenever the output folder or a filename-affecting setting changes.
  $effect(() => {
    const _deps = [folder, project.title, project.mode]
    void _deps
    if (folder) inspect()
  })
```

Remove the explicit `await inspect()` from `choose` so the effect is the single re-inspect trigger:

```ts
  async function choose() {
    const f = await window.api.buildPickFolder()
    if (!f) return
    overwrite = false
    folder = f
  }
```

Replace the four settings controls (the `Output name` input, the `Mode` select, and the two checkboxes) with one-way value + `onedit`:

```svelte
    <label class="flex items-center gap-2">Output name
      <input class="flex-1 rounded border border-primary-border/25 bg-page px-1 dark:bg-page-dark" value={project.title} onchange={(e) => onedit((p) => ({ ...p, title: (e.target as HTMLInputElement).value }))} />
    </label>
    <label class="flex items-center gap-2">Mode
      <select class="rounded border border-primary-border/25 bg-page px-1 dark:bg-page-dark" value={project.mode} onchange={(e) => onedit((p) => ({ ...p, mode: (e.target as HTMLSelectElement).value as Project['mode'] }))}>
        <option value="flat">flat</option><option value="linked">linked</option><option value="xin1">xin1</option>
      </select>
    </label>
    <label class="flex items-center gap-2"><input type="checkbox" checked={project.preserve_chapters} onchange={(e) => onedit((p) => ({ ...p, preserve_chapters: (e.target as HTMLInputElement).checked }))} /> preserve chapters</label>
    <label class="flex items-center gap-2"><input type="checkbox" checked={project.qpfile} onchange={(e) => onedit((p) => ({ ...p, qpfile: (e.target as HTMLInputElement).checked }))} /> qpfile</label>
```

(The overwrite checkbox on line ~93 stays a local `bind:checked={overwrite}` - it is modal-local state, not project state.)

- [ ] **Step 4: Pass `onedit` from `+page.svelte`**

Find `<BuildModal {project} onclose={() => (showBuild = false)} />` and change it to:

```svelte
  <BuildModal {project} onedit={apply} onclose={() => (showBuild = false)} />
```

(`apply` already exists; Task 4 makes it record history. Passing it now is correct either way.)

- [ ] **Step 5: Run tests + typecheck + build**

Run: `cd app/renderer && npx vitest run && npm run check && cd .. && npm run build`
Expected: all renderer tests pass (incl. the existing BuildModal tests with the added `onedit`), svelte-check 0 errors 0 warnings, build clean.

- [ ] **Step 6: Commit**

```bash
git add app/renderer/src/lib/components/BuildModal.svelte app/renderer/src/lib/components/BuildModal.test.ts app/renderer/src/routes/+page.svelte
git commit -m "BuildModal: route settings through onedit (immutable) instead of two-way bind"
```

---

### Task 3: Undo / Redo / Revert items in the File menu

**Files:**
- Modify: `app/renderer/src/lib/components/FileMenu.svelte`
- Modify: `app/renderer/src/lib/components/FileMenu.test.ts`

**Interfaces:**
- Produces: `FileMenu` gains props `onUndo`, `onRedo`, `onRevert` (callbacks) and `canUndo`, `canRedo`, `canRevert` (flags); renders Undo/Redo/Revert as a separated group above the open items, disabled per their flags, closing the menu on select.

- [ ] **Step 1: Write the failing tests** (in `app/renderer/src/lib/components/FileMenu.test.ts`, extend the `mount` helper's default props with the six new props, then add the cases)

Add to the `mount` defaults object: `onUndo: vi.fn(), onRedo: vi.fn(), onRevert: vi.fn(), canUndo: false, canRedo: false, canRevert: false,`.

```ts
  it('shows Undo/Redo/Revert disabled when their flags are false', async () => {
    mount()
    await fireEvent.click(screen.getByText('File'))
    expect((screen.getByText('Undo') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Redo') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Revert') as HTMLButtonElement).disabled).toBe(true)
  })
  it('fires onUndo when enabled and closes the menu', async () => {
    const props = mount({ canUndo: true })
    await fireEvent.click(screen.getByText('File'))
    await fireEvent.click(screen.getByText('Undo'))
    expect(props.onUndo).toHaveBeenCalled()
    expect(screen.queryByText('Redo')).toBeNull()
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/components/FileMenu.test.ts`
Expected: FAIL - no Undo/Redo/Revert items.

- [ ] **Step 3: Update `FileMenu.svelte`**

Add the six props:

```svelte
  let { scanning, canSave, onOpenFolder, onOpenZip, onOpenIso, onOpenProject, onSaveProject,
    onUndo, onRedo, onRevert, canUndo, canRedo, canRevert }: {
    scanning: boolean
    canSave: boolean
    onOpenFolder: () => void
    onOpenZip: () => void
    onOpenIso: () => void
    onOpenProject: () => void
    onSaveProject: () => void
    onUndo: () => void
    onRedo: () => void
    onRevert: () => void
    canUndo: boolean
    canRedo: boolean
    canRevert: boolean
  } = $props()
```

In the dropdown `<div role="menu">`, insert this group as the FIRST children (before the `Open folder...` button):

```svelte
      <button class="px-3 py-1 text-left hover:bg-primary/10 disabled:opacity-50" role="menuitem" disabled={!canUndo} onclick={() => choose(onUndo)}>Undo</button>
      <button class="px-3 py-1 text-left hover:bg-primary/10 disabled:opacity-50" role="menuitem" disabled={!canRedo} onclick={() => choose(onRedo)}>Redo</button>
      <button class="px-3 py-1 text-left hover:bg-primary/10 disabled:opacity-50" role="menuitem" disabled={!canRevert} onclick={() => choose(onRevert)}>Revert</button>
      <div class="my-1 border-t border-primary-border/20"></div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/components/FileMenu.test.ts`
Expected: PASS (new cases + the existing FileMenu tests).

- [ ] **Step 5: Typecheck**

Run: `cd app/renderer && npm run check`
Expected: 0 errors 0 warnings. (`+page.svelte` will error because it does not yet pass the six new props - that is fixed in Task 4. If the ONLY remaining svelte-check errors are the missing FileMenu props in `+page.svelte`, that is expected; confirm `FileMenu.svelte` itself is clean and proceed. Do NOT patch `+page.svelte` in this task.)

- [ ] **Step 6: Commit**

```bash
git add app/renderer/src/lib/components/FileMenu.svelte app/renderer/src/lib/components/FileMenu.test.ts
git commit -m "FileMenu: Undo / Redo / Revert items (disabled-aware)"
```

---

### Task 4: Wire history into the shell

**Files:**
- Modify: `app/renderer/src/routes/+page.svelte`

**Interfaces:**
- Consumes: `emptyHistory`/`record`/`undo`/`redo` from `$lib/history`; the FileMenu undo/redo/revert props (Task 3).
- Produces: history-recording `apply`, `doUndo`/`doRedo`/`doRevert`, `baseline` + reset on load, a keyboard listener, and the FileMenu wired with the ops + derived flags.

- [ ] **Step 1: Import the history module and add state** in `+page.svelte`

Add the import near the other `$lib` imports:

```ts
  import { emptyHistory, record, undo as undoHistory, redo as redoHistory, type History } from '$lib/history'
```

Add state near the other `$state` declarations:

```ts
  let history = $state<History<Project>>(emptyHistory())
  let baseline = $state<Project | null>(null)
```

Add derived flags near the other `$derived` lines:

```ts
  let canUndo = $derived(history.past.length > 0)
  let canRedo = $derived(history.future.length > 0)
  let canRevert = $derived(!!baseline && !!project && JSON.stringify(project) !== JSON.stringify(baseline))
```

- [ ] **Step 2: Make `apply` record, and add the ops**

Replace `function apply(fn: (p: Project) => Project) { if (project) project = fn(project) }` with:

```ts
  function apply(fn: (p: Project) => Project) {
    if (!project) return
    history = record(history, project)
    project = fn(project)
  }
  function doUndo() {
    if (!project) return
    const r = undoHistory(history, project)
    if (r) { history = r.history; project = r.value }
  }
  function doRedo() {
    if (!project) return
    const r = redoHistory(history, project)
    if (r) { history = r.history; project = r.value }
  }
  function doRevert() {
    if (!baseline || !project) return
    history = record(history, project)
    project = baseline
  }
```

- [ ] **Step 3: Set baseline + reset on load**

In `scanInto`, immediately after `project = p` (the last line of the `try`), add:

```ts
      baseline = p
      history = emptyHistory()
```

In `pickAndOpen`, change the `try` body so the loaded project becomes the baseline:

```ts
    try {
      const p = fromMkvedproj(r.json)
      project = p
      baseline = p
      history = emptyHistory()
    } catch (e) {
      progress = 'open failed: ' + String((e as Error).message || e)
    }
```

- [ ] **Step 4: Add the keyboard listener** (near the other logic; a `$effect`)

```ts
  $effect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); doRedo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
```

- [ ] **Step 5: Wire the FileMenu props**

On the `<FileMenu ... />` element, add the ops and flags:

```svelte
      onUndo={doUndo}
      onRedo={doRedo}
      onRevert={doRevert}
      {canUndo}
      {canRedo}
      {canRevert}
```

- [ ] **Step 6: Build + typecheck + full suites**

Run: `cd app && npm run build && npm run check --workspace renderer && npx vitest run electron && cd renderer && npx vitest run`
Expected: build clean; svelte-check 0 errors 0 warnings (the Task 3 `+page.svelte` FileMenu-prop errors are now resolved); all electron and renderer tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/renderer/src/routes/+page.svelte
git commit -m "Shell: undo/redo/revert history, keyboard shortcuts, File-menu wiring"
```

---

## Real-disc validation (after Task 4)

With `/mnt/br` mounted, `../run-app.sh`, Open folder on `/mnt/br`:
- Make several edits (add an edition, drag-reorder clips, toggle a track, rename the output in the Build modal). Ctrl+Z steps each back; Ctrl+Shift+Z (or Ctrl+Y) steps forward.
- The File menu's Undo/Redo/Revert enable/disable correctly; Revert jumps to the freshly-scanned baseline and one Undo brings the edits back.
- A shortcut pressed while the output-name field is focused does NOT trigger project undo (native field editing is unaffected).
- Loading a different disc clears the history (Undo disabled).

## Self-review notes

- Spec coverage: pure history stack (T1); the immutable-settings prerequisite so every edit is a `Project` transform (T2); Undo/Redo/Revert File-menu items (T3); history-recording `apply`, ops, baseline/reset, keyboard, wiring (T4).
- Immutability: after T2 no `bind:` mutates `project` (only modal-local `overwrite` stays bound), so history/baseline snapshots are reference-safe with no cloning.
- Interim state: T3 leaves `+page.svelte` failing svelte-check (missing new FileMenu props) until T4 wires them; T3's gate is its own component tests + FileMenu.svelte being clean; T4 re-greens the full tree.
- Type consistency: `History<T>`/`record`/`undo`/`redo` defined in `history.ts` (T1) and consumed in `+page` (T4); `onedit: (fn: (p: Project) => Project) => void` matches `apply` (T2/T4); the FileMenu `onUndo`/`onRedo`/`onRevert`/`canUndo`/`canRedo`/`canRevert` (T3) match the `+page` wiring (T4).
- Renderer stays fs-free: history is in-memory renderer state; save/build read the live `project` unchanged.
