# Electron workbench frontend for mkv-editions

An Electron app for authoring editions interactively, on top of the existing
Python CLI. The CLI stays the source of truth: the app never reimplements MPLS
parsing, ffprobe measurement, or XML generation, and anything the app can build
is buildable headlessly from the same file the app saves.

## Scope

- Interactive workbench: assemble editions by picking and ordering the disc's
  clips, across playlists, not just 1:1 playlist-to-edition mapping.
- Boundaries are disc-defined only. A segment is a whole clip, as the ordered
  modes already treat it. No trimming, no user cut points, no re-encoding.
- Thumbnails only for preview (stills via ffmpeg). No embedded player.
- Audio and subtitle track selection with real languages from the MPLS STN table.
- Runs the generated `build.sh` and shows it. The auditable artifact stays.
- Local development target: Linux / WSLg, `npm start`, system dependencies
  assumed present. No installer, no packaging, no cross-platform work.

## Non-goals

- Arbitrary cut points, trimming, chapter-mark editing, re-encoding.
- Embedded playback or transcoded proxies.
- Track reordering, per-track names, external audio or subtitle files.
- Packaged or cross-platform builds.
- Replacing or retiring the CLI.

## Repository layout

```
src/gen-editions.py      unchanged entry point, two additive flags
app/
  main/                  main process: child processes, fs, dialogs, IPC
  preload/               contextBridge; contextIsolation on, nodeIntegration off
  renderer/              workbench UI (SvelteKit + adapter-static, Vite)
samples/make-sample.py   gains audio tracks
docs/superpowers/specs/
```

The renderer never touches the filesystem and never spawns a process. The main
process shells out to `python3 src/gen-editions.py` and to `ffmpeg` for
thumbnails, and streams results over IPC.

The renderer is **SvelteKit with `adapter-static`**, aligned to the stack of the
owner's existing SvelteKit app (ARM `services/ui-neu/frontend`): Svelte 5,
Vite 8, `@sveltejs/vite-plugin-svelte` 7, TypeScript 6, vitest 4, Tailwind 4,
`@testing-library/svelte` 5, Playwright for visual tests. Consistency with that
project is the reason to use SvelteKit here rather than plain Svelte.

Architecture, given that stack cannot use `electron-vite` (which peer-caps at
Vite 7 while this stack is Vite 8):

- The renderer is a SvelteKit app prerendered to a static SPA by `adapter-static`
  (`ssr = false`, `prerender = true`, `paths.relative = true` so assets resolve
  under `file://`). Electron's main process loads the built `index.html` via
  `loadFile` in production and the Vite dev-server URL via `loadURL` in dev.
- The Electron **main** and **preload** are built separately from SvelteKit (a
  small esbuild/tsup or tsc step), since electron-vite is dropped. The preload
  still exposes `window.api` via `contextBridge` (contextIsolation on,
  nodeIntegration off, sandbox on); SvelteKit code calls `window.api.*` only and
  never imports Electron, `fs`, or `child_process`.
- SvelteKit's server-side features (SSR, server endpoints, form actions) stay
  unused; the privileged side is the Electron main process over IPC, not an HTTP
  server. The single route renders the workbench. Because the app is a static
  SPA, the same renderer could later be served as a web frontend against a
  backend that runs the CLI (the ARM service shape) with no rewrite of the UI.

## CLI contract

Additive flags. Existing argv behavior is unchanged.

### `--scan-json [--fast] [--cache DIR]`

Parse the BDMV, ffprobe every clip, parse the STN table, write the disc model to
stdout as JSON, and exit. Nothing is written to disk except the optional cache.

Per-clip progress is emitted to **stderr** as JSON lines, so stdout stays a
single clean JSON document:

```
{"type":"progress","clip":"00003","done":4,"total":9}
```

