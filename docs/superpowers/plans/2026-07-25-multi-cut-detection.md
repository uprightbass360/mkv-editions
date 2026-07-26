# Multi-cut auto-detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect a disc's distinct feature cuts and import them as separate editions named by runtime, instead of importing a single feature playlist.

**Architecture:** A pure `detectCuts(model)` in `model.ts` (ratio filter + relative length floor + clip-sequence dedup + near-runtime merge) returns representative playlists; a new `importCut(project, pl, baseName)` in `project.ts` imports one with runtime-based edition names (angles still expand); `scanInto` in `+page.svelte` imports each cut, with a single-feature fallback.

**Tech Stack:** SvelteKit renderer (Svelte 5 runes, vitest jsdom). No CLI / scan change.

## Global Constraints

- NO em-dashes anywhere (code, comments, commit messages). Use "-" or reword.
- Renderer-only; no change to the CLI, scan JSON, `.mkvedproj` contract, or build.
- Svelte 5 runes; lowercase handlers; NO createEventDispatcher.
- Thresholds (from the spec, exact): items/clips ratio `<= 1.2`; feature floor `>= 0.6 * longest candidate runtime`; near-equal-runtime merge window `3 minutes`; representative = most angles, then longest runtime, then lowest `file`; order shortest-first; cap `6`.
- Renderer bar: `npm run check` 0 errors AND 0 warnings, all tests passing; `npm run build` clean.

---

### Task 1: detectCuts + playlistRuntimeNs (model.ts)

**Files:**
- Modify: `app/renderer/src/lib/model.ts`
- Modify: `app/renderer/src/lib/model.test.ts`

**Interfaces:**
- Produces: `playlistRuntimeNs(m: DiscModel, pl: Playlist): number` (sum of `pl.editions[0].clips` durations); `detectCuts(m: DiscModel): Playlist[]` (distinct feature cuts as representative playlists, shortest-first, capped 6, `[]` when no clear feature).

- [ ] **Step 1: Write the failing tests** (append to `app/renderer/src/lib/model.test.ts`)

```ts
import { detectCuts, playlistRuntimeNs } from './model'

const nmin = (m: number) => m * 60 * 1_000_000_000
function mk(clipMins: Record<string, number>, pls: { file: string; clips: string[]; angles?: number }[]): any {
  const clips: any = {}
  for (const [id, mm] of Object.entries(clipMins)) clips[id] = { dur_ns: nmin(mm) }
  return { clips, playlists: pls.map((p) => ({ file: p.file, angles: p.angles ?? 1, editions: [{ name: p.file, clips: p.clips }] })) }
}

describe('detectCuts', () => {
  it('returns the distinct-length cuts, deduped, shortest-first (Avatar-like)', () => {
    const m = mk(
      { ce: 30, cs: 25, ct: 20, cb: 5, cd: 6 },
      [
        { file: '00003', clips: ['ce'] }, { file: '00802', clips: ['ce'] }, // Extended + dup
        { file: '00002', clips: ['cs'] }, // Special Ed
        { file: '00001', clips: ['ct'] }, // Theatrical
        { file: '00005', clips: ['ce', 'cs', 'ct', 'ce'] }, // superset, ratio 4/3=1.33 -> excluded
        { file: '00019', clips: ['cb'] }, // 5min bonus -> below 60% floor
        { file: '00720', clips: ['cd', 'cd', 'cd'] }, // loop decoy, ratio 3 -> excluded
      ],
    )
    expect(detectCuts(m).map((p) => p.file)).toEqual(['00001', '00002', '00003'])
  })
  it('merges same-length 2D/3D into one, keeping the richer (Blade-Runner-like)', () => {
    const m = mk(
      { c2d: 40, c3da: 39, c3db: 2, cd: 6 },
      [
        { file: '00342', clips: ['c2d'], angles: 1 }, // 2D, 40min
        { file: '00334', clips: ['c3da', 'c3db'], angles: 2 }, // 3D, 41min, 2 angles
        { file: '00720', clips: ['cd', 'cd', 'cd'] }, // decoy
      ],
    )
    expect(detectCuts(m).map((p) => p.file)).toEqual(['00334'])
  })
  it('returns one for a single-feature disc', () => {
    const m = mk({ a: 20, d: 6 }, [{ file: '00001', clips: ['a'] }, { file: '00720', clips: ['d', 'd', 'd'] }])
    expect(detectCuts(m).map((p) => p.file)).toEqual(['00001'])
  })
  it('returns [] when there is no linear feature (all decoys)', () => {
    const m = mk({ d: 6 }, [{ file: '00720', clips: ['d', 'd', 'd', 'd'] }])
    expect(detectCuts(m)).toEqual([])
  })
  it('playlistRuntimeNs sums the clip durations', () => {
    const m = mk({ a: 10, b: 5 }, [{ file: '00001', clips: ['a', 'b'] }])
    expect(playlistRuntimeNs(m, m.playlists[0])).toBe(nmin(15))
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app/renderer && npx vitest run src/lib/model.test.ts`
Expected: FAIL - `detectCuts` / `playlistRuntimeNs` not exported.

