# Inline track selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user include/exclude audio and subtitle tracks with inline checkboxes on a clip's stream rows in the DetailPanel, honoring the CLI's existing global-by-slot `tracks` contract.

**Architecture:** The scan emits a `slot` id on each clip stream (additive). The renderer carries the selection in `Project.tracks` (the CLI's `[{slot, keep}]` allow-list; `[]` = keep all), writes/reads it through `toMkvedproj`/`fromMkvedproj`, and pure helpers implement keep-all -> allow-list with collapse-back. The DetailPanel clip view renders a checkbox per stream, a count note, and a missing-track caution. No CLI build-engine change.

**Tech Stack:** Python stdlib CLI (`src/gen-editions.py`), SvelteKit renderer (Svelte 5 runes, vitest jsdom, Tailwind 4 ARM tokens).

## Global Constraints

- NO em-dashes anywhere (code, comments, commit messages). Use "-" or reword.
- `src/gen-editions.py` and tests are Python stdlib only.
- The renderer never imports fs/electron/child_process. Components take callback props.
- Svelte 5 runes only (`$props`/`$state`/`$derived`), lowercase handlers, NO createEventDispatcher.
- The scan change is ADDITIVE: no existing key dropped; `slots[]`, the build path, and the `.mkvedproj` build-engine behavior are unchanged.
- The selection contract is the CLI's existing global one: `tracks: [{slot, keep, lang?, default?}]`; `[]` means keep all. This feature sets only `slot` + `keep`.
- Renderer bar: `npm run check` (svelte-check) 0 errors AND 0 warnings, all tests passing. CLI bar: `python3 -m pytest tests/ -v` green.

---

### Task 1: Scan emits a slot id per clip stream

**Files:**
- Modify: `src/gen-editions.py`
- Modify: `tests/test_scan.py`

**Interfaces:**
- Produces (scan JSON): each clip `streams[]` entry gains `"slot": str | null` (the slot id from `slot_ids_for_clip`, `null` for video/unknown kinds). `slots[]` and every other key are unchanged.

- [ ] **Step 1: Write the failing test** (append to `tests/test_scan.py`)

```python
def test_scan_streams_have_slot_ids(sample_bd):
    doc = json.loads(run_cli([str(sample_bd), "--scan-json", "--fast"]).stdout)
    streams = doc["clips"]["00001"]["streams"]
    ids = {sl["id"] for sl in doc["slots"]}
    saw_av = False
    for s in streams:
        if s["kind"] in ("audio", "subtitle"):
            saw_av = True
            assert isinstance(s["slot"], str) and s["slot"] in ids
        else:
            assert s["slot"] is None
    assert saw_av
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -m pytest tests/test_scan.py::test_scan_streams_have_slot_ids -v`
Expected: FAIL - `KeyError: 'slot'`.

- [ ] **Step 3: Add `streams_with_slots` and wire it into `run_scan`**

Add this helper next to `streams_with_channels` in `src/gen-editions.py`:

```python
def streams_with_slots(streams):
    """Return copies of the streams with the slot id attached (None for
    video/unknown kinds), using the same ids as compute_slots."""
    return [dict(s, slot=sid) for sid, s in slot_ids_for_clip(streams)]
```

In `run_scan`, the `clips[c] = {...}` literal currently sets
`"streams": streams_with_channels(cstreams.get(c, []), p["audio_channels"]),`.
Wrap that value with `streams_with_slots(...)`:

```python
                    "streams": streams_with_slots(
                        streams_with_channels(cstreams.get(c, []), p["audio_channels"])),
```

(`slot_ids_for_clip` already exists and yields `(slot_id_or_None, stream)` in STN order; `dict(s, slot=sid)` copies each stream so nothing is mutated.)

- [ ] **Step 4: Run the test + full suite**

Run: `python3 -m pytest tests/ -v`
Expected: the new test passes and all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/gen-editions.py tests/test_scan.py
git commit -m "Scan: emit per-stream slot id for track selection"
```

---

### Task 2: Renderer track-selection model + helpers

**Files:**
- Modify: `app/renderer/src/lib/model.ts`
- Modify: `app/renderer/src/lib/project.ts`
- Modify: `app/renderer/src/lib/project.test.ts`

**Interfaces:**
- Produces (in `model.ts`): `Stream` gains `slot?: string | null`; new `TrackSel { slot: string; keep: boolean; lang?: string; default?: boolean }`.
- Produces (in `project.ts`): `Project` gains `tracks: TrackSel[]`; `newProject` sets `tracks: []`; `toMkvedproj` emits `tracks: p.tracks`; `fromMkvedproj` reads `tracks`. New pure helpers:
  - `isSlotKept(p: Project, slot: string): boolean`
  - `toggleSlot(p: Project, slot: string, allSlotIds: string[]): Project`
  - `keptSummary(p: Project, allSlotIds: string[]): { kept: number; total: number; all: boolean }`
  - `missingKeptSlots(m: DiscModel, p: Project): { slot: string; missing: string[] }[]`

- [ ] **Step 1: Write the failing tests** (append to `app/renderer/src/lib/project.test.ts`)

Ensure the top imports include `newProject`, `toMkvedproj`, `fromMkvedproj`, and add `isSlotKept, toggleSlot, keptSummary, missingKeptSlots` to the `./project` import.

```ts
const ALL = ['audio:eng:ac3:1', 'audio:spa:ac3:1', 'subtitle:eng:pgs:1']
const proj = (tracks: any[] = []) => ({ ...newProject('/x'), tracks })

describe('track selection', () => {
  it('keeps everything by default', () => {
    const p = proj()
    expect(isSlotKept(p, 'audio:spa:ac3:1')).toBe(true)
    expect(keptSummary(p, ALL)).toEqual({ kept: 3, total: 3, all: true })
  })
  it('first uncheck materializes the full list minus that slot', () => {
    const p = toggleSlot(proj(), 'audio:spa:ac3:1', ALL)
    expect(p.tracks).toEqual([
      { slot: 'audio:eng:ac3:1', keep: true },
      { slot: 'audio:spa:ac3:1', keep: false },
      { slot: 'subtitle:eng:pgs:1', keep: true },
    ])
    expect(isSlotKept(p, 'audio:spa:ac3:1')).toBe(false)
    expect(keptSummary(p, ALL)).toEqual({ kept: 2, total: 3, all: false })
  })
  it('re-checking the last excluded collapses back to keep-all', () => {
    let p = toggleSlot(proj(), 'audio:spa:ac3:1', ALL)
    p = toggleSlot(p, 'audio:spa:ac3:1', ALL)
    expect(p.tracks).toEqual([])
    expect(keptSummary(p, ALL).all).toBe(true)
  })
  it('supports excluding everything (valid strip-all state)', () => {
    let p = proj()
    for (const s of ALL) p = toggleSlot(p, s, ALL)
    expect(p.tracks.every((t: any) => !t.keep)).toBe(true)
    expect(keptSummary(p, ALL)).toEqual({ kept: 0, total: 3, all: false })
  })
  it('round-trips tracks through toMkvedproj / fromMkvedproj', () => {
    const p = toggleSlot(proj(), 'audio:spa:ac3:1', ALL)
    const j = toMkvedproj(p) as any
    expect(j.tracks).toEqual(p.tracks)
    expect(fromMkvedproj(j).tracks).toEqual(p.tracks)
  })
})

describe('missingKeptSlots', () => {
  const model: any = {
    slots: [
      { id: 'audio:eng:ac3:1', missing_from: [] },
      { id: 'audio:spa:ac3:1', missing_from: ['00002'] },
    ],
  }
  it('is empty under keep-all', () => {
    const p = { ...newProject('/x'), editions: [{ name: 'A', clips: ['00001', '00002'] }] }
    expect(missingKeptSlots(model, p)).toEqual([])
  })
  it('flags a kept slot missing from a project clip', () => {
    let p: any = { ...newProject('/x'), editions: [{ name: 'A', clips: ['00001', '00002'] }] }
    p = toggleSlot(p, 'audio:eng:ac3:1', ['audio:eng:ac3:1', 'audio:spa:ac3:1'])
    expect(missingKeptSlots(model, p)).toEqual([{ slot: 'audio:spa:ac3:1', missing: ['00002'] }])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app/renderer && npx vitest run src/lib/project.test.ts`
Expected: FAIL - helpers not exported / `tracks` missing.

- [ ] **Step 3: Extend the types** in `app/renderer/src/lib/model.ts`

Add `slot` to `Stream` and add `TrackSel`:

```ts
export interface Stream {
  pid: number | null
  kind: 'video' | 'audio' | 'subtitle' | 'other'
  codec: string
  lang: string | null
  channels?: number | null
  slot?: string | null
}

export interface TrackSel { slot: string; keep: boolean; lang?: string; default?: boolean }
```

- [ ] **Step 4: Extend `project.ts`**

Update the imports at the top to also bring in the types:

```ts
import type { Playlist, DiscModel, TrackSel } from './model'
```

Add `tracks` to the `Project` interface:

```ts
export interface Project {
  bdmv: string; title: string; mode: 'flat' | 'linked' | 'xin1'
  preserve_chapters: boolean; qpfile: boolean; editions: ProjectEdition[]
  tracks: TrackSel[]
}
```

Set `tracks: []` in `newProject`:

```ts
export function newProject(bdmv: string): Project {
  return { bdmv, title: 'movie', mode: 'flat', preserve_chapters: false, qpfile: false, editions: [], tracks: [] }
}
```

In `toMkvedproj`, replace `tracks: [],` with `tracks: p.tracks,`.

In `fromMkvedproj`, add `tracks` to the returned object:

```ts
  return {
    bdmv: json.bdmv, title: json.title, mode: json.mode,
    preserve_chapters: !!json.preserve_chapters, qpfile: !!json.qpfile,
    editions: json.editions.map((e: any) => ({ name: e.name, clips: [...e.clips] })),
    tracks: Array.isArray(json.tracks) ? json.tracks : [],
  }
```

Append the helpers:

```ts
export function isSlotKept(p: Project, slot: string): boolean {
  if (p.tracks.length === 0) return true
  const t = p.tracks.find((x) => x.slot === slot)
  return t ? t.keep : true
}

export function toggleSlot(p: Project, slot: string, allSlotIds: string[]): Project {
  let tracks: TrackSel[]
  if (p.tracks.length === 0) {
    tracks = allSlotIds.map((s) => ({ slot: s, keep: s !== slot }))
  } else {
    tracks = p.tracks.map((t) => (t.slot === slot ? { ...t, keep: !t.keep } : t))
  }
  if (tracks.length > 0 && tracks.every((t) => t.keep)) tracks = []
  return { ...p, tracks }
}

export function keptSummary(p: Project, allSlotIds: string[]): { kept: number; total: number; all: boolean } {
  const total = allSlotIds.length
  if (p.tracks.length === 0) return { kept: total, total, all: true }
  const kept = allSlotIds.filter((s) => isSlotKept(p, s)).length
  return { kept, total, all: false }
}

export function missingKeptSlots(m: DiscModel, p: Project): { slot: string; missing: string[] }[] {
  if (p.tracks.length === 0) return []
  const used = new Set<string>()
  for (const e of p.editions) for (const c of e.clips) used.add(c)
  const out: { slot: string; missing: string[] }[] = []
  for (const sl of m.slots) {
    if (!isSlotKept(p, sl.id)) continue
    const missing = sl.missing_from.filter((c) => used.has(c))
    if (missing.length) out.push({ slot: sl.id, missing })
  }
  return out
}
```

- [ ] **Step 5: Run the test + fix construction sites + full renderer check**

`Project` now requires `tracks`, so any test fixture or code that builds a `Project` object literal (not via `newProject`) must add `tracks: []`. Run:

Run: `cd app/renderer && npx vitest run && npm run check`
Expected: all tests pass; svelte-check 0 errors 0 warnings. Fix any strict-null/missing-field error from the new required `tracks` at the construction site (add `tracks: []`); do not weaken the type. `fromMkvedproj`'s existing tests still pass (a project without `tracks` reads back `tracks: []`).

- [ ] **Step 6: Commit**

```bash
git add app/renderer/src/lib/model.ts app/renderer/src/lib/project.ts app/renderer/src/lib/project.test.ts
git commit -m "Model: track-selection state (Project.tracks) + slot helpers"
```

---

### Task 3: DetailPanel track checkboxes + note + caution

**Files:**
- Modify: `app/renderer/src/lib/components/DetailPanel.svelte`
- Modify: `app/renderer/src/lib/components/DetailPanel.test.ts`

**Interfaces:**
- Consumes: `isSlotKept`, `keptSummary`, `missingKeptSlots` from `$lib/project`; `fmtChannels` from `$lib/model`; `Project` type.
- Produces: `DetailPanel` props gain `project: Project | null` and `ontoggleslot?: (slot: string) => void`. The clip view renders a checkbox per non-video stream, a keep-count note, and a missing-track caution.

- [ ] **Step 1: Write the failing test** (update `app/renderer/src/lib/components/DetailPanel.test.ts`)

Update the existing `model` fixture so its clip streams carry `slot` ids and the model has matching `slots`, then add the track-selection cases. Replace the `clips`/`slots` parts of the fixture and append the tests:

```ts
// in the existing model fixture, give the clip these streams and add slots:
//   streams: [
//     { pid: 1, kind: 'video', codec: 'h264', lang: null, slot: null },
//     { pid: 2, kind: 'audio', codec: 'ac3', lang: 'eng', channels: 6, slot: 'audio:eng:ac3:1' },
//     { pid: 3, kind: 'audio', codec: 'ac3', lang: 'spa', channels: 6, slot: 'audio:spa:ac3:1' },
//   ],
//   ...
//   slots: [
//     { id: 'audio:eng:ac3:1', kind: 'audio', lang: 'eng', codec: 'ac3', ordinal: 1, present_in: ['00368'], missing_from: [] },
//     { id: 'audio:spa:ac3:1', kind: 'audio', lang: 'spa', codec: 'ac3', ordinal: 1, present_in: ['00368'], missing_from: [] },
//   ],

import { newProject, toggleSlot } from '$lib/project'

it('renders a checkbox per audio stream and fires ontoggleslot', async () => {
  const { fireEvent } = await import('@testing-library/svelte')
  const project = { ...newProject('/x/BDMV'), editions: [{ name: 'A', clips: ['00368'] }] }
  const ontoggleslot = vi.fn()
  render(DetailPanel, { model, selected: { kind: 'clip', id: '00368' }, project, ontoggleslot })
  const boxes = screen.getAllByRole('checkbox')
  expect(boxes.length).toBe(2)
  await fireEvent.click(boxes[1])
  expect(ontoggleslot).toHaveBeenCalledWith('audio:spa:ac3:1')
})

it('shows the keep-count note when narrowed', () => {
  const project = toggleSlot(
    { ...newProject('/x/BDMV'), editions: [{ name: 'A', clips: ['00368'] }] },
    'audio:spa:ac3:1',
    ['audio:eng:ac3:1', 'audio:spa:ac3:1'],
  )
  render(DetailPanel, { model, selected: { kind: 'clip', id: '00368' }, project, ontoggleslot: () => {} })
  expect(screen.getByText(/Keeping 1 of 2 tracks/i)).toBeInTheDocument()
})
```

(Ensure `vi` and `screen` are imported at the top of the file - they are already used by the existing DetailPanel tests. The existing three DetailPanel tests must keep passing; add `project: null, ontoggleslot: () => {}` to their `render(...)` calls if TypeScript requires the new props, or leave them if the props are optional - see Step 2: `project` is required-nullable, so pass `project: null`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/components/DetailPanel.test.ts`
Expected: FAIL - no checkboxes rendered / props not accepted.

- [ ] **Step 3: Update `DetailPanel.svelte`**

Change the script imports and props:

```svelte
<script lang="ts">
  import type { DiscModel } from '$lib/model'
  import type { Project } from '$lib/project'
  import { chapterCount, fmtResolution, fmtChannels, playlistRows, fmtDuration } from '$lib/model'
  import { isSlotKept, keptSummary, missingKeptSlots } from '$lib/project'
  let { model, selected, project, ontoggleslot }: {
    model: DiscModel | null
    selected: { kind: 'clip' | 'playlist'; id: string } | null
    project: Project | null
    ontoggleslot?: (slot: string) => void
  } = $props()

  let clip = $derived(
    model && selected?.kind === 'clip' ? model.clips[selected.id] : null,
  )
  let allSlotIds = $derived(model ? model.slots.map((s) => s.id) : [])
  let plRow = $derived(
    model && selected?.kind === 'playlist'
      ? playlistRows(model).find((r) => r.file === selected.id)
      : null,
  )
  let pl = $derived(
    model && selected?.kind === 'playlist'
      ? model.playlists.find((p) => p.file === selected.id)
      : null,
  )
</script>
```

(Note: `clipStreamSummary` is no longer imported here; it remains exported and unit-tested in `model.ts`.)

Replace the clip streams block (the `<div class="mt-1"> ... {#each clipStreamSummary(clip) as line} ... </div>`) with:

```svelte
    <div class="mt-1">
      {#if clip.tracks.length === 0}
        <div class="text-red-400">unreadable</div>
      {:else}
        {#if project}
          {@const sum = keptSummary(project, allSlotIds)}
          <div class="opacity-60">{sum.all ? 'Keeping all tracks' : `Keeping ${sum.kept} of ${sum.total} tracks - applies to every clip`}</div>
        {/if}
        {#each clip.streams.filter((s) => s.kind !== 'video') as s}
          <div class="flex items-center gap-2">
            {#if s.slot && project}
              <input type="checkbox" checked={isSlotKept(project, s.slot)} onchange={() => ontoggleslot?.(s.slot as string)} />
            {/if}
            <span class="opacity-80 {s.slot && project && !isSlotKept(project, s.slot) ? 'line-through opacity-40' : ''}">{s.kind} {s.codec}{s.lang ? ' ' + s.lang : ''}{s.kind === 'audio' && s.channels ? ' ' + fmtChannels(s.channels) : ''}</span>
          </div>
        {/each}
        {#if model && project}
          {@const miss = missingKeptSlots(model, project)}
          {#if miss.length}
            <div class="mt-1 text-amber-400">{miss.length} kept track(s) missing from some clips - build fails in flat/xin1: {miss.map((x) => x.slot).join(', ')}</div>
          {/if}
        {/if}
      {/if}
    </div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/components/DetailPanel.test.ts`
Expected: PASS (new cases + the three existing DetailPanel tests).

- [ ] **Step 5: Typecheck**

Run: `cd app/renderer && npm run check`
Expected: 0 errors 0 warnings. If svelte-check flags the checkbox `<input>` a11y (label association), resolve with a targeted single-rule `<!-- svelte-ignore <rule> -->` only; do not loosen types.

- [ ] **Step 6: Commit**

```bash
git add app/renderer/src/lib/components/DetailPanel.svelte app/renderer/src/lib/components/DetailPanel.test.ts
git commit -m "DetailPanel: per-stream include/exclude checkboxes, keep note, missing caution"
```

---

### Task 4: Wire selection into the shell

**Files:**
- Modify: `app/renderer/src/routes/+page.svelte`

**Interfaces:**
- Consumes: `toggleSlot` from `$lib/project`; the `DetailPanel` props `project`/`ontoggleslot`.
- Produces: the DetailPanel receives the live `project` and a toggle handler over the disc's slot ids.

- [ ] **Step 1: Add the import and derived slot ids** in `+page.svelte`

Add `toggleSlot` to the existing `$lib/project` import. Near the other `$derived` lines add:

```ts
  let allSlotIds = $derived(model ? model.slots.map((s) => s.id) : [])
```

- [ ] **Step 2: Pass the props to DetailPanel**

Find the `<DetailPanel {model} {selected} />` element and change it to:

```svelte
        <DetailPanel {model} {selected} {project} ontoggleslot={(sid) => apply((p) => toggleSlot(p, sid, allSlotIds))} />
```

(`apply` already exists in `+page.svelte` and updates `project` reactively.)

- [ ] **Step 3: Build + typecheck + full suites**

Run: `cd app && npm run build && npm run check --workspace renderer && npx vitest run electron && cd renderer && npx vitest run`
Expected: build clean; svelte-check 0 errors 0 warnings; all electron and renderer tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/routes/+page.svelte
git commit -m "Shell: wire track selection into the DetailPanel"
```

---

## Real-disc validation (after Task 4)

With `/mnt/br` mounted, `../run-app.sh`, Open folder on `/mnt/br`, select a readable clip in the detail panel:
- Each audio/subtitle row shows a checkbox; all checked, note reads "Keeping all tracks".
- Uncheck the Spanish audio: the row strikes through, the note reads "Keeping N of M tracks - applies to every clip".
- Build via the Build modal and confirm the output MKV has no Spanish audio; re-check to return to keep-all.
- Narrow to a slot a decoy clip lacks (add that clip to an edition) and confirm the amber caution appears before building.

## Self-review notes

- Spec coverage: scan `slot` emission (T1); `Project.tracks` + serialization + the four helpers (T2); DetailPanel checkboxes, keep-note, caution (T3); shell wiring (T4).
- Contract reuse: `toMkvedproj` now emits the real `tracks` (was hardcoded `[]`), which `gen-editions.py`'s existing `clip_track_opts`/`check_track_layout` already consume; no build-engine change.
- Keep-all vs allow-list: `tracks: []` = keep all; `toggleSlot` materializes the full list on first narrow and collapses back to `[]` when all kept, so the common case stays clean and the CLI default (keep all) is preserved.
- Type consistency: `TrackSel`/`Stream.slot` defined in `model.ts` (T2) and consumed by `project.ts` (T2) and `DetailPanel` (T3); `isSlotKept`/`toggleSlot`/`keptSummary`/`missingKeptSlots` defined in T2, used in T3/T4; `ontoggleslot(slot: string)` matches between DetailPanel (T3) and the `+page` handler (T4).
- Renderer stays fs-free: no `window.api` needed; selection is pure project state persisted via the existing `saveProject`/build path.
- `clipStreamSummary` remains an exported, unit-tested helper in `model.ts` though the DetailPanel now formats stream rows inline (it needs the per-stream object for the checkbox); left in place rather than removed.