```jsonc
{
  "bdmv": "/mnt/bd/BDMV",
  "clips": {
    "00002": {
      "path": "/mnt/bd/BDMV/STREAM/00002.m2ts",
      "frames": 96, "fps": [24000, 1001],
      "dur_ns": 4004000000, "codec": "h264",
      "marks_ns": [0, 2002000000],
      "streams": [
        {"pid": 4113, "kind": "video", "codec": "h264", "lang": null},
        {"pid": 4352, "kind": "audio", "codec": "ac3",  "lang": "eng"},
        {"pid": 4353, "kind": "audio", "codec": "ac3",  "lang": "jpn"},
        {"pid": 4608, "kind": "subtitle", "codec": "pgs", "lang": "eng"}
      ]
    }
  },
  "playlists": [
    {"file": "00003.mpls", "angles": 2,
     "editions": [{"name": "00003", "clips": ["00001", "00002"]},
                  {"name": "00003 (Angle 2)", "clips": ["00001", "00011"]}]}
  ],
  "slots": [
    {"id": "audio:eng:ac3:1", "kind": "audio", "codec": "ac3", "lang": "eng",
     "ordinal": 1, "present_in": ["00001", "00002"], "missing_from": []},
    {"id": "audio:eng:ac3:2", "kind": "audio", "codec": "ac3", "lang": "eng",
     "ordinal": 2, "present_in": ["00001"], "missing_from": ["00002"]}
  ],
  "warnings": [{"kind": "vc1", "clips": ["00004"],
                "message": "VC-1 video (00004): mkvmerge skips one frame per append"}]
}
```

### Scanning real media

On the synthetic sample a scan is instant. On a retail disc it is not, and the
difference is structural rather than a matter of tuning. `frame_info` falls back
to `ffprobe -count_frames` whenever `nb_frames` is absent, which for m2ts is
essentially always, so a full scan frame-counts every clip on the disc: tens of
gigabytes, minutes to tens of minutes. Three consequences:

- **Two-pass scanning.** `--fast` skips frame counting and reports container
  durations, with `"frames": null` and `"exact": false` per clip. The app runs
  the fast pass first so the workbench is usable within seconds, then runs the
  full pass in the background and upgrades the model in place.
- **Frame-dependent features gate on the full pass.** `--qpfile` and frame-exact
  boundaries require real frame counts, so those controls stay disabled, with a
  visible reason, until the full scan completes. Authoring, reordering, and
  track selection do not wait.
- **Probe cache.** `--cache DIR` stores per-clip probe results keyed by path,
  size, and mtime, and reuses them on later runs. The cache lives in the CLI, not
  the app, so repeat CLI runs on the same disc benefit too. The app passes its
  `userData` cache directory. A changed or replaced clip invalidates its own
  entry only.

A slot id is `kind:lang:codec:ordinal`, where the ordinal disambiguates streams
sharing all three other fields, assigned by order of appearance in the clip's STN
table. Discs commonly carry two English AC3 tracks (main and commentary), so
without the ordinal the key would collide and the two would be indistinguishable.

### What a real retail disc actually looks like (validated 2026-07-23)

Phase 1 was validated against Blade Runner 2049 3D (decrypted UDF ISO,
loop-mounted). The measured reality differs from the synthetic sample in ways the
app must handle:

- **Scale and decoys.** 169 playlists, 182 clips. Only a handful are real; the
  rest are anti-rip decoys. Some decoy playlists have 101 PlayItems cycling
  between 2 clips. The feature is one 27.6 GB clip reached by two playlists (a
  plain single-clip one and a 2-angle one). A UI that lists every playlist and
  every clip flat is unusable on a disc like this - see "Disc scale" under UI.
- **`--fast` is not optional, it is the default path.** The full disc scanned in
  14 seconds with `--fast`; a non-fast scan would frame-count the 27.6 GB feature
  and every decoy. The app always runs `--fast` first and only escalates specific
  clips to a full probe when a frame-dependent feature needs them.