- [ ] **Step 3: Implement in `app/renderer/src/lib/model.ts`** (append; `Playlist`/`DiscModel` types already defined in the file)

```ts
export function playlistRuntimeNs(m: DiscModel, pl: Playlist): number {
  const cs = pl.editions[0]?.clips ?? []
  return cs.reduce((s, c) => s + (m.clips[c]?.dur_ns ?? 0), 0)
}

/** The disc's distinct feature cuts as representative playlists, shortest
 * first (cap 6). Empty when there is no clear feature - the caller falls back
 * to longestRealPlaylist. Uses items/clips ratio, a relative length floor,
 * clip-sequence dedup, and a near-runtime merge; no clip-overlap (a branching
 * superset overlaps a real cut, so overlap cannot separate them). */
export function detectCuts(m: DiscModel): Playlist[] {
  const clipsOf = (p: Playlist) => p.editions[0]?.clips ?? []
  // 1. linear candidates: near 1:1 items/clips (drops branching supersets + loops)
  const linear = m.playlists.filter((p) => {
    const cs = clipsOf(p)
    return cs.length > 0 && cs.length / new Set(cs).size <= 1.2
  })
  if (linear.length === 0) return []
  // 2. feature-length: >= 60% of the longest candidate
  const longest = Math.max(...linear.map((p) => playlistRuntimeNs(m, p)))
  const feature = linear.filter((p) => playlistRuntimeNs(m, p) >= 0.6 * longest)
  // 3. dedup identical clip sequences (keep the lowest file id)
  const bySeq = new Map<string, Playlist>()
  for (const p of feature) {
    const key = clipsOf(p).join('>')
    const cur = bySeq.get(key)
    if (!cur || p.file < cur.file) bySeq.set(key, p)
  }
  // 4. merge near-equal runtimes (within 3 min); keep the richer representative
  const NEAR = 3 * 60 * 1_000_000_000
  const richer = (a: Playlist, b: Playlist) =>
    a.angles !== b.angles
      ? a.angles > b.angles
      : playlistRuntimeNs(m, a) !== playlistRuntimeNs(m, b)
        ? playlistRuntimeNs(m, a) > playlistRuntimeNs(m, b)
        : a.file < b.file
  const reps: Playlist[] = []
  for (const p of [...bySeq.values()].sort((a, b) => playlistRuntimeNs(m, b) - playlistRuntimeNs(m, a))) {
    const d = playlistRuntimeNs(m, p)
    const gi = reps.findIndex((r) => Math.abs(playlistRuntimeNs(m, r) - d) <= NEAR)
    if (gi < 0) reps.push(p)
    else if (richer(p, reps[gi])) reps[gi] = p
  }
  // 5. shortest first, cap at 6
  reps.sort((a, b) => playlistRuntimeNs(m, a) - playlistRuntimeNs(m, b))
  return reps.slice(0, 6)
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app/renderer && npx vitest run src/lib/model.test.ts`
Expected: PASS (5 new cases + the existing model tests).

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/lib/model.ts app/renderer/src/lib/model.test.ts
git commit -m "Model: detectCuts - distinct feature cuts (ratio + floor + near-runtime merge)"
```

---

### Task 2: importCut (project.ts)

**Files:**
- Modify: `app/renderer/src/lib/project.ts`
- Modify: `app/renderer/src/lib/project.test.ts`

**Interfaces:**
- Produces: `importCut(p: Project, pl: Playlist, baseName: string): Project` - appends the playlist's editions named by `baseName`, preserving angle expansion (edition 0 = `baseName`, edition i>0 = `` `${baseName} (Angle ${i + 1})` ``).

- [ ] **Step 1: Write the failing test** (append to `app/renderer/src/lib/project.test.ts`)

```ts
import { importCut } from './project'

describe('importCut', () => {
  it('names editions by the base name, preserving angle suffixes', () => {
    const pl: any = { file: '00334', angles: 2, editions: [
      { name: '00334', clips: ['a', 'b'] },
      { name: '00334 (Angle 2)', clips: ['a', 'c'] },
    ] }
    const p = importCut(newProject('/x'), pl, '2:43:00')
    expect(p.editions.map((e) => e.name)).toEqual(['2:43:00', '2:43:00 (Angle 2)'])
    expect(p.editions.map((e) => e.clips)).toEqual([['a', 'b'], ['a', 'c']])
  })
  it('names a single-edition cut with just the base name', () => {
    const pl: any = { file: '00001', angles: 1, editions: [{ name: '00001', clips: ['a'] }] }
    const p = importCut(newProject('/x'), pl, '2:20:00')
    expect(p.editions.map((e) => e.name)).toEqual(['2:20:00'])
  })
})
```

(`newProject` is already imported at the top of `project.test.ts`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/project.test.ts`
Expected: FAIL - `importCut` not exported.

