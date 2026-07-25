# Packaging the workbench (electron-builder)

> Status: design APPROVED 2026-07-25. Implementation DEFERRED - the current
> deployment is "pull the source and run `./run-app.sh`" (repo/dev mode), which
> already works because `resolveCli()` finds `src/gen-editions.py` by walking up
> the repo tree. This spec is the ready-to-build plan for when a distributable
> package is wanted.

## Problem

The app shells out to the Python CLI (`src/gen-editions.py`) and to system
tools (`python3`, `mkvmerge`, `ffprobe`). It only works from a repo checkout:
`resolveCli()` (in `app/electron/cli.ts`) locates the script by walking up from
`__dirname` until it finds `src/gen-editions.py`. `src/` is a SIBLING of `app/`,
so a package built from `app/` does not include it - `resolveCli()` throws, and
Build silently shows 0% with no output/files. There is also no packaging config
in the repo.

## Decisions

- **Packager: electron-builder** (config in `app/package.json`, Linux AppImage
  target to start).
- **System tools required on the target** (not bundled): `python3` (stdlib
  only), `mkvmerge` (mkvtoolnix), `ffprobe` (ffmpeg). The app bundles only the
  Python script and shows a clear "X not found - install Y" error if one is
  missing.

## Components

### Bundle the CLI (electron-builder `extraResources`)

`gen-editions.py` is a single self-contained stdlib script, so bundle just that
one file:

```jsonc
// app/package.json "build"
"extraResources": [{ "from": "../src/gen-editions.py", "to": "cli/gen-editions.py" }]
```

This places it at `process.resourcesPath/cli/gen-editions.py` in the package.

### `resolveCli()` packaged-aware (`app/electron/cli.ts`)

Check the bundled location first via `process.resourcesPath` (available on the
Electron main `process` WITHOUT importing `app` from 'electron', so `cli.ts`
stays importable in the plain-node vitest tests), then fall back to the repo
walk-up for dev:

```ts
export function resolveCli(): CliPaths {
  const python = process.env.MKVED_PYTHON || 'python3'
  const rp = process.resourcesPath
  if (rp) {
    const bundled = join(rp, 'cli', 'gen-editions.py')
    if (existsSync(bundled)) return { python, script: bundled, repoRoot: dirname(dirname(bundled)) }
  }
  // dev: walk up to the repo's src/gen-editions.py
  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    const script = join(dir, 'src', 'gen-editions.py')
    if (existsSync(script)) return { python, script, repoRoot: dir }
    const up = dirname(dir); if (up === dir) break; dir = up
  }
  throw new Error('could not locate gen-editions.py (bundled or in a repo checkout)')
}
```

In plain node (vitest) `process.resourcesPath` is undefined, so the bundled
branch is skipped and the dev walk-up runs - existing `cli.test.ts` still
passes; add a test that sets `process.resourcesPath` to a temp dir containing
`cli/gen-editions.py` and asserts it is found.

### Legible missing-tool errors (`app/electron/build.ts`)

Map spawn `ENOENT` and gen-editions failures to a clear message so a missing
tool never looks like a hang: e.g. a spawn error containing `python3` ->
"python3 not found - install Python 3"; a gen/build stderr containing
`mkvmerge: not found` / `command not found` -> "mkvmerge not found - install
mkvtoolnix"; likewise `ffprobe` -> ffmpeg. These already surface in the modal
(inspect() catches, buildRun returns the error); this just makes them readable.
Unit-test the mapping helper.

### electron-builder config + script (`app/package.json`)

```jsonc
"build": {
  "appId": "com.mkvedions.workbench",
  "productName": "mkv-editions",
  "files": ["dist-electron/**/*", "renderer/build/**/*", "package.json"],
  "extraResources": [{ "from": "../src/gen-editions.py", "to": "cli/gen-editions.py" }],
  "linux": { "target": ["AppImage"], "category": "AudioVideo" }
}
```

- Add `electron-builder` as a devDependency.
- Add a script: `"dist": "npm run build && electron-builder"`.
- The renderer still loads via the `file://` protocol interception; `files`
  preserves `dist-electron/` + `renderer/build/` so `BUILD_DIR`
  (`join(dirname, '..', 'renderer', 'build')`) resolves inside the asar.
- asar stays on (default); the Python script is in `extraResources` (outside
  asar) so it is a real file `python3` can run.

### Docs (`README`)

Note the runtime requirement (python3, mkvmerge, ffprobe on PATH) and that an
AppImage launched from a file manager may have a stripped PATH - if the tools
are not in `/usr/bin`, launch from a terminal or set `MKVED_PYTHON`.

## Testing / validation

- `cli.test.ts`: bundled-path branch (temp `resourcesPath`) + dev walk-up.
- Missing-tool error mapping unit test.
- Real validation: `npm run dist`, run the AppImage on a machine with the three
  tools installed, and confirm a build against a real disc produces the MKV;
  then on a machine missing one tool, confirm the clear error appears.

## Non-goals

- Bundling mkvmerge/ffprobe/python runtimes (large, per-platform, licensing).
- Windows/macOS targets (Linux AppImage first; the same config extends later).
- Auto-update.