- **Orphan and corrupt clips exist and must not break the scan.** Clips
  referenced by no playlist (a 14 GB orphan here) are simply not probed. At least
  one clip decoded to garbage (`mkvmerge -J` returns zero tracks); the scan
  records it with an empty `streams`/`tracks` list rather than failing. The app
  must render a zero-track clip as unusable, not crash.
- **3D discs yield 2D editions.** A 3D BD stores the MVC dependent view in
  `STREAM/SSIF/*.ssif`; `STREAM/*.m2ts` are the 2D base views the tool consumes.
  This is in scope as-is: the app builds 2D editions and ignores SSIF. It should
  say so rather than imply 3D output.
- **Some discs report languages at the stream level.** On this disc `mkvmerge -J`
  already returned `eng`/`spa` per track, so languages appeared without our STN
  `--language` flags. The scan still reads languages from the STN table (the
  reliable source); when both are present they agreed. The app treats the scan's
  `lang` as authoritative and does not depend on mkvmerge echoing it.

### `--project FILE.mkvedproj`

Read title, mode, flags, editions, and track selection from JSON instead of
`"Name=playlist.mpls"` argv, then generate the out directory exactly as today.

```jsonc
{
  "version": 1,
  "bdmv": "/mnt/bd/BDMV",
  "title": "Sample",
  "mode": "xin1",
  "preserve_chapters": true,
  "qpfile": false,
  "editions": [
    {"name": "Theatrical", "clips": ["00001", "00002", "00003", "00004", "00005"]},
    {"name": "Extended",
     "clips": ["00001", "00002", "00011", "00012", "00013", "00004", "00005"]}
  ],
  "tracks": [
    {"slot": "audio:eng:ac3:1", "keep": true, "lang": "eng", "default": true},
    {"slot": "audio:jpn:ac3:1", "keep": true, "lang": "jpn", "default": false},
    {"slot": "subtitle:eng:pgs:1", "keep": false}
  ]
}
```

This file is the GUI/CLI contract and the app's save format. A saved project
builds headlessly with no GUI, so the app adds no authoring power the CLI cannot
express.

## Python-side changes

### Chapter marks re-keyed per clip

`edition_mark_positions` currently keys marks by PlayItem index within a single
playlist. An authored edition mixes clips from several playlists, so that index
is meaningless. Marks move to per-clip offsets at scan time (`marks_ns` above)
so they travel with the clip when it is re-sequenced. Playlist-derived editions
produce identical output; only the keying stops being positional.

### STN table parsing

`parse_mpls` gains STN table parsing. The table follows each PlayItem's angle
block, at an offset the existing multi-angle code already computes. Per stream
it yields PID, coding type, and the 3-byte language code. This is the only
source of real language metadata: BD m2ts streams usually carry none, which is
why tracks currently land as `und`.

### Track flags in the emitted build.sh

Selected slots become `--audio-tracks` / `--subtitle-tracks` per input, with
`--language` and `--default-track-flag` from the project's overrides. Today no
track flags are emitted at all, so every stream passes through untagged.

### Seedable EditionUIDs

`uid()` returns a random nonzero 64-bit value, which makes byte-comparison of
generated output impossible. It gains a seed hook (`--seed N`, unset by default)
so the round-trip equivalence test can compare build.sh output directly. Normal
runs stay random, as the aobikari work intended.

### Refactor scope

These are additive. `build_flat`, `build_linked`, and `build_xin1` keep their
current structure; the shared helpers introduced in the aobikari work absorb the
track-flag emission so all three modes stay consistent.

## Track model

Selection is project-wide, not per-edition. `--audio-tracks` is per input file,
and in flat and xin1 every appended clip must end with an identical layout, so a
per-edition or per-clip selection would produce broken appends by construction.

The scan unions each clip's streams into project-wide **slots** keyed by kind,
language, and codec, recording which clips have each slot. The track panel ticks
slots.

