# Build modal: settings confirmation + live output

Replace the one-shot Build flow with an in-renderer **Build modal**: a single
cockpit where you confirm and edit the build settings, see which output files
would be overwritten, press Start, and watch the live build log + progress.

Builds on the in-app Build baseline (same `descriptive-metadata` branch): the
main-process orchestration in `app/electron/build.ts` (`expectedOutputs`,
`spawnOnce`, the temp `.mkvedproj` lifecycle) is reused and split into a
preflight and a run; the native folder picker stays; the native overwrite
confirm dialog is removed (its job moves into the modal). The Python CLI
(`src/gen-editions.py`), `build.sh` generation, and the `.mkvedproj` contract
are UNCHANGED.

## Scope

- **Split the orchestration** into a preflight (`buildInspect`: generate
  `build.sh`, compute expected outputs + collisions, no muxing) and a run
  (`buildRun`: mux via `build.sh`, streaming a log channel and a percent
  channel).
- **New IPC**: `buildPickFolder`, `buildInspect`, `buildRun`, plus a new
  `build:log` event channel alongside `build:progress`.
- **New UI**: `BuildModal.svelte` with editable settings, an output-folder
  picker, an inline collision warning + overwrite checkbox, a Start button, a
  live auto-scrolling log pane, a progress bar, and a result line. The header
  **Build...** button just opens the modal.

## Non-goals

- No change to `gen-editions.py`, `build.sh`, or the `.mkvedproj` contract.
- No auto-suffix / no-overwrite renaming (that would need CLI naming logic).
- No build queue or multi-project batch; one build at a time.
- No cancel-mid-build (the Start-to-finish run is not interruptible in this
  iteration; Close is disabled while running).

## Architecture

The renderer never touches the filesystem or spawns processes; all of that
stays in `app/electron/build.ts`. The modal is a pure Svelte component driven
by `window.api` calls and two event channels. The one behavioral shift from the
baseline: instead of a single `buildProject` that folder-picks, gates, and muxes
in one call, the flow is three renderer-driven steps (pick -> inspect -> run) so
the modal can show collisions and stream output before and during the mux.

### Main process (`app/electron/build.ts` + `main.ts` + `preload.ts`)

Reused unchanged from the baseline: `expectedOutputs`, `unshellFirst`,
`spawnOnce`, `resolveCli`, `feedPercents`.

New/changed functions in `build.ts`:

- `inspectBuild(json: unknown, outdir: string, deps?): Promise<InspectResult>`
  where `InspectResult = { ok: true; outputs: string[]; existing: string[] } |
  { ok: false; error: string }`. Writes a temp `.mkvedproj`, runs
  `python3 gen-editions.py --project <temp> <tmpGenDir>` into a THROWAWAY temp
  dir (never the real outdir, so nothing is written to the user's folder during
  inspection), reads `<tmpGenDir>/build.sh`, computes `expectedOutputs`, and sets
  `existing` to the subset of those names that already exist in the real
  `outdir`. The temp project and temp gen dir are always removed in a `finally`.
- `runBuild(json, outdir, overwrite: boolean, onProgress, onLog, deps?):
  Promise<BuildResult>` - the baseline `runBuild` restructured: the
  `confirmOverwrite` callback parameter is replaced by an `overwrite` boolean and
  a new `onLog: (line: string) => void`. It generates `build.sh` into the real
  `outdir`, computes `existing`; if `existing.length && !overwrite` it returns
  `{ ok: false, error: 'overwrite-declined' }` without muxing; otherwise it runs
  `bash build.sh` in `outdir`, feeding stdout to BOTH `feedPercents` (percent)
  and a line splitter (each complete line -> `onLog`), and stderr lines -> `onLog`
  too. Success -> `{ ok: true, outputs }`; nonzero/ spawn error -> `{ ok: false,
  error }`. Temp project cleaned in `finally`. `BuildResult`/`BuildProgress`
  types are unchanged; add `interface BuildLog { line: string }`.
