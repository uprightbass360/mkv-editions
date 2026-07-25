# Undo / redo / revert

Give the workbench a history: step-wise Undo and Redo over every project edit,
plus a one-shot Revert to the freshly-scanned baseline. The app already routes
edits through pure `Project` transforms, so history is a stack of `Project`
snapshots; the one prerequisite is making the last in-place edits (the Build
modal settings) immutable too.

Builds on the current `descriptive-metadata` branch. The renderer is
`app/renderer/`; the Python CLI and `.mkvedproj` contract are UNCHANGED.

## Scope

- **Undo/Redo** over ALL project edits: add/remove/rename/reorder editions and
  clips, import playlist, track include/exclude, and the settings (output name,
  mode, preserve-chapters, qpfile).
- **Revert** to the scan baseline (the initial project for the loaded disc /
  opened file), discarding all edits at once, itself undoable.
- **Controls**: keyboard shortcuts + File-menu items with disabled states.
- **Prerequisite**: convert the Build modal's four settings from two-way `bind:`
  to `onchange`-driven edits through the same history path, so every edit is an
  immutable `Project` transform and snapshots can be plain references.

## Non-goals

- No persistence of history across app restarts (in-memory only).
- No per-field / partial undo of a single text edit (a rename is one step).
- No branching history or named checkpoints.
- No change to save/build, the CLI, or the `.mkvedproj` contract.

## Model

### History module (`app/renderer/src/lib/history.ts`, new, pure)

```ts
export interface History<T> { past: T[]; future: T[] }
export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] })
export function record<T>(h: History<T>, current: T, cap = 100): History<T>
  // -> { past: [...h.past, current].slice(-cap), future: [] }
export function undo<T>(h: History<T>, current: T): { history: History<T>; value: T } | null
  // null when h.past is empty; else pop past -> value, push current onto future
export function redo<T>(h: History<T>, current: T): { history: History<T>; value: T } | null
  // null when h.future is empty; else shift future -> value, push current onto past
```

These are the only place the stack arithmetic lives; they are pure and unit
tested. `T` is `Project` in use.

### State + operations (`+page.svelte`)

- `let history = $state(emptyHistory<Project>())`
- `let baseline = $state<Project | null>(null)`
- `let canUndo = $derived(history.past.length > 0)`
- `let canRedo = $derived(history.future.length > 0)`
- `let canRevert = $derived(!!baseline && !!project && !sameProject(project, baseline))`
  where `sameProject(a, b)` is a content compare (JSON.stringify equality is
  sufficient for this plain-data object).
- `apply(fn)` becomes history-aware: `if (!project) return; history = record(history, project); project = fn(project)`. This is the single edit gate; every existing `apply((p) => ...)` call site is unchanged and now records automatically.
- `undo()`: `const r = undo(history, project); if (r) { history = r.history; project = r.value }`.
- `redo()`: symmetric with `redo(...)`.
- `revert()`: `if (!baseline || !project) return; history = record(history, project); project = baseline`.
- Baseline + reset on load: in `scanInto`, right after the initial project is
  built (`project = p`), set `baseline = p` and `history = emptyHistory()`. In
  `pickAndOpen`, after `project = fromMkvedproj(...)`, set `baseline = project`
  and `history = emptyHistory()`. (These replace no existing behavior; they add
  the baseline/reset.)

Because `apply` and `fn` return NEW `Project` objects and `baseline` holds the
initial reference, every snapshot in `past`/`future` and the `baseline` are
immutable; undo/redo/revert restore by reference with no cloning.

## Making all edits immutable (the prerequisite)

Today the Build modal binds four fields two-way to the live project
(`bind:value={project.title}`, `bind:value={project.mode}`,
`bind:checked={project.preserve_chapters}`, `bind:checked={project.qpfile}`),
mutating the project in place and bypassing `apply`. Replace each with a
one-way value + an `onchange` that routes through a new `onedit` prop:

- `BuildModal.svelte` gains a prop `onedit: (fn: (p: Project) => Project) => void`.
- Output name: `value={project.title}` + `onchange={(e) => onedit((p) => ({ ...p, title: (e.target as HTMLInputElement).value }))}`.
- Mode: `value={project.mode}` + `onchange={(e) => onedit((p) => ({ ...p, mode: (e.target as HTMLSelectElement).value as Project['mode'] }))}`.
- Preserve / qpfile: `checked={project.preserve_chapters}` /
  `checked={project.qpfile}` + `onchange` toggling via `onedit`.
- `+page.svelte` passes `onedit={apply}` to `BuildModal`.

Re-inspect on filename-affecting changes stays: drive the collision re-inspect
from a reactive `$effect` keyed on `project.title` + `project.mode` (and the
chosen folder) rather than from the old `bind:`-side `onSettingChange`, so it
recomputes after the immutable update propagates. Preserve/qpfile do not affect
output filenames and do not trigger a re-inspect.

## UX

### Keyboard (in `+page.svelte`, a `$effect` registering a window `keydown`)

- Ctrl/Cmd+Z -> undo; Ctrl/Cmd+Shift+Z or Ctrl+Y -> redo.
- Ignored when the active element is an editable field (`input`, `textarea`,
  `select`, or `isContentEditable`), so in-field typing/native undo is not
  hijacked. `preventDefault` only when we handle it.
- The listener is removed in the effect cleanup.

### File menu (`FileMenu.svelte`)

Add, above the existing open/save items (a separated group):

- **Undo** - disabled unless `canUndo`; calls `onUndo`.
- **Redo** - disabled unless `canRedo`; calls `onRedo`.
- **Revert** - disabled unless `canRevert`; calls `onRevert`.

`FileMenu` gains props `onUndo`, `onRedo`, `onRevert`, `canUndo`, `canRedo`,
`canRevert` (all callback/flag, consistent with the existing prop style). Items
still close the menu on select. `+page.svelte` wires them to the operations and
derived flags.

## Error handling / edge cases

- No project loaded -> `canUndo`/`canRedo`/`canRevert` false; shortcuts no-op.
- Redo stack cleared on any new edit (including revert).
- History capped at 100 (oldest dropped); Project snapshots are small plain data.
- A new scan or opened project resets history and baseline; you cannot undo
  across a disc load (a fresh editing context).
- Revert is recorded like any edit, so Undo restores the pre-revert state.
- Save/build read the live `project` unchanged; history is renderer-only state.

## Testing

- **history.ts (vitest):** `record` pushes current and clears future and honors
  the cap; `undo`/`redo` move values across the stacks and return null at the
  ends; a `record` after an `undo` drops the redo future; a round trip
  (record x3 -> undo x2 -> redo x1) lands on the expected values.
- **FileMenu (vitest):** Undo/Redo/Revert render, are disabled per the
  `canUndo`/`canRedo`/`canRevert` flags, and fire their callbacks on click.
- **BuildModal (vitest):** the settings fire `onedit` with the right transform
  (e.g. changing the output name calls `onedit` producing a project with the new
  title) and no longer rely on two-way `bind:`.
- **Renderer/build:** svelte-check 0/0; the keyboard listener and `+page`
  wiring covered by `npm run build` + the real-app check.

## Validation

In the running app: make several edits (add an edition, drag-reorder clips,
toggle a track, rename the output), then Ctrl+Z repeatedly to step back and
Ctrl+Shift+Z to step forward; confirm the File menu's Undo/Redo/Revert enable
and disable correctly; Revert jumps to the freshly-scanned baseline and a single
Undo brings the edits back; loading a different disc clears the history.