Selecting a slot missing from a clip used by an append-mode edition (flat, xin1)
is **blocked**, with a message naming the clip. This is also the fix for a real
existing corruption risk: mkvmerge appends by matching track order and type, so
a disc where a commentary track exists on only some clips fails or silently
mis-pairs, and nothing currently detects it. In `linked` mode the same case is
only a warning, because linked never appends.

## UI

```
+- disc /mnt/bd/BDMV   title [Sample]   mode (flat|linked|xin1)  [ ]preserve  [ ]qpfile -+
| CLIP LIBRARY | EDITIONS                                    | INSPECTOR / TRACKS        |
| thumbnail    |  Theatrical 20.1s [1][2][3][4][5]           | clip 00003, 4.0s, h264    |
| grid of all  |  Extended   30.1s [1][2][11][12][13][4][5]  | marks, warnings           |
| unique clips |  + new edition        (drop clips here)     | slot ticks, lang, default |
+- build.sh (read-only)  |  build log             [ Generate ]  [ Build ] ---------------+
```

- Drag a clip from the library onto a track to append; drag within a track to
  reorder; drag out or press Delete to remove. Dropping the same clip twice is
  legal: repeated segments already work.
- *Import playlist* creates a track pre-filled from an MPLS. A multi-angle
  playlist imports as N tracks (`Name`, `Name (Angle 2)`, ...), matching the
  CLI's auto-expand.
- Rename a track inline. Track order is edition order in the output.
- Chip width is proportional to duration; color distinguishes clips shared
  across editions from clips unique to one, so a swap reads at a glance.
- Warnings appear where they apply: a VC-1 badge on the chip plus a banner
  suggesting `--mode linked` when the mode appends; a badge for a partial-clip
  span mismatch; a blocking startup banner when `mkvmerge`, `ffprobe`, or
  `python3` is missing, mirroring `mkv-editions.sh`.

### Disc scale and decoy playlists

The synthetic sample has 4 playlists and 9 clips; a retail disc has ~170
playlists and ~180 clips, most of them decoys. The mockup above assumed a small
disc; on a real one the clip library and playlist list must stay navigable:

- **The clip library shows clips referenced by at least one playlist, sorted by
  duration descending by default**, so the feature and real extras surface at the
  top and the tiny decoy/menu loops sink. Orphan clips (referenced by nothing)
  are hidden by default behind a "show N unreferenced" toggle. A zero-track
  (corrupt) clip is shown greyed with an "unreadable" badge and cannot be dragged
  into an edition.
- **Playlist import is a searchable, duration-sorted list, not a flat menu.**
  Each entry shows duration, item count, and unique-clip count, so a 2:41 / 1 clip
  feature is obviously distinct from a 1:18 / 101 item / 2 clip decoy. Playlists
  are collapsed by default with the longest few surfaced; a heuristic flags
  likely decoys (very high item-count relative to unique clips) as de-emphasized,
  never hidden - the user makes the call.
- **First-run guidance.** After a scan the app suggests the longest playlist as
  the starting edition rather than presenting an empty workbench against 170
  choices. Nothing is auto-imported; it is a highlighted suggestion.

None of this changes the contract: the app still authors from clip ids the scan
reported. Scale handling is presentation only.

### Thumbnails

The main process extracts three stills per clip (first, middle, last frame) with
`ffmpeg -ss ... -frames:v 1`, written as JPEGs to the Electron `userData`
directory keyed by clip path, size, and mtime, and served to the renderer as
`file://` URLs. Extraction is lazy and concurrent-capped, so a large disc does
not stall the first render. A clip whose thumbnail extraction fails shows a
placeholder chip and is otherwise fully usable.

### Renderer state

One `Project` object: `{bdmv, title, mode, flags, editions, tracks}`. Serialized,
it is the `.mkvedproj`. The clip library, thumbnails, slots, and warnings are all
derived from the scan and never edited, so scan results and project state stay
cleanly separated. Reopening a project re-scans the disc, but the probe cache
makes that cheap; only clips that changed on disk are re-probed.

