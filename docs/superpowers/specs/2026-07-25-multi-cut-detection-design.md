# Multi-cut auto-detection

Detect a disc's distinct feature cuts (Theatrical / Special Edition / Extended,
etc.) and auto-import them as separate editions, instead of importing a single
feature playlist. Renderer-only: it reasons over the existing scan
(`playlists` + `clips`); the CLI and scan JSON are unchanged.

Builds on the workbench (same repo). Replaces the single-feature auto-import in
`scanInto` (`longestRealPlaylist` -> `importPlaylist`).

## Motivation (grounded in real discs)

Seamless-branching discs represent each cut as a SEPARATE playlist, so the
current "import the longest real playlist" picks one cut (and on Avatar it picks
the wrong thing - a branching superset). Measured on the mounted discs:

- **Avatar CE** (230 playlists): three cuts at 2:41:43 / 2:50:35 / 2:58:11, each
  duplicated across 3 playlist IDs (e.g. 00001/00800/00850), plus a branching
  superset `00005` (3:05:15, items/clips = 1.59), a 44-min bonus (00019/00034),
  and loop decoys (00720 = 450 items/1 clip). Current import: 1 edition (the
  superset). Desired: 3 editions.
- **Blade Runner 3D**: `00342` (2D, 161.7 min, 1 clip) and `00334` (3D, 163.5
  min, 2 clips, 2 angles) - the SAME movie in 2D vs 3D (~2 min apart), and they
  even share a clip. Must stay a single feature (today's 3D + 2 angles), not
  become three editions.

Key finding: clip-overlap does NOT separate cuts from supersets/format-variants
(the superset overlaps a cut 80%; BR 2D/3D share a clip). The reliable signals
are the **items/clips ratio**, a **relative length floor**, and
**runtime-distinctness** (real cuts differ in length; format variants do not).

## Algorithm - `detectCuts(m: DiscModel): Playlist[]`

Pure, deterministic, over scan data. Let a playlist's clips be
`p.editions[0].clips` and its runtime be the sum of those clips' `dur_ns`.

1. **Linear candidates.** Keep playlists with `clips.length / uniqueClips <=
   1.2`. This drops the branching superset (1.59), branchy playlists like
   Avatar 00023 (1.48), and loop decoys (huge ratios). If none, return `[]`.
2. **Feature-length.** Of the candidates, keep those with runtime `>= 0.6 *
   (max candidate runtime)`. Drops the 44-min bonus (44 < 0.6 x 178).
3. **Dedup identical clip sequences.** Group by the exact ordered clip list;
   keep one per group (lowest `file`). Collapses 00001/00800/00850 to one.
4. **Merge near-equal runtimes -> pick the richer representative.** Group
   remaining playlists whose runtimes are within **3 minutes**; each group is
   one "version". Representative = most angles, then longest runtime, then
   lowest `file`. Merges BR 2D+3D into one (keeps 00334, the 3D/2-angle);
   Avatar's 7-9 min steps stay distinct.
5. **Order + cap.** Sort representatives by runtime ascending; cap at **6**.

## Import + naming (`scanInto`)

- `const cuts = detectCuts(model)`.
- Import list = `cuts` if non-empty, else the single `longestRealPlaylist`
  fallback (as a one-element list), else empty.
- For each playlist in the list, `p = importCut(p, pl, fmtDuration(runtime))`.
- **`importCut(project, pl, baseName)`** (new, in `project.ts`): like
  `importPlaylist` but names the added editions by `baseName` (the runtime),
  preserving angle expansion: edition `i` is `baseName` for `i === 0`, else
  `` `${baseName} (Angle ${i + 1})` ``. So a cut imports as "2:58:11" (and
  "2:58:11 (Angle 2)" for a 3D/angle cut). The user renames freely.
- Progress line reflects the count, e.g. `scan complete - 3 edition(s)`.
- Baseline + history reset unchanged.

This makes naming uniform (runtime) for single- and multi-cut discs. A single
feature keeps the same edition count and content as today; only the edition
label changes from the playlist ID to the runtime (an improvement).

## Outcomes

| Disc | Today | After |
| --- | --- | --- |
| Avatar CE | 1 edition (superset 00005) | 3 editions - 2:41:43 / 2:50:35 / 2:58:11 |
| Blade Runner 3D | 2 angle editions (00334) | same 2 editions, named by runtime |
| Concert (5 angles, 1 playlist) | 5 angle editions | same 5 (one version, angles expand) |
| Normal single-feature movie | 1 edition | same 1, named by runtime |

## Edge cases + tradeoffs

- Duplicate playlist IDs of one cut -> deduped (step 3).
- Branching superset / loop decoys -> excluded by the ratio filter (step 1).
- Short bonus playlists -> excluded by the relative floor (step 2).
- 2D vs 3D same-movie -> merged by near-equal runtime (step 4), richer kept.
- Multi-angle (concert) -> composes: `detectCuts` returns one version, angle
  expansion happens in `importCut`.
- Degenerate discs (all decoys/short) -> `detectCuts` returns `[]`, `scanInto`
  falls back to `longestRealPlaylist` (never worse than today). Cap 6 guards a
  pathological disc.
- **Accepted misses** (rare; the Playlists panel still lets the user import
  manually): two genuinely-different cuts within 3 min of each other merge into
  one; a legitimately branchy cut (ratio > 1.2) is skipped.

## Non-goals

- No CLI / scan-JSON change; no 2D-vs-3D detection (no stereoscopic metadata).
- No guessing Theatrical/Extended labels (runtime naming only).
- No change to authoring, build, or the `.mkvedproj` contract.

## Testing

- **`model.ts` (vitest):** `detectCuts` against synthetic `DiscModel` fixtures:
  an Avatar-like disc (3 distinct-length 1:1 cuts x duplicate IDs + a 1.59-ratio
  superset + a short 1:1 bonus + a loop decoy) returns exactly the 3
  representatives, shortest-first; a Blade-Runner-like disc (2D 1-clip vs 3D
  2-clip/2-angle, ~equal length) returns one (the 3D/2-angle, most angles); a
  single-feature disc returns one; an all-decoy disc returns `[]`. Plus
  `playlistRuntimeNs` and `importCut` (runtime base name + angle suffixes).
- **Renderer/build:** svelte-check 0/0; `scanInto` wiring covered by build +
  the real-disc validation.

## Validation

Against `/mnt/avatar`: loading the disc auto-creates 3 editions named 2:41:43 /
2:50:35 / 2:58:11 (no superset, no bonus), each buildable. Against `/mnt/br`:
one movie, its 2 angle editions (unchanged count), named by runtime.
