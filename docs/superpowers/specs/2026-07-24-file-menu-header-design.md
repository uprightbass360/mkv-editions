# File menu + header cleanup + folder-picker fix

Consolidate the workbench header: move the build settings that now live in the
Build modal out of the header, gather the remaining open/save actions into an
in-app **File** dropdown, and fix the Build modal's output-folder picker not
surfacing.

Builds on the Build modal feature (same `descriptive-metadata` branch). The app
is in `app/`: Electron shell (`app/electron/`) + SvelteKit renderer
(`app/renderer/`). The Python CLI and the `.mkvedproj` contract are UNCHANGED.

## Scope

- **Folder-picker fix** (`app/electron/main.ts`): parent the native open/save
  dialogs to the window so they reliably surface (on WSLg a parent-less dialog
  launched while the modal overlay is up can open behind the window or without
  focus, which reads as "did not open"). Apply to `buildPickFolder` (the
  reported case) and, since it is the same one-line change and they share the
  environment, to `openInput`, `openProject`, and `saveProject`.
- **Header cleanup** (`app/renderer/src/routes/+page.svelte`): remove the
  output-name input, the mode select, and the preserve-chapters checkbox from
  the header - they are editable in the Build modal now.
- **File menu** (`app/renderer/src/lib/components/FileMenu.svelte`, new): a
  "File" dropdown gathering Open folder / Open ZIP / Open ISO / Open project /
  Save project.

## Non-goals

- No change to the Build modal itself (its settings + folder pick stay).
- No change to the CLI, `build.sh`, or the `.mkvedproj` contract.
- No native OS application menu (an in-app dropdown was chosen for parity with
  the ARM-styled header and testability).
- The Build button stays a header button (not a menu item).

## Components

### Electron main (`app/electron/main.ts`)

The four dialog-opening handlers each resolve the calling window and pass it as
the dialog parent:

- `buildPickFolder`, `openInput` (inside `createOpener`), `openProject`,
  `saveProject`: obtain `const win = BrowserWindow.fromWebContents(event.sender)`
  and call `dialog.showOpenDialog(win, opts)` / `dialog.showSaveDialog(win, opts)`
  when `win` is non-null, else fall back to the no-parent form. Electron accepts
  a `BrowserWindow` as the first argument to make the dialog window-modal, which
  guarantees it surfaces above and focused.
- `createOpener` currently takes `showOpenDialog: (opts) => dialog.showOpenDialog(opts)`.
  It gains the window: the `openInput` handler passes the parented dialog fn
  (`(opts) => dialog.showOpenDialog(win, opts)`) built from `event.sender`. The
  injected-deps shape (for tests) is preserved; only the concrete wiring in
  `main.ts` changes.

Behavior is otherwise identical: same properties/filters, same return values,
same cancel handling. This is a surfacing/robustness fix, not a contract change.

### Renderer - FileMenu (`app/renderer/src/lib/components/FileMenu.svelte`, new)

Props (all callback/flag, no `window.api` inside the component):

```ts
{
  scanning: boolean
  canSave: boolean
  onOpenFolder: () => void
  onOpenZip: () => void
  onOpenIso: () => void
  onOpenProject: () => void
  onSaveProject: () => void
}
```

- A "File" button toggles an absolutely-positioned dropdown panel below it.
- Items in order: **Open folder...**, **Open ZIP...**, **Open ISO...**,
  **Open project...**, and (only when `canSave`) **Save project...**.
- The three open-and-scan items (folder/zip) are disabled while `scanning`
  (matching the current header buttons, which disable during a scan); Open ISO,
  Open project, and Save project are not scan-gated.
- Selecting any item calls its callback and closes the menu.
- The menu closes on: item select, Escape, and an outside click (a document
  click listener registered while open, removed when closed).
- ARM tokens for styling, consistent with the other components.

### Renderer - shell (`app/renderer/src/routes/+page.svelte`)

- Remove the `project.title` input, the `project.mode` select, and the
  preserve-chapters `<label>`/checkbox from the header.
- Add a `saveProject()` helper wrapping the existing inline save
  (`if (project) await window.api.saveProject(toMkvedproj(project), project.title)`).
- Replace the four standalone open/save header buttons with a single
  `<FileMenu ... />` wired to `openAndScan('folder')`, `openAndScan('zip')`,
  the ISO toggle (`showIso = !showIso`), `pickAndOpen`, and `saveProject`, with
  `scanning={scanning}` and `canSave={!!project}`.
- The header now reads: File menu, the disc-title label
  (`{#if model?.disc.title}`), the **Build...** button (still
  `{#if project}` + `disabled={!canBuild}`), and the progress span.
- The ISO help panel, encrypted banner, DetailPanel, and the three columns are
  unchanged.

## Data flow

Unchanged from today, only relocated: the File menu items invoke the same
`openAndScan`/`pickAndOpen`/`saveProject`/ISO-toggle handlers that the header
buttons invoke now. The Build modal owns title/mode/preserve editing.

## Error handling

- No behavior change to the open/save flows; the same result handling
  (progress line, error strings) applies.
- The dialog-parenting fix degrades gracefully: if `BrowserWindow.fromWebContents`
  returns null (no window), the no-parent dialog form is used, exactly as today.
- Menu open/close is inert with respect to the build/scan state; scan-gated
  items are disabled, not hidden.

## Testing

- **Renderer (vitest, jsdom):** `FileMenu.svelte` - the open items render and
  each fires its callback and closes the menu on click; **Save project...** is
  absent when `canSave` is false and present when true; the folder/zip items are
  disabled when `scanning` is true; Escape and an outside click close the menu.
  svelte-check stays 0 errors / 0 warnings.
- **Main:** the dialog-parenting change is not unit-tested (dialog surfacing is
  an OS/runtime concern and the existing dialog handlers have no unit tests);
  it is covered by `npm run build` (compiles) and the real-disc walkthrough.
- Full electron + renderer suites stay green.

## Validation

Against the real Blade Runner 2049 disc (`/mnt/br`): the header shows a **File**
menu, the disc title, and **Build...**; the File menu opens folder/ZIP/ISO/
project and (with a project) save, each behaving as the old buttons did; the
title/mode/preserve controls are gone from the header and still editable in the
Build modal; and clicking **Choose...** in the Build modal now opens the folder
dialog in front of the window and returns the chosen path.
