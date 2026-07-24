# Disc input formats for the mkv-editions workbench

Widen the workbench's front door from "a BDMV folder" to three input types: a
ripped-disc folder, an ISO disc image, and a ZIP archive. Everything downstream
of a resolved `BDMV` path - the scan, the disc model, authoring, the build
contract - is unchanged. This spec covers only how a user selection becomes a
`BDMV` directory to hand the existing `gen-editions.py --scan-json` scan.

Builds on [[electron-workbench-plan]] Increment 1 (merged 4d7a49b). The app lives
in `app/`: Electron shell (`app/electron/`, tsup CJS) + SvelteKit adapter-static
renderer (`app/renderer/`).

## Scope

- Three input types resolve to a `BDMV` directory:
  - **Folder** - a ripped disc on disk. Already supported; hardened here so the
    user may pick the `BDMV` directory, the disc root containing it, or a folder
    one level up.
  - **ZIP** - a zip of a disc. Extracted to a temp working dir, then resolved.
  - **ISO** - a disc image. NOT mounted by the app. The app expects a
    pre-mounted path: it shows the exact mount command, and the user then opens
    the mount with "Open folder...". ISO support is guidance plus the folder flow.
- One main-process resolver feeds the unchanged scan IPC.

## Non-goals

- The app does not mount ISOs (no `sudo`/`pkexec`/`udisksctl` from the app). ISO
  mounting is the user's step; the app only guides it.
- No decryption. An AACS-encrypted image is out of scope; the app detects and
  reports the "unreadable clips" symptom rather than handling it.
- No extraction caching / dedup by hash (each ZIP open extracts fresh).
- No change to the disc model, slots, authoring, `.mkvedproj` contract, or the
  Python CLI.

## The core constraint

