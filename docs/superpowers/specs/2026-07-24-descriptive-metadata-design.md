# Descriptive metadata for identifying clips and playlists

Surface more of what a Blu-ray already knows, so a user can tell clips and
playlists apart in the workbench: chapter counts, real audio/subtitle
languages + codecs + channels, video resolution, and the disc's own title +
poster. Most of it flows through the existing scan; a new bottom detail panel
carries the depth.

Builds on [[electron-workbench-plan]] Increments 1-2 (merged). The app is in
`app/`: Electron shell (`app/electron/`, tsup CJS) + SvelteKit adapter-static
renderer (`app/renderer/`). The Python CLI (`src/gen-editions.py`) owns disc
parsing and `--scan-json`.

## Scope

- **Already in the scan, newly displayed** (no CLI change): chapter count per
  clip/playlist (`marks_ns` length), and real per-stream language + codec
  (`streams[]`).
- **New scan fields** (CLI change): per-clip video `width`/`height`, and a
  `channels` field on each audio stream.
- **New disc metadata** (CLI change): a top-level `disc: {title, poster}` from
  `BDMV/META/DL/bdmt_<lang>.xml` and the poster JPG.
- **New UI**: a bottom detail panel showing full metadata for the selected clip
  or playlist, or a disc overview (title + poster + summary) when nothing is
  selected; plus a chapter-count cue on rows and a disc-title label in the
  header.

## Non-goals

- Thumbnails / extracted frames (a separate, larger feature; deferred).
- Editing any of this metadata; it is read-only, for identification only.
- Changing authoring, the `.mkvedproj` contract, or the build path.
- Parsing chapter *names* (rare on BD; only counts here).

## Data sourcing

### Scan additions (`gen-editions.py --scan-json`)

Per clip, in the existing probe:

- `width`, `height`: from `ffprobe` on the video stream (the scan already probes
  it for codec/fps; add `width,height` to that query). Null if unavailable.
- `channels` on each audio entry in `streams[]`: a second `ffprobe` pass
  (`-select_streams a -show_entries stream=channels`) yields the channel count
  per audio stream, in file order. The audio streams in `streams[]` are matched
  to these by order (both are STN/PMT order). A stream that cannot be matched
  keeps `channels: null`. The renderer formats the count (2 -> "2.0", 6 -> "5.1",
  8 -> "7.1", else "Nch").

Chapter count and languages/codecs need no scan change: `marks_ns.length` is the
chapter count and `streams[i].lang`/`.codec` are already emitted.

New top-level key:

```jsonc
"disc": {
  "title": "Blade Runner 2049",   // or null
  "poster": "/mnt/br/BDMV/META/DL/BR_JP_LRG.jpg"  // path, or null
}
```

- `title`: parse `BDMV/META/DL/bdmt_eng.xml` (prefer `eng`, else the first
  `bdmt_*.xml` present) for the disc name element (`<di:name>` under
  `<di:title>`). Null if META absent or unparseable.
- `poster`: the largest `*.jpg`/`*.png` in `BDMV/META/DL` by file size, as a
  filesystem path. Null if none. (Emitting a path, not bytes, keeps the scan
  JSON lean.)

If `BDMV/META` does not exist, `disc` is `{title: null, poster: null}`. This is
common; the UI degrades to the folder name.

### Poster delivery to the renderer

The scan emits `disc.poster` as a path. The Electron main process, when it
returns the scan result over the `scan` IPC, reads that one JPG (if present and
within a sane size cap, e.g. <= 4 MB) and attaches `disc.poster_data_url` (a
`data:image/...;base64,...` string) to the returned model, then clears the raw
path. The renderer shows the data URL directly - it never reads the filesystem.
A read failure or oversize file leaves `poster_data_url` null.

## Components

### CLI (`src/gen-editions.py`)

- Extend the clip probe to capture `width`/`height` and per-audio `channels`,
  added to the scan model as above. This is additive; `--project` builds are
  unaffected.
- New `disc_meta(bdmv) -> {title, poster}`: parse the META xml and find the
  poster. Tolerant (any failure -> nulls), like the existing playlist sweep.
- `run_scan` emits the `disc` key.

### Electron main (`app/electron/scan.ts`)

- After parsing the scan JSON, if `data.disc.poster` is set, read the file and
  set `data.disc.poster_data_url` (base64), delete `data.disc.poster`. Errors ->
  null. This is the only place the poster path is touched.

### Renderer

