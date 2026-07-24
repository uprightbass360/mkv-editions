# File menu + header cleanup + folder-picker fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parent the native dialogs to the window so pickers surface reliably, remove the modal-duplicated build controls from the header, and gather the open/save actions into an in-app File dropdown.

**Architecture:** `main.ts` opens every dialog through two small window-parenting helpers. A new `FileMenu.svelte` dropdown (pure callback props) replaces the header's open/save buttons; the header keeps the File menu, the disc-title label, and the Build button. No CLI/IPC contract changes.

**Tech Stack:** Electron main (TypeScript, tsup, vitest node), SvelteKit renderer (Svelte 5 runes, vitest jsdom, Tailwind 4 ARM tokens).

## Global Constraints

- NO em-dashes anywhere (code, comments, commit messages). Use "-" or reword.
- The renderer never imports fs/electron/child_process; components take callback props and never call `window.api` (the shell wires it).
- Svelte 5 runes only (`$props`/`$state`/`$effect`), lowercase handlers, NO createEventDispatcher. Targeted single-rule `<!-- svelte-ignore <rule> -->` only where a specific new warning appears.
- Renderer bar: `npm run check` 0 errors AND 0 warnings, all renderer tests passing. Electron bar: `npx vitest run electron` green and `npm run build` clean.
- The dialog change is surfacing-only: same properties/filters, same return values, same cancel handling. If no window is resolved, fall back to the no-parent dialog form.

---

### Task 1: Parent the native dialogs to the window

**Files:**
- Modify: `app/electron/main.ts`

**Interfaces:**
- Produces: two module-local helpers `showOpen(opts)` / `showSave(opts)` that parent the dialog to `BrowserWindow.getFocusedWindow()` when present; used by `buildPickFolder`, `openProject`, `saveProject`, and the `createOpener` dialog dep (for `openInput`).

- [ ] **Step 1: Add the parenting helpers** in `app/electron/main.ts`

After the imports (which already include `BrowserWindow` and `dialog` from 'electron'), add near the other top-level handlers (above the `ipcMain.handle('scan', ...)` line is fine):

```ts
function showOpen(opts: Electron.OpenDialogOptions) {
  const win = BrowserWindow.getFocusedWindow()
  return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)
}
function showSave(opts: Electron.SaveDialogOptions) {
  const win = BrowserWindow.getFocusedWindow()
  return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts)
}
```

- [ ] **Step 2: Route the four dialog sites through the helpers**

Change the `createOpener` construction to use the helper:

```ts
const opener = createOpener({ showOpenDialog: showOpen })
```

Change `saveProject` to use `showSave`:

```ts
ipcMain.handle('saveProject', async (_e, json: unknown, title: string) => {
  const r = await showSave({ defaultPath: `${title || 'movie'}.mkvedproj` })
  if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' }
  try { await writeProjectFile(r.filePath, json); return { ok: true, path: r.filePath } }
  catch (e) { return { ok: false, error: String(e) } }
})
```

Change `openProject` to use `showOpen`:

```ts
ipcMain.handle('openProject', async () => {
  const r = await showOpen({ properties: ['openFile'], filters: [{ name: 'mkvedproj', extensions: ['mkvedproj', 'json'] }] })
  if (r.canceled || r.filePaths.length === 0) return null
  try { return { ok: true, json: await readProjectFile(r.filePaths[0]) } }
  catch (e) { return { ok: false, error: String(e) } }
})
```

Change `buildPickFolder` to use `showOpen`:

```ts
let lastBuildDir: string | undefined
ipcMain.handle('buildPickFolder', async () => {
  const r = await showOpen({ properties: ['openDirectory'], defaultPath: lastBuildDir ?? '/' })
  if (r.canceled || r.filePaths.length === 0) return null
  lastBuildDir = r.filePaths[0]
  return lastBuildDir
})
```

(The `openInput` handler is unchanged; it already delegates to `opener`, whose dialog dep is now `showOpen`.)

- [ ] **Step 3: Build the electron half + run electron tests**

Run: `cd app && npx tsup && npx vitest run electron`
Expected: tsup builds clean; all electron tests pass (no test changes; dialog surfacing is not unit-tested). If TypeScript complains about the `Electron.OpenDialogOptions`/`SaveDialogOptions` namespace types, they are available from the ambient `electron` types already imported; no new import is needed.

- [ ] **Step 4: Commit**

```bash
git add app/electron/main.ts
git commit -m "Main: parent open/save dialogs to the window so they surface reliably"
```

---

### Task 2: FileMenu dropdown component

**Files:**
- Create: `app/renderer/src/lib/components/FileMenu.svelte`
- Create: `app/renderer/src/lib/components/FileMenu.test.ts`

