# In-app Build/Export + edition delete

Add a one-click **Build...** action to the workbench that muxes the editioned
MKV(s) from the current project, with progress and error reporting, so a user
never has to drop to the CLI. Plus a small companion: surface the already
existing `removeEdition()` as a delete control on each edition.

Builds on [[electron-workbench-plan]] Increments 1-2 and the descriptive
metadata feature (same `descriptive-metadata` branch). The app is in `app/`:
Electron shell (`app/electron/`, tsup CJS) + SvelteKit adapter-static renderer
(`app/renderer/`). The Python CLI (`src/gen-editions.py`) owns disc parsing and
muxing; it is unchanged by this feature.

## Scope

- **New IPC + main orchestration**: a `buildProject` handler that turns the
  live in-memory project into an editioned MKV by running the existing CLI.
- **New UI**: a header **Build...** button, gated on the project having at
  least one edition that contains at least one clip; progress in the status
  line; a success or error result.
- **Edition delete**: an `x` control on each edition header wired to the
  existing `removeEdition(p, i)` model function.

## Non-goals

- No change to `gen-editions.py`, `build.sh` generation, or the `.mkvedproj`
  contract. The CLI two-step (`--project` -> `build.sh` -> mkvmerge) stays the
  single muxing authority; this feature only drives it.
- No in-app track/edition editing beyond delete (authoring is unchanged).
- No queue / batch of multiple projects; one project builds at a time.
- No re-encode or transcode; muxing only (what mkvmerge does today).

## Approach

Main-process orchestration with **two spawns** (chosen over a new Python
`--run` flag or a TS reimplementation of mkvmerge, both of which would diverge
from or duplicate the hardened CLI path):

1. Run `python3 gen-editions.py --project <temp.mkvedproj> <outdir>` to
   generate `build.sh` (plus `chapters.xml`, `tags.xml`, `qpfile`). No MKV is
   produced by this step.
2. Run `bash build.sh` in `<outdir>`; mkvmerge produces the MKV(s).

The security-hardened `build.sh` (control-char / traversal rejection at
`load_project`, `shlex.quote` on interpolated values) remains the only thing
that invokes mkvmerge; the app never constructs mkvmerge arguments itself.

## Data flow

1. Renderer calls `window.api.buildProject(json)` where `json` is
   `toMkvedproj(project)` (the same shape `saveProject` sends).
2. Main opens the **native folder picker** for the output directory. Cancel ->
   the call resolves `null` (no-op). The chosen directory is remembered as the
   default for the next build (in-memory in main; not persisted to disk).
3. Main writes `json` to a temp file `mkved-build-<n>.mkvedproj` under
   `os.tmpdir()`.
4. Main spawns `python3 <repo>/src/gen-editions.py --project <temp> <outdir>`.
   Nonzero exit -> `{ ok: false, error: <stderr> }` (temp cleaned).
5. Main reads the generated `<outdir>/build.sh`, extracts the target output
   filenames (the `-o <name>` targets), and stats `<outdir>` for collisions.
6. If any target already exists, main shows a **native confirm dialog**
   (`dialog.showMessageBox`, buttons Overwrite / Cancel) listing the colliding
   names. Cancel -> `{ ok: false, error: 'cancelled' }`, temp cleaned,
   `build.sh` left in place harmlessly. (This is distinct from cancelling the
   folder picker in step 2, which resolves `null` as a silent no-op: the folder
   cancel happens before any work, the overwrite cancel after generation.)
7. On confirm (or no collisions) main spawns `bash <outdir>/build.sh` with cwd
   `<outdir>`, parsing mkvmerge `Progress: NN%` lines and emitting
   `build:progress` events `{ percent }` (overall mkvmerge percent; per-output
   attribution is not reliable from the aggregate `bash build.sh` stdout).
   Reuses the `feedPercents` percent-parser from the ZIP-extract path (no
   re-emission bug).
8. Success -> `{ ok: true, outputs: [<absolute mkv paths>] }`. Failure of
   `build.sh` / mkvmerge -> `{ ok: false, error: <stderr tail> }`. The temp
   `.mkvedproj` is removed in a `finally` in every path.

## Components

### Electron main (`app/electron/build.ts`, new)

- `buildProject(json: unknown): Promise<BuildResult>` registered as the
  `buildProject` IPC handler in the main entry (beside `scan`, `openInput`,
  `saveProject`).