- `app/renderer/src/lib/model.ts`: extend the `Clip` type with
  `width: number|null`, `height: number|null`; extend `Stream` with
  `channels: number|null`; add a `Disc` type (`{title: string|null;
  poster_data_url: string|null}`) and `DiscModel.disc`. Add small pure helpers:
  `chapterCount(clip)` (marks length), `fmtChannels(n)`, `fmtResolution(w,h)`,
  and `clipStreamSummary(clip)` (the per-stream lines for the panel).
- `app/renderer/src/lib/components/DetailPanel.svelte`: props
  `{ model, selected }` where `selected: {kind:'clip'|'playlist'; id} | null`.
  Renders the three states (clip / playlist / disc overview) described below.
- Row/card selection: `ClipLibrary`, `PlaylistPicker`, and `EditionTracks` gain
  an `onselect` callback prop fired on row/card body click. In `PlaylistPicker`
  the import button calls `stopPropagation` so a row click selects without
  importing. A `selected` clip/playlist row/card gets a highlight ring.
- `+page.svelte`: holds `selected` state, passes `onselect` to the three
  components, and renders `DetailPanel` in a fixed-height strip below the columns
  (the columns area becomes a flex child that shrinks; the panel is ~160px).
  Adds the read-only disc-title label to the header, and the chapter-count cue to
  the clip rows (via `ClipLibrary`) and playlist rows (via `PlaylistPicker`).

## The bottom detail panel

A fixed-height strip (~160px) under the three columns; scrolls internally on
overflow.

- **Disc overview (selected == null):** poster thumbnail (from
  `poster_data_url`) on the left, disc `title` large beside it, and a summary
  line: `N playlists / M clips`, the suggested feature file, and any warning
  (reuses the encrypted-image signal). No title -> show the BDMV folder name; no
  poster -> omit the image.
- **Clip selected:** id, `fmtResolution(w,h)`, `fps`, duration,
  `chapterCount` ch, video codec; then one line per stream from
  `clipStreamSummary`: `audio · AC3 · eng · 5.1`, `subtitle · PGS · spa`, ...;
  then the file path. An unreadable clip (no tracks) shows "unreadable" plus what
  is known.
- **Playlist selected:** file, total duration, item / unique-clip counts, angle
  count, chapter count, a "likely decoy" note when flagged, and the ordered clip
  list with each clip's duration.

## Rows and header

- Clip rows and playlist rows add a compact chapter-count cue (e.g. `16 ch`).
  Nothing else is added to rows; resolution/languages/channels live in the panel.
- Both row types show a selected-state highlight matching `selected`.
- The header gains a small read-only disc-title label (the movie name), distinct
  from the editable project-title (output filename) input.

## Error handling

- No META / unparseable title -> `disc.title` null -> header and panel fall back
  to the BDMV folder name; no poster -> no image.
- Missing `width`/`height` or `channels` -> the field is omitted in the panel,
  never a crash.
- Poster unreadable or oversize by main -> `poster_data_url` null -> panel skips
  the image.
- Selecting an unreadable clip -> panel shows "unreadable" and any known fields.
- Selecting then re-scanning a different disc -> `selected` resets to null on a
  new scan (avoids a stale id pointing at the old disc).

## Testing

- **CLI (pytest):** the sample generator gains `BDMV/META/DL/bdmt_eng.xml`
  (title "Sample Disc") and a tiny valid JPG in `META/DL`. Tests assert
  `--scan-json` emits per-clip `width`/`height` (1280/720 for the sample),
  `channels` (2) on audio streams, and a `disc` object with the parsed title and
  a poster path; plus graceful nulls when META is removed.
- **Main (vitest, node):** the poster-path enrichment reads a fixture JPG and
  returns a `data:image/jpeg;base64,...` url on `disc.poster_data_url` (path
  cleared); a missing/oversize file yields null.
- **Renderer (vitest, jsdom):** `chapterCount`/`fmtChannels`/`fmtResolution`/
  `clipStreamSummary` pure helpers; `DetailPanel` renders each of the three
  states with the expected fields; row chapter-count display; the row-click
  select path and the import-button `stopPropagation`.

## Validation

Against the real Blade Runner 2049 disc: the header and panel show the title
"Blade Runner 2049" and the poster renders; selecting `00368` shows 1920x1080,
23.976 fps, 16 chapters, and its stream list (AC3 eng/spa 5.1, PGS eng/spa);
selecting a decoy playlist shows 1 chapter; the synthetic sample remains the
automated baseline (title "Sample Disc", 1280x720, 2.0 audio).