- `createBuilder` is removed (the folder-pick + confirm orchestration it wrapped
  is now the renderer's three-step flow). The old `buildProject` IPC handler is
  removed with it.

New IPC handlers in `main.ts`:

- `buildPickFolder` -> `dialog.showOpenDialog({ properties: ['openDirectory'],
  defaultPath: <lastDir> })`; returns the chosen path or `null`; remembers
  `lastDir` in a main-scoped variable.
- `buildInspect` -> `inspectBuild(json, outdir)`.
- `buildRun` -> `runBuild(json, outdir, overwrite, (p) =>
  event.sender.send('build:progress', p), (line) =>
  event.sender.send('build:log', { line }))`.

The native `dialog.showMessageBox` overwrite confirm is deleted.

### Preload (`preload.ts`)

- `buildPickFolder: () => ipcRenderer.invoke('buildPickFolder')`
- `buildInspect: (json, outdir) => ipcRenderer.invoke('buildInspect', json, outdir)`
- `buildRun: (json, outdir, overwrite) => ipcRenderer.invoke('buildRun', json, outdir, overwrite)`
- `onBuildProgress` (unchanged, channel `build:progress`)
- `onBuildLog: (cb) => { ... }` on channel `build:log`, following the same
  subscribe/unsubscribe pattern.

The old `buildProject`/its api entry is removed.

### Renderer (`app.d.ts`, `+page.svelte`, `BuildModal.svelte`)

- `app.d.ts`: replace the `buildProject` member; add `InspectResult`,
  `BuildLog`, and the `ElectronApi` members `buildPickFolder`, `buildInspect`,
  `buildRun`, `onBuildLog`.
- `+page.svelte`: the header **Build...** button (still gated on
  `hasBuildableEdition`) now toggles `showBuild = true` and renders
  `<BuildModal ... />` when open; the `buildMovie` handler and its progress
  status-line usage are removed (the modal owns all of that).
- `BuildModal.svelte` (new): props `{ project: Project; onclose: () => void }`.
  Owns: the editable settings (`bind:` to a copy of the project or the live
  project - see below), the output-folder path, the inspect result, an
  `overwrite` checkbox, a `running`/`done`/`error` state, an accumulated log
  string, and the current percent.

## The modal

Layout (single column, scrolls on overflow, ~560px wide):

- **Settings**: output name (text, the project `title`), mode (flat/linked/xin1
  radio or select), preserve-chapters + qpfile checkboxes. These `bind:` to the
  live `project` so edits persist after closing (consistent with the header
  controls, which stay).
- **Output folder**: a read-only path display + a **Choose...** button that
  calls `buildPickFolder`. On a chosen folder (and whenever a setting that
  affects filenames changes, i.e. title/mode), the modal calls `buildInspect`
  and stores `{ outputs, existing }`.
- **Collision warning**: when `existing.length > 0`, an inline warning lists the
  names and an **Overwrite existing files** checkbox appears; `overwrite`
  defaults false.
- **Progress + log**: a percent bar (from `build:progress`) and an
  auto-scrolling `<pre>` log pane (accumulated `build:log` lines). Hidden until
  Start is pressed.
- **Actions**: **Start** (primary) and **Close**. Start is enabled iff: a folder
  is chosen, the project is buildable (`hasBuildableEdition`), no run is in
  progress, the inspect succeeded, and (`existing.length === 0` OR `overwrite`).
  Start subscribes to `onBuildProgress` + `onBuildLog`, calls `buildRun(json,
  folder, overwrite)`, and on resolve shows the success (output count + folder)
  or the error line; it always unsubscribes and clears `running` in a `finally`,
  and catches a rejection into the error line. Close calls `onclose` and is
  disabled while `running`.

## Data flow

1. Header **Build...** (enabled by `hasBuildableEdition`) opens the modal.
2. User edits settings (bound to `project`) and clicks **Choose...** ->
   `buildPickFolder` -> folder path (or null -> no-op).
3. Modal calls `buildInspect(toMkvedproj(project), folder)` -> `{ outputs,
   existing }`; shows outputs, and if `existing` non-empty the warning +
   overwrite checkbox. Re-runs on a title/mode change while a folder is set.
4. **Start** -> subscribe to `build:progress` + `build:log` -> `buildRun(
   toMkvedproj(project), folder, overwrite)`; the log pane fills, the bar
   advances.
5. On resolve: `{ ok: true, outputs }` -> "Built N file(s) in <folder>";
   `{ ok: false, error }` -> "Build failed: <error>" (the tail is already in the
   log). Unsubscribe + clear `running` in `finally`.

## Error handling

- Not buildable / no folder / inspect failed / collisions unconfirmed -> Start
  disabled (with the inspect error shown when relevant).
- `buildPickFolder` cancel -> no-op.
- `buildInspect` failure (bad project, gen-editions nonzero, missing python) ->
  `{ ok: false, error }`; the modal shows the reason and leaves Start disabled.
- `buildRun` failure (mux error, missing mkvmerge/bash) -> `{ ok: false, error }`
  rendered as the error line, with stderr already streamed into the log; never a
  hang (spawn `error` resolves an error result).
- `overwrite` false with collisions is doubly guarded: Start is disabled in the
  modal, and `runBuild` itself returns `{ ok: false, error: 'overwrite-declined' }`.
- All temp files/dirs (the inspect temp project + temp gen dir, the run temp
  project) are removed in a `finally` on every path.
- Close is disabled while `running` so a build cannot be orphaned by closing the
  modal.

## Testing

- **Main (vitest, node):**
  - `inspectBuild` with a stubbed spawn + real temp dirs: a pre-written
    `build.sh` in the temp gen dir yields the expected `outputs`; `existing`
    reflects files pre-created in the real outdir; a nonzero gen exit ->
    `{ ok: false, error }`; temp dirs removed.
  - `runBuild` (restructured): streams `onLog` lines (fake spawn emits log +
    `Progress: NN%` lines) and resolves `{ ok: true, outputs }`; `overwrite`
    false with a colliding pre-created file -> `{ ok: false, error:
    'overwrite-declined' }` without running `bash`; gen nonzero -> error; spawn
    error -> error; temp cleaned.
- **Renderer (vitest, jsdom):**
  - Start-enabled logic as a pure helper `canStartBuild({ folder, buildable,
    running, inspected, existingCount, overwrite })` (unit-tested truth table).
  - `BuildModal` renders the collision warning + overwrite checkbox when
    `existing` is non-empty and hides them otherwise; log lines render in the
    pane; Start disabled until the gate passes.
  - svelte-check stays 0 errors / 0 warnings.

## Validation

Against the real Blade Runner 2049 disc (`/mnt/br`): open the modal, confirm the
settings reflect the project, Choose an output folder, see the expected
`.mkv` name(s), press Start and watch mkvmerge log lines stream with the bar
advancing to a playable file; re-open, pick the same folder, see the collision
warning and the disabled Start until Overwrite is ticked; trigger a failure
(e.g. an unwritable folder) and confirm the error line + log tail, no hang.