`ffprobe` and `mkvmerge` read `.m2ts` files from a real filesystem path; they
cannot read inside an ISO or ZIP. A folder already provides that path. An ISO
must be loop-mounted (needs privilege, so it is the user's step). A ZIP must be
extracted. Every input therefore resolves to an on-disk `BDMV` directory before
the existing scan runs.

## Architecture

One main-process resolver, fed by two helpers, producing the `BDMV` path the
existing `scanDisc` IPC already consumes. Nothing downstream changes.

```
renderer entry points          main process                     unchanged
  Open folder... ----\
  Open ZIP...    ------> resolveInput(selection) --> bdmvPath --> scanDisc(bdmvPath)
  Open ISO(help)       /   |            |                          (Increment 1)
   (no resolve)       /    findBdmv     extractZip
```

## Components

All three new units live in the main process (`app/electron/`), are pure Node,
and are unit-tested in isolation.

### `findBdmv(rootDir) -> string | null`

Given any directory (a folder pick, a ZIP extraction root, or an ISO mount
point), return the directory that contains `PLAYLIST/*.mpls` - the value to pass
`gen-editions.py` as `<BDMV>`, or null if none is found. Search order:

1. `rootDir` itself (does `rootDir/PLAYLIST/*.mpls` exist?).
2. `rootDir/BDMV`.
3. One nested level: any immediate child `C` where `C/BDMV/PLAYLIST/*.mpls` or
   `C/PLAYLIST/*.mpls` exists (covers a `DiscName/BDMV/...` zip layout).

The presence test is `PLAYLIST` containing at least one `.mpls`. This also fixes
the Increment-1 gotcha where a user picks the disc root instead of `BDMV/`.

### `extractZip(zipPath, destDir, onProgress) -> Promise<string>`

Spawn `7z x` (preferred) or `unzip` into `destDir` (a fresh temp dir under the OS
temp dir), streaming progress to `onProgress` (same event shape as scan
progress: `{done, total}` where available, else indeterminate). Resolves to
`destDir`. Rejects with the tool's stderr on failure; the caller cleans up a
failed `destDir`. Requires `7z` or `unzip` on PATH (checked before extraction).

### `resolveInput(selection, onProgress) -> Promise<Result>`

`Result = { ok: true, bdmvPath: string } | { ok: false, error: string }`.
`selection` is `{ kind: 'folder', path }` or `{ kind: 'zip', path }`.

- `folder`: `findBdmv(path)`; error if null.
- `zip`: check for a zip tool; `extractZip` into a tracked temp dir; then
  `findBdmv(extractRoot)`; error if null. Track the temp dir for cleanup.

ISO is never passed to `resolveInput`; the renderer handles it as guidance.

### Renderer entry points and IPC

Three affordances in the workbench header, because a directory picker and a file
picker are different Electron dialogs that cannot be cleanly combined on Linux:

- **Open folder...** - `showOpenDialog({properties:['openDirectory']})` (the
  existing `pickBdmv`, renamed), then `resolveInput({kind:'folder'})`.
- **Open ZIP...** - `showOpenDialog({properties:['openFile'], filters:[{name:'zip',
  extensions:['zip']}]})`, then `resolveInput({kind:'zip'})` with an extraction
  progress bar.
- **Open ISO... (help)** - shows the mount one-liner (e.g.
  `sudo mount -o loop,ro <file.iso> /mnt/disc`, and the `udisksctl loop-setup`
  alternative), instructing the user to then use "Open folder..." on the mount.
  No IPC beyond displaying text.

IPC: a single `openInput(kind)` handler that runs the dialog + `resolveInput` and
returns `{ok, bdmvPath}` or `{ok:false, error}`, plus `extract:progress` events
during a ZIP extraction. On success the renderer calls the existing
`window.api.scanDisc(bdmvPath)` - the Increment-1 flow, unchanged.

## Data flow

1. User clicks an entry point.
2. Main shows the matching dialog; user picks a folder or a `.zip`.
3. `resolveInput`: folder -> `findBdmv`; zip -> `extractZip` (progress) ->
   `findBdmv`.
4. On `{ok, bdmvPath}`, the renderer calls the existing `scanDisc(bdmvPath)` and
   the rest of the workbench proceeds exactly as in Increment 1.
5. ISO: the user mounts externally per the shown command, then uses
   "Open folder..." on the mount point - step 2 onward with no new code.

## Error handling

- **No BDMV found** - `findBdmv` null -> `{ok:false, error:"No BDMV/PLAYLIST
  found under <path>"}`, shown in the status line. Covers an empty/wrong folder
  or a zip of the wrong content.
- **Missing zip tool** - if neither `7z` nor `unzip` is on PATH, "Open ZIP..."
  fails fast with an install hint, mirroring `mkv-editions.sh`'s dep-check style.
  Checked before extraction begins.
- **Extraction failure** (corrupt zip, disk full) - surface the tool's stderr
  verbatim; remove the partial extraction dir; `{ok:false, error}`.
- **Encrypted / undecrypted image** - not a resolve error (structure is intact,
  so discovery succeeds); it surfaces at scan time. The existing scan already
  flags zero-track clips as unreadable. Add a renderer heuristic banner: if more
  than 50% of referenced clips are unreadable, show "Most clips unreadable - this
  image may be AACS-encrypted or not decrypted." Reuses the model's per-clip
  `tracks` data; one threshold, no new scan work.
- **Temp cleanup** - extracted dirs are tracked in main and removed on app
  `quit`. Each ZIP open extracts fresh (no caching this increment). A crash may
  leave a stale OS-temp dir; acceptable, no cache-manager now.

## Testing

- **`findBdmv`** (node-env vitest, pure fs) - synthetic trees built with
  `mkdtemp`: `PLAYLIST` at root; `root/BDMV/PLAYLIST`; nested
  `root/DiscName/BDMV/PLAYLIST`; and none -> null.
- **`extractZip`** (node-env, real tool) - zip the synthetic sample BDMV (from
  `samples/make-sample.py`), extract via the module, assert `findBdmv` locates it
  and progress fired; skip-guard when no zip tool is present.
- **`resolveInput`** - folder and zipped-sample cases both resolve to a
  `findBdmv`-valid path.
- **Encrypted-banner heuristic** (renderer, jsdom) - a model whose referenced
  clips are mostly zero-track shows the banner; a healthy model does not.
- **Missing-tool path** - `resolveInput({kind:'zip'})` returns the dep error when
  the tool check is injected as absent.
- **ISO guidance** - one assertion that the help text contains the mount command.

## Validation

Against the real Blade Runner 2049 disc already available: (1) zip the mounted
`BDMV` (or a subset) and confirm "Open ZIP..." extracts, discovers the BDMV, and
scans to the same model as the mounted folder; (2) confirm "Open folder..." on
the disc root (the parent of `BDMV/`) now resolves, not just on `BDMV/` itself;
(3) confirm the ISO help shows the working mount command and the folder flow on
the mount behaves as in Increment 1. The synthetic sample remains the automated
baseline; a zipped copy of it exercises the extraction path in CI-style tests.