- `BuildResult = { ok: true; outputs: string[] } | { ok: false; error: string }
  | null` (null when the folder picker is cancelled).
- Helper `expectedOutputs(buildShText: string): string[]` - parse the `-o`
  targets from the generated `build.sh` so the overwrite check and the returned
  `outputs` are exact (not re-derived from title/mode).
- Progress: a small stdout line-buffer feeding `feedPercents`; emits on the
  `build:progress` channel to the focused window.
- All spawns use argument arrays (no shell string interpolation) except the
  intentional `bash build.sh` invocation, whose contents are the hardened
  generated script.

### Preload (`app/electron/preload.ts`)

- `buildProject: (json) => ipcRenderer.invoke('buildProject', json)`
- `onBuildProgress: (cb) => { ... }` mirroring `onScanProgress` /
  `onExtractProgress` (returns an unsubscribe function).

### Renderer

- `app/renderer/src/routes/+page.svelte`: a **Build...** button in the header,
  next to **Save project...**. Enabled only when
  `project` has at least one edition with a non-empty `clips` array (a derived
  `canBuild`). onclick: set a building flag, subscribe to `onBuildProgress`
  (feeding the existing `progress` status line), call `buildProject`, then show
  the result: on `ok` a short "built N file(s)" with the output folder; on
  error the message; on `null` (cancel) nothing. Always unsubscribe and clear
  the building flag in a `finally`; the button is disabled while building.
- `app/renderer/src/lib/components/EditionTracks.svelte`: add
  `ondelete?: (editionIdx: number) => void` to props; render a small `x`
  button on the edition header (beside the name input) that calls
  `e.stopPropagation()` then `ondelete(i)`. A targeted
  `<!-- svelte-ignore ... -->` only if a new warning appears.
- `+page.svelte` wires `ondelete={(i) => apply((p) => removeEdition(p, i))}`
  and imports `removeEdition` from `$lib/project`.

## Error handling

- No editions, or no edition with clips -> Build button disabled (`canBuild`
  false); a main-side guard also rejects with a clear error if called anyway.
- Folder-pick cancelled -> resolve `null`, no status change.
- `gen-editions.py` nonzero exit (invalid project, or source `.m2ts` clips
  missing because the disc/mount is gone) -> `{ ok: false, error }` carrying
  stderr; the panel shows it.
- `build.sh` / mkvmerge failure -> `{ ok: false, error }` with the stderr tail.
- `python3` or `mkvmerge` not on PATH -> the spawn error is surfaced as a clear
  `error` string, not a silent hang.
- Overwrite dialog Cancel -> `{ ok: false, error: 'cancelled' }`; nothing is
  muxed.
- The temp `.mkvedproj` is always removed (a `finally`), including on every
  error branch.
- Deleting an edition is always safe: `removeEdition` may leave zero editions
  (the CLI already tolerates and builds nothing); no special guard needed.

## Testing

- **Main (vitest, node):** `buildProject` orchestration with a stubbed
  `child_process.spawn` and stubbed `dialog` (folder picker + message box),
  asserting: the temp `.mkvedproj` is written with the passed json and removed
  afterward; the chosen `outdir` is passed to `gen-editions.py`; `expectedOutputs`
  parses `-o` targets from a sample `build.sh`; a name collision triggers the
  confirm dialog and Cancel yields no `build.sh` run; a clean run resolves
  `{ ok: true, outputs }`; a nonzero `gen-editions.py` exit resolves
  `{ ok: false, error }`. `expectedOutputs` is also unit-tested directly.
- **Renderer (vitest, jsdom):** the Build button is disabled when the project
  has no editions or no clips and enabled otherwise (`canBuild`); the
  edition-delete `x` calls `ondelete` with the edition index and does not
  trigger selection (stopPropagation). svelte-check stays 0 errors / 0
  warnings.
- **CLI:** unchanged; no new tests.

## Validation

Against the real Blade Runner 2049 disc (mounted at `/mnt/br`): scan, arrange a
small edition, click **Build...**, choose an output folder, and confirm a
playable `.mkv` is produced with the editions present (mkvmerge `--edition`
grouping); re-building into the same folder shows the overwrite confirm; delete
an edition and confirm the card disappears and a subsequent build omits it. The
synthetic sample remains the automated baseline for the orchestration tests.
