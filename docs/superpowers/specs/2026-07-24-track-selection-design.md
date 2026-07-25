# Inline track selection in the DetailPanel

Let the user choose which audio and subtitle tracks end up in the built movie,
inline on a selected clip's stream lines in the bottom detail panel. Selection
is global by "slot" (track identity), which is exactly what the CLI already
builds and tests; the only new plumbing is surfacing it in the renderer.

Builds on the descriptive-metadata detail panel and the Build feature (same
`descriptive-metadata` branch). The Python CLI's track-selection contract
(`tracks: [{slot, keep, lang?, default?}]`) and build engine (`clip_track_opts`,
`check_track_layout`) are UNCHANGED; the renderer just starts populating that
contract.

## Scope

- **Scan addition** (`gen-editions.py`): emit `slot` (the slot id) on each clip
  `streams[]` entry, so a stream line maps to a slot without the renderer
  re-deriving ordinals.
- **Renderer model + contract**: carry the selection (`Project.tracks`) and
  write/read it through `toMkvedproj`/`fromMkvedproj` (today it is hardcoded to
  `[]` on write and dropped on read).
- **Selection helpers**: pure functions for the keep-all/allow-list logic.
- **UI**: include/exclude checkboxes on the clip detail's audio/subtitle rows, a
  summary note, and a caution when a kept track is missing from clips used in
  the project.

## Non-goals

- Per-clip selection (breaks flat/xin1 append; the CLI contract is global by
  slot). Not in this feature.
- Language-tag override and default-track flag (the CLI supports `lang`/`default`
  per slot; the UI defers them - include/exclude only for now).
- Any change to `gen-editions.py`'s build engine, `build.sh`, or the mkvmerge
  option mapping. The `tracks` contract and `clip_track_opts` already do this.
- Chapter or track renaming.

## Background: how the CLI already works (do not rebuild)

- The scan emits a top-level `slots[]`: one entry per distinct track identity
  `id = "kind:lang:codec:ordinal"` (e.g. `audio:eng:ac3:1`), with
  `present_in`/`missing_from` clip-id lists. A slot is global across the disc.
- A `.mkvedproj` may carry `tracks: [{slot, keep, lang?, default?}]`. This is a
  project-wide selection applied to every clip.
- At build time (`gen-editions.py`): if `tracks` is empty/absent, `clip_opts`
  stays `None` and mkvmerge keeps ALL tracks (the current default). If `tracks`
  is non-empty, `clip_track_opts` keeps only the `keep: true` slots per clip
  (`--audio-tracks`/`--subtitle-tracks`, or `--no-audio`/`--no-subtitles` when a
  kind has none selected). A selected slot missing from a clip is FATAL in
  flat/xin1 (`check_track_layout` -> `sys.exit`) and a warning in linked.

## Data sourcing

Per clip, in `run_scan`: add `slot` to each stream dict, taken from
`slot_ids_for_clip(streams)` (the same function `compute_slots` uses). Video and
unknown-kind streams get `slot: null`. This is additive and does not change
`slots[]`, the build path, or any existing key.

## Components

### Renderer model (`app/renderer/src/lib/model.ts`)

- `Stream` gains `slot?: string | null`.
- New `TrackSel { slot: string; keep: boolean; lang?: string; default?: boolean }`
  (mirrors the CLI; this feature only sets `slot` + `keep`).

### Project (`app/renderer/src/lib/project.ts`)