- [ ] **Step 3: Implement** in `app/renderer/src/lib/project.ts` (append near `importPlaylist`; `Playlist` type is already imported there)

```ts
export function importCut(p: Project, pl: Playlist, baseName: string): Project {
  const added = pl.editions.map((e, i) => ({
    name: i === 0 ? baseName : `${baseName} (Angle ${i + 1})`,
    clips: [...e.clips],
  }))
  return { ...p, editions: [...p.editions, ...added] }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/project.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/lib/project.ts app/renderer/src/lib/project.test.ts
git commit -m "Project: importCut - import a cut with runtime-named editions (angles preserved)"
```

---

### Task 3: Wire detectCuts + importCut into scanInto

**Files:**
- Modify: `app/renderer/src/routes/+page.svelte`

**Interfaces:**
- Consumes: `detectCuts`, `playlistRuntimeNs`, `fmtDuration` from `$lib/model`; `importCut` from `$lib/project`.
- Produces: on scan, the project is populated with one edition per detected cut (named by runtime), falling back to the single longest real playlist when none are detected.

- [ ] **Step 1: Add imports** in `+page.svelte`

In the `$lib/model` import (currently `libraryClips, playlistRows, longestRealPlaylist, unreadableRatio, chapterCount, type DiscModel`), add `detectCuts`, `playlistRuntimeNs`, and `fmtDuration`:

```ts
  import { libraryClips, playlistRows, longestRealPlaylist, unreadableRatio, chapterCount, detectCuts, playlistRuntimeNs, fmtDuration, type DiscModel } from '$lib/model'
```

In the `$lib/project` import, add `importCut` (keep `importPlaylist` - it is still used by the Playlists panel's `onimport`).

- [ ] **Step 2: Replace the auto-import block in `scanInto`**

Replace this existing block:

```ts
      let p = newProject(model.bdmv)
      const feat = longestRealPlaylist(model)
      if (feat) {
        const pl = model.playlists.find((x) => x.file === feat)!
        p = importPlaylist(p, pl)
        progress = `scan complete - suggested feature ${feat}`
      } else progress = 'scan complete'
      project = p
```

with:

```ts
      let p = newProject(model.bdmv)
      let cuts = detectCuts(model)
      if (cuts.length === 0) {
        const feat = longestRealPlaylist(model)
        const pl = feat ? model.playlists.find((x) => x.file === feat) : undefined
        if (pl) cuts = [pl]
      }
      for (const pl of cuts) p = importCut(p, pl, fmtDuration(playlistRuntimeNs(model, pl)))
      progress = cuts.length ? `scan complete - ${cuts.length} edition(s)` : 'scan complete'
      project = p
```

(The `selected = null`, `baseline = p`, and `history = emptyHistory()` lines around it stay unchanged.)

- [ ] **Step 3: Build + typecheck + full suites**

Run: `cd app && npm run build && npm run check --workspace renderer && npx vitest run electron && cd renderer && npx vitest run`
Expected: build clean; svelte-check 0 errors 0 warnings; all electron and renderer tests pass. Confirm no now-unused import (`importPlaylist` and `longestRealPlaylist` are both still used).

- [ ] **Step 4: Commit**

```bash
git add app/renderer/src/routes/+page.svelte
git commit -m "Shell: auto-import detected cuts as runtime-named editions (fallback to longest)"
```

---

## Real-disc validation (after Task 3)

- `/mnt/avatar`: File -> Open folder on `/mnt/avatar` auto-creates **3 editions** named `2:41:43` / `2:50:35` / `2:58:11` (no superset, no 44-min bonus), each buildable.
- `/mnt/br`: **one** movie's **2 angle editions** (unchanged count), now named by runtime (e.g. `2:43:xx` / `2:43:xx (Angle 2)`).
- A normal single-feature disc: one runtime-named edition (unchanged count/content).

## Self-review notes

- Spec coverage: `detectCuts` ratio+floor+dedup+near-merge+cap (T1); runtime-named `importCut` with angle expansion (T2); scanInto wiring + single-feature fallback + count progress (T3).
- No clip-overlap in the algorithm (validated: a superset overlaps a cut 80%, BR 2D/3D share a clip - overlap cannot discriminate). Distinctness is by runtime; format variants (same length) merge; the branching superset is dropped by ratio; the short bonus by the relative floor.
- Regression safety: single-feature and multi-angle discs return one version; angle expansion still happens in `importCut`; a degenerate disc returns `[]` and `scanInto` falls back to `longestRealPlaylist`. The only user-visible change on non-multi-cut discs is the edition label (runtime instead of playlist id).
- Type consistency: `detectCuts`/`playlistRuntimeNs` (T1) consumed by `scanInto` (T3); `importCut(p, pl, baseName)` (T2) matches the T3 call; `fmtDuration` already exists in `model.ts`.
- Renderer stays fs-free; `detectCuts` is a pure transform over the existing scan model.