## Build execution

The main process spawns `bash build.sh` in the out directory, streams stdout and
stderr into the log pane, and parses mkvmerge's `Progress: NN%` for a progress
bar. Cancel kills the process group. Partial outputs are left on disk and the
build is reported failed, never silently half-done. The exit code and the failing
command are shown verbatim.

## Error handling

Every main-to-renderer IPC reply is `{ok: true, data}` or `{ok: false, error}`;
the renderer has no other path. Scan failures surface the Python stderr rather
than swallowing it.

## Implementation phasing

Two phases, because the first is independently useful and independently
testable without any GUI:

1. **CLI contract. DONE (merged 27fe146, 2026-07-23).** Per-clip mark re-keying
   (positional, not clip-keyed - a repeated clip keeps its own marks), STN table
   parsing, seedable UIDs, track flags in build.sh, `--scan-json` with `--fast`,
   `--cache`, and stderr progress, `--project`, sample generator audio (AC-3, not
   AAC - ffmpeg writes AAC in .m2ts as stream_type 0x06 which mkvmerge drops), and
   the pytest suite (81 tests). `.mkvedproj` strings are validated at
   `load_project` as a security boundary (they reach the generated build.sh).
   Validated against the synthetic sample and a real retail disc.
2. **Electron app.** Scaffold, IPC, scan and thumbnail plumbing, workbench UI
   (including the disc-scale handling above), track panel, build runner, renderer
   tests, smoke test. This is what remains.

## Testing

The load-bearing test is **round-trip equivalence**: for playlist-derived
editions, `--project` must emit a `build.sh` byte-identical to the existing argv
path, with EditionUIDs seeded for determinism. This proves the new contract did
not change validated behavior.

- pytest over `--scan-json` against the synthetic sample: clip set, durations,
  codecs, marks, slots, angle expansion.
- **The sample generator gains audio**: two tracks in different languages, and
  one clip deliberately missing the second track so the append-mismatch block is
  exercised. Today's sample is video-only, so the audio path has never been
  tested in this repo.
- pytest over the probe cache: a warm run re-probes nothing, a clip whose mtime
  or size changed is re-probed and its neighbours are not, and `--fast` output
  matches the full pass except for `frames` and `exact`.
- vitest over renderer logic: project model, ordering, divergence computation,
  validation rules, and the fast-to-full model upgrade leaving authored editions
  untouched.
- One Electron smoke test: launch, scan the sample, build, assert two ordered
  editions in the output.

## Validation

Regenerate the sample and confirm the three modes still build and verify as they
do today, then exercise the new paths: author a mixed edition drawing clips from
two playlists, save it, and confirm `gen-editions.py --project` reproduces the
same output headlessly. Verify track selection with `mkvmerge -J` (expected
tracks, correct languages, correct default flags) and confirm the append-mismatch
case is blocked rather than built.

A real retail disc is the second validation target. The synthetic sample stays
the automated baseline because it is fast and committable; a real disc exercises
what the generator cannot fake: genuine STN table contents, real language codes,
PGS subtitles, and true multi-angle playlists.

**Real-disc validation done (2026-07-23), Blade Runner 2049 3D:** whole-disc
`--scan-json --fast --cache` completed in 14 s (165 clips, 0 warnings, 0 crashes);
169 decoy-laden playlists parsed clean; all 3 multi-angle playlists auto-expanded;
the 27.6 GB MVC feature probed with the PID join intact; orphan and corrupt clips
did not break the scan. A `--project` build produced a real MKV carrying 2 AC-3 +
2 PGS with correct eng/spa languages, and track selection (keep eng audio only)
emitted `--audio-tracks / --no-subtitles / --language 1:eng` and produced exactly
video + one eng audio track. The Electron app is built against this validated
engine; the disc is the manual integration-test fixture for Phase 2.