**Interfaces:**
- Produces: `FileMenu.svelte` props `{ scanning: boolean; canSave: boolean; onOpenFolder: () => void; onOpenZip: () => void; onOpenIso: () => void; onOpenProject: () => void; onSaveProject: () => void }`. A "File" button toggles a dropdown of Open folder / Open ZIP / Open ISO / Open project / (Save project when `canSave`); selecting an item fires its callback and closes; Escape and an outside click close; the folder/zip items are disabled while `scanning`.

- [ ] **Step 1: Write the failing test** (`app/renderer/src/lib/components/FileMenu.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import FileMenu from './FileMenu.svelte'

function mount(overrides: Record<string, unknown> = {}) {
  const props = {
    scanning: false, canSave: false,
    onOpenFolder: vi.fn(), onOpenZip: vi.fn(), onOpenIso: vi.fn(),
    onOpenProject: vi.fn(), onSaveProject: vi.fn(), ...overrides,
  }
  render(FileMenu, props)
  return props
}

describe('FileMenu', () => {
  it('opens on File click, fires the item callback, then closes', async () => {
    const props = mount()
    await fireEvent.click(screen.getByText('File'))
    await fireEvent.click(screen.getByText('Open folder...'))
    expect(props.onOpenFolder).toHaveBeenCalled()
    expect(screen.queryByText('Open ZIP...')).toBeNull()
  })
  it('hides Save project until canSave is true', async () => {
    mount({ canSave: false })
    await fireEvent.click(screen.getByText('File'))
    expect(screen.queryByText('Save project...')).toBeNull()
  })
  it('shows and fires Save project when canSave', async () => {
    const props = mount({ canSave: true })
    await fireEvent.click(screen.getByText('File'))
    await fireEvent.click(screen.getByText('Save project...'))
    expect(props.onSaveProject).toHaveBeenCalled()
  })
  it('disables the open-and-scan items while scanning', async () => {
    mount({ scanning: true })
    await fireEvent.click(screen.getByText('File'))
    expect((screen.getByText('Open folder...') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Open ZIP...') as HTMLButtonElement).disabled).toBe(true)
  })
  it('closes on Escape', async () => {
    mount()
    await fireEvent.click(screen.getByText('File'))
    expect(screen.getByText('Open folder...')).toBeInTheDocument()
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Open folder...')).toBeNull()
  })
  it('closes on an outside click', async () => {
    mount()
    await fireEvent.click(screen.getByText('File'))
    expect(screen.getByText('Open folder...')).toBeInTheDocument()
    await fireEvent.click(document.body)
    expect(screen.queryByText('Open folder...')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/components/FileMenu.test.ts`
Expected: FAIL - component not found.

- [ ] **Step 3: Implement `FileMenu.svelte`**

```svelte
<script lang="ts">
  let { scanning, canSave, onOpenFolder, onOpenZip, onOpenIso, onOpenProject, onSaveProject }: {
    scanning: boolean
    canSave: boolean
    onOpenFolder: () => void
    onOpenZip: () => void
    onOpenIso: () => void
    onOpenProject: () => void
    onSaveProject: () => void
  } = $props()

  let open = $state(false)

  function choose(fn: () => void) { open = false; fn() }

  function onDocClick() { open = false }
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') open = false }

  $effect(() => {
    if (!open) return
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  })
</script>

<div class="relative">
  <button class="rounded border border-primary-border/25 px-3 py-1 hover:bg-primary/10" onclick={(e) => { e.stopPropagation(); open = !open }}>File</button>
  {#if open}
    <div class="absolute left-0 z-40 mt-1 flex w-44 flex-col rounded border border-primary-border/25 bg-surface py-1 text-sm shadow-lg dark:bg-surface-dark" role="menu">
      <button class="px-3 py-1 text-left hover:bg-primary/10 disabled:opacity-50" role="menuitem" disabled={scanning} onclick={() => choose(onOpenFolder)}>Open folder...</button>
      <button class="px-3 py-1 text-left hover:bg-primary/10 disabled:opacity-50" role="menuitem" disabled={scanning} onclick={() => choose(onOpenZip)}>Open ZIP...</button>
      <button class="px-3 py-1 text-left hover:bg-primary/10" role="menuitem" onclick={() => choose(onOpenIso)}>Open ISO...</button>
      <button class="px-3 py-1 text-left hover:bg-primary/10" role="menuitem" onclick={() => choose(onOpenProject)}>Open project...</button>
      {#if canSave}
        <button class="px-3 py-1 text-left hover:bg-primary/10" role="menuitem" onclick={() => choose(onSaveProject)}>Save project...</button>
      {/if}
    </div>
  {/if}
</div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/components/FileMenu.test.ts`
Expected: PASS (all six cases).

- [ ] **Step 5: Typecheck**

Run: `cd app/renderer && npm run check`
Expected: 0 errors 0 warnings. If svelte-check flags an a11y rule on the `role="menu"`/`role="menuitem"` markup, resolve it with a targeted single-rule `<!-- svelte-ignore <rule> -->` on the specific element (do not loosen types or remove the roles).

- [ ] **Step 6: Commit**

```bash
git add app/renderer/src/lib/components/FileMenu.svelte app/renderer/src/lib/components/FileMenu.test.ts
git commit -m "FileMenu: in-app File dropdown for open/save actions"
```

---

### Task 3: Wire FileMenu into the header and remove the modal-duplicated controls

**Files:**
- Modify: `app/renderer/src/routes/+page.svelte`

**Interfaces:**
- Consumes: `FileMenu.svelte`; the existing `openAndScan`/`pickAndOpen` handlers, `showIso` state, `scanning` state, `canBuild` derived, `toMkvedproj`.
- Produces: a `saveProject()` helper; the header now renders `<FileMenu ... />`, the disc-title label, and the Build button.

- [ ] **Step 1: Add the FileMenu import and a saveProject helper** in `+page.svelte`

Add the import with the other component imports:

```ts
  import FileMenu from '$lib/components/FileMenu.svelte'
```

Add near the other handlers (e.g. after `pickAndOpen`):

```ts
  async function saveProject() {
    if (project) await window.api.saveProject(toMkvedproj(project), project.title)
  }
```

- [ ] **Step 2: Replace the header buttons/controls**

In the `<header>`, REMOVE these elements: the four buttons `Open folder...`, `Open ZIP...`, `Open ISO...`, `Open project...`; and, inside the `{#if project}` block, the `project.title` `<input>`, the `project.mode` `<select>`, the preserve-chapters `<label>`, and the `Save project...` button. KEEP the disc-title label, the Build button, and the progress span.

The header body becomes exactly:

```svelte
<header class="flex items-center gap-2.5 border-b border-primary-border/15 bg-surface px-2 py-1.5 dark:bg-surface-dark">
  <FileMenu
    scanning={scanning}
    canSave={!!project}
    onOpenFolder={() => openAndScan('folder')}
    onOpenZip={() => openAndScan('zip')}
    onOpenIso={() => (showIso = !showIso)}
    onOpenProject={pickAndOpen}
    onSaveProject={saveProject}
  />
  {#if model?.disc.title}<span class="text-sm font-semibold opacity-90">{model.disc.title}</span>{/if}
  {#if project}
    <button class="rounded bg-primary px-3 py-1 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50" onclick={() => (showBuild = true)} disabled={!canBuild}>Build...</button>
  {/if}
  <span class="ml-auto text-xs opacity-70">{progress}</span>
</header>
```

Leave everything below the header (the `{#if showBuild && project}<BuildModal .../>`, the ISO help panel, the encrypted banner, the columns, DetailPanel) unchanged.

- [ ] **Step 3: Build + typecheck + full renderer tests**

Run: `cd app && npm run build && npm run check --workspace renderer && cd renderer && npx vitest run`
Expected: build clean; svelte-check 0 errors 0 warnings; all renderer tests pass. Confirm there are no now-unused imports left behind (e.g. everything still referenced: `toMkvedproj` by `saveProject`, `openAndScan`/`pickAndOpen`/`showIso`/`scanning`/`canBuild` by the header). Do NOT remove `toMkvedproj` (used by `saveProject`).

- [ ] **Step 4: Full electron + renderer suites**

Run: `cd app && npx vitest run electron && cd renderer && npx vitest run`
Expected: all electron and renderer tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/routes/+page.svelte
git commit -m "Shell: header File menu, drop modal-duplicated build controls"
```

---

## Real-disc validation (after Task 3)

With `/mnt/br` mounted, `../run-app.sh`:
- The header shows **File**, the disc title (after a scan), and **Build...**; the output-name/mode/preserve controls are gone from the header.
- The **File** menu opens folder/ZIP/ISO/project and (with a project) Save, each behaving as the old buttons did; the menu closes on select, Escape, and outside click.
- In the Build modal, **Choose...** now opens the folder dialog in front of the window and returns the chosen path (the reported bug); title/mode/preserve are still editable there.

## Self-review notes

- Spec coverage: dialog parenting for all four sites (T1); the FileMenu dropdown with the five items, scan-gating, and close-on-select/Escape/outside-click (T2); header restructure removing the modal-duplicated controls and wiring the menu + saveProject helper (T3).
- Renderer fs-free: `FileMenu` takes callbacks only; the shell (`+page.svelte`) owns the one `window.api.saveProject` call in `saveProject`.
- Type consistency: `FileMenu`'s seven props (T2) match the `<FileMenu ... />` call site (T3); `saveProject` uses the existing `toMkvedproj` + `window.api.saveProject(json, title)` signature.
- The Build modal, its IPC, and the CLI are untouched; only the header composition and the dialog-parenting wiring change.