- `Project` gains `tracks: TrackSel[]`; `newProject` sets `tracks: []`.
- `toMkvedproj(p)` emits `tracks: p.tracks` (replacing the hardcoded `[]`).
- `fromMkvedproj(json)` reads `tracks: Array.isArray(json.tracks) ? json.tracks : []`.
- Pure helpers (the keep-all / allow-list model, where `tracks: []` means keep
  all, and a non-empty list holds every slot with an explicit `keep` flag):
  - `isSlotKept(p, slot): boolean` - `p.tracks` empty -> true; else the slot's
    `keep` flag (defaulting true if somehow absent).
  - `toggleSlot(p, slot, allSlotIds): Project`:
    - if `p.tracks` is empty (keep-all), materialize the full list
      `allSlotIds.map(s => ({slot: s, keep: s !== slot}))` (everything kept
      except the toggled one);
    - else flip the toggled slot's `keep`;
    - then, if every entry is `keep: true`, collapse back to `[]` (clean
      keep-all).
  - `keptSummary(p, allSlotIds): { kept: number; total: number; all: boolean }`
    - for the note (`all` true when `p.tracks` is empty).
  - `missingKeptSlots(model, p): { slot: string; missing: string[] }[]` - for the
    caution: for each kept slot (per `isSlotKept`), the intersection of that
    slot's `missing_from` with the set of clip ids used across `p.editions`.
    Empty when keep-all (nothing is an explicit requirement).

### DetailPanel (`app/renderer/src/lib/components/DetailPanel.svelte`)

- Props gain `project: Project | null` and `ontoggleslot: (slot: string) => void`.
- Clip view: replace the read-only `clipStreamSummary` lines with a row per
  non-video stream showing `kind · codec · lang · channels` plus a leading
  checkbox bound to `isSlotKept(project, stream.slot)` (disabled/absent when
  `stream.slot` is null or `project` is null); toggling calls
  `ontoggleslot(stream.slot)`.
- Above the rows, a summary line from `keptSummary`: "Keeping all tracks" when
  `all`, else "Keeping {kept} of {total} tracks - applies to every clip".
- Below the rows, if `missingKeptSlots` is non-empty, a caution line naming the
  slot(s) and how many project clips lack them ("build fails in flat/xin1").
- Disc-overview and playlist views are unchanged.

### Shell (`app/renderer/src/routes/+page.svelte`)

- Derive `allSlotIds = model ? model.slots.map(s => s.id) : []`.
- Pass `project` and
  `ontoggleslot={(sid) => apply((p) => toggleSlot(p, sid, allSlotIds))}` to
  `DetailPanel`. (`apply` already exists and updates `project` reactively.)

## Error handling

- A stream with `slot: null` (video or unparseable) shows no checkbox.
- Keep-all (`tracks: []`) is the default and needs no `slots[]` at all; the panel
  simply shows every track checked.
- An all-excluded allow-list is valid: the CLI honors it (`--no-audio`/
  `--no-subtitles`); nothing special in the UI.
- The caution is advisory; the authoritative missing-slot check remains the
  build (fatal in flat/xin1), whose error already surfaces in the Build modal
  log.
- Selecting then rescanning a different disc: `selected` already resets, and a
  new scan replaces `model`; a fresh project starts keep-all.

## Testing

- **CLI (pytest):** `--scan-json` emits `slot` on each clip stream (e.g. the
  sample's audio stream gets `audio:und:...:1` or the sample's actual id) and
  `null` on the video stream; `slots[]` is unchanged.
- **Renderer (vitest, jsdom):**
  - `project.test`: `toggleSlot`/`isSlotKept` truth table - keep-all default,
    first uncheck materializes the full list with one excluded, re-checking the
    last one collapses back to `[]`, exclude-all leaves a full keep:false list;
    `keptSummary` counts; `toMkvedproj`/`fromMkvedproj` round-trips a non-empty
    `tracks`.
  - `missingKeptSlots` returns the kept slots absent from project clips and empty
    under keep-all.
  - `DetailPanel`: a clip with two audio streams renders two checkboxes,
    reflects `isSlotKept`, fires `ontoggleslot` with the slot id on change, shows
    the "Keeping N of M" note when narrowed, and shows the caution when a kept
    slot is missing from a project clip.
  - svelte-check stays 0 errors / 0 warnings.

## Validation

Against the real Blade Runner 2049 disc: select a readable clip, uncheck the
Spanish audio row; the note reads "Keeping N of M tracks - applies to every
clip"; build via the Build modal and confirm the output has no Spanish audio;
re-check it to return to keep-all. Force a caution by keeping a slot that a decoy
clip lacks and confirm the panel warns before the build does.
