# Descriptive Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface more of a disc's own metadata to identify clips and playlists - chapter counts, real audio/subtitle languages+codecs+channels, video resolution, and the disc title+poster - via additive scan fields and a new bottom detail panel.

**Architecture:** The Python CLI's `--scan-json` gains per-clip `width`/`height`, a `channels` field on each audio stream, and a top-level `disc: {title, poster}` from `BDMV/META`. The Electron main process enriches the poster path into a base64 data URL so the renderer stays filesystem-free. The renderer adds pure model helpers, a `DetailPanel.svelte` (clip / playlist / disc-overview states) driven by a `selected` state, chapter-count row cues, and a header disc-title label. Nothing in authoring, the `.mkvedproj` contract, or the build path changes.

**Tech Stack:** Python 3 stdlib + ffprobe (CLI); Electron main (tsup CJS, Node fs); SvelteKit adapter-static renderer (Svelte 5 runes, Tailwind 4 with ARM tokens); pytest, vitest (node + jsdom).

**Spec:** `docs/superpowers/specs/2026-07-24-descriptive-metadata-design.md`

## Global Constraints

- No em-dashes in any repo file. Use "-".
- The renderer NEVER imports electron/fs/child_process; it calls `window.api.*` only.
- Additive to the scan contract: existing `--scan-json` keys and all `--project`/build behavior are unchanged. The round-trip and existing pytest suite must stay green.
- Svelte 5 idioms only: `$props`/`$state`/`$derived`, callback props, lowercase handlers, `bind:`. NO `createEventDispatcher`, NO `on:` directives.
- Zero Svelte compiler warnings (svelte-check 0 errors 0 WARNINGS). Only a targeted single-rule `<!-- svelte-ignore ... -->` is acceptable.
- Use the ARM design tokens already in `app.css` for any new UI (bg-surface/bg-page/border-primary-border/text-primary-text with dark: variants), matching the existing components.
- Python stdlib only in `src/` and `samples/`. pytest is dev-only.
- Two renderer test runners: electron-side `cd app && npx vitest run`; renderer `cd app/renderer && npx vitest run`. Python: `python3 -m pytest tests/ -v`.

## Verified current code this plan modifies

- `src/gen-editions.py`:
  - `frame_info(path, count=True) -> (codec, frames, num, den)` via `ffprobe -select_streams v:0 -show_entries stream=codec_name,r_frame_rate,nb_frames`. Called once, in `probe_clip`: `codec, frames, num, den = frame_info(path, count=not fast)`.
  - `probe_clip(...)` returns and caches `got = {"codec", "frames", "fps":[num,den], "dur_ns", "tracks"}`. Cache read returns `got` when `fast or got["frames"] is not None`.
  - `run_scan(args)` builds `clips[c] = {"path","frames","fps","dur_ns","codec","exact","marks_ns","streams","tracks"}` (streams from `cstreams.get(c, [])`, each `{"pid","kind","codec","lang"}`), and prints `json.dumps({"bdmv","clips","playlists","slots","warnings"})`.
- `samples/make-sample.py`: `make_segment` encodes `color=c=<colour>:s=1280x720:d=<dur>:r=24` video + `-c:a ac3 -ac 2` audio into each `.m2ts`. No `BDMV/META` today.
- `app/electron/scan.ts`: `scanDisc(...)` resolves `{ ok: true, data: JSON.parse(out) }` on exit 0.
- `app/renderer/src/lib/model.ts`: `Stream {pid, kind, codec, lang}`; `Clip {path, frames, fps:[number,number], dur_ns, codec, exact, marks_ns, streams, tracks}`; `DiscModel {bdmv, clips, playlists, slots, warnings}`.
- Renderer components use ARM tokens; `+page.svelte` has a 3-column `<main class="grid h-[calc(100vh-52px)] grid-cols-[220px_1fr_300px] gap-2.5 p-2.5">`, a `clipInfo` derived map, and `EditionTracks {clipInfo}`.

## File Structure

```
src/gen-editions.py         frame_info +width/height; probe_clip +audio_channels + cache guard;
                            run_scan merges channels + emits width/height + disc; new disc_meta()
samples/make-sample.py      writes BDMV/META/DL/bdmt_eng.xml + a poster JPG
tests/test_scan.py          (extend) width/height/channels/disc assertions
app/electron/scan.ts        poster path -> data URL enrichment
app/electron/scan.test.ts   (extend) enrichment unit test
app/renderer/src/lib/model.ts        +Clip.width/height, Stream.channels, Disc type, DiscModel.disc;
                                      chapterCount/fmtChannels/fmtResolution/clipStreamSummary
app/renderer/src/lib/model.test.ts   (extend) helper tests
app/renderer/src/lib/components/DetailPanel.svelte   the bottom panel (+ .test.ts)
app/renderer/src/lib/components/ClipLibrary.svelte    +onselect + chapter cue
app/renderer/src/lib/components/PlaylistPicker.svelte +onselect + chapter cue + import stopPropagation
app/renderer/src/lib/components/EditionTracks.svelte  +onselect on cards
app/renderer/src/routes/+page.svelte  selected state, DetailPanel strip, header disc title, layout
```

---

### Task 1: Scan adds video resolution and audio channels

**Files:**
- Modify: `src/gen-editions.py` (`frame_info`, `probe_clip`, `run_scan`)
- Modify: `tests/test_scan.py`

**Interfaces:**
- Produces (scan JSON): each clip gains `"width": int|null`, `"height": int|null`; each audio entry in a clip's `"streams"` gains `"channels": int|null`. `probe_clip`'s cached dict gains `"width"`, `"height"`, `"audio_channels": [int|null,...]` (channel count per audio stream in ffprobe order).

- [ ] **Step 1: Write the failing test** (append to `tests/test_scan.py`)

```python
def test_scan_has_resolution_and_channels(sample_bd):
    r = run_cli([str(sample_bd), "--scan-json", "--fast"])
    assert r.returncode == 0, r.stderr
    doc = json.loads(r.stdout)
    c = doc["clips"]["00001"]
    assert c["width"] == 1280 and c["height"] == 720
    auds = [s for s in c["streams"] if s["kind"] == "audio"]
    assert auds and all(s["channels"] == 2 for s in auds)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -m pytest tests/test_scan.py::test_scan_has_resolution_and_channels -v`
Expected: FAIL - `KeyError: 'width'`.

- [ ] **Step 3: Extend `frame_info` to also return width/height**

In `src/gen-editions.py`, change the video probe query and return tuple:

```python
def frame_info(path, count=True):
    """(codec, frames|None, fps_num, fps_den, width|None, height|None)."""
    def probe(extra):
        return subprocess.check_output(
            ["ffprobe", "-v", "0", "-select_streams", "v:0"] + extra + [path]).decode()
    d = dict(l.split("=", 1) for l in probe(
        ["-show_entries", "stream=codec_name,r_frame_rate,nb_frames,width,height", "-of", "default=nw=1"]
    ).splitlines() if "=" in l)
    rfr = (d.get("r_frame_rate", "0/1").split("/") + ["1"])[:2]
    num, den = int(rfr[0]), int(rfr[1] or 1)
    nbf = d.get("nb_frames", "N/A")
    if not nbf.isdigit() and count:
        d2 = dict(l.split("=", 1) for l in probe(
            ["-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "default=nw=1"]
        ).splitlines() if "=" in l)
        nbf = d2.get("nb_read_frames", "N/A")
    w = int(d["width"]) if d.get("width", "").isdigit() else None
    h = int(d["height"]) if d.get("height", "").isdigit() else None
    return d.get("codec_name", ""), (int(nbf) if nbf.isdigit() else None), num, den, w, h
```

- [ ] **Step 4: Add an audio-channels probe and extend `probe_clip`**

Add near `frame_info`:

```python
def audio_channels(path):
    """Channel count per audio stream, in ffprobe (PMT) order; None where unknown."""
    out = subprocess.check_output(
        ["ffprobe", "-v", "0", "-select_streams", "a", "-show_entries",
         "stream=channels", "-of", "default=nw=1:nk=1", path]).decode()
    res = []
    for line in out.splitlines():
        line = line.strip()
        res.append(int(line) if line.isdigit() else None)
    return res
```

In `probe_clip`, (a) skip a cache hit that predates these fields, and (b) capture the new data:

```python
        try:
            got = json.load(open(cf))
            if ("width" in got) and (fast or got["frames"] is not None):
                return got
        except (json.JSONDecodeError, OSError):
            pass
    codec, frames, num, den, width, height = frame_info(path, count=not fast)
    tracks = [{"tid": t["id"], "type": t["type"],
               "pid": t.get("properties", {}).get("number")}
              for t in json.loads(subprocess.check_output(
                  ["mkvmerge", "-J", path]))["tracks"]]
    got = {"codec": codec, "frames": frames, "fps": [num, den],
           "dur_ns": clip_duration_ns(frames, num, den, path),
           "width": width, "height": height,
           "audio_channels": audio_channels(path), "tracks": tracks}
```

(The `"width" in got` guard makes an old-schema cache entry re-probe instead of `KeyError`.)

- [ ] **Step 5: Merge channels + resolution into the scan model in `run_scan`**

Add a helper above `run_scan`:

```python
def streams_with_channels(streams, chans):
    """Return a copy of the STN streams with `channels` on each audio entry,
    matched to the ffprobe channel list by audio order."""
    out, ai = [], 0
    for s in streams:
        s = dict(s)
        if s.get("kind") == "audio":
            s["channels"] = chans[ai] if ai < len(chans) else None
            ai += 1
        out.append(s)
    return out
```

In `run_scan`, replace the `clips[c] = {...}` assignment with:

```python
        clips[c] = {"path": os.path.abspath(path), "frames": p["frames"],
                    "fps": p["fps"], "dur_ns": p["dur_ns"],
                    "codec": p["codec"], "exact": p["frames"] is not None,
                    "width": p["width"], "height": p["height"],
                    "marks_ns": cmarks.get(c, []),
                    "streams": streams_with_channels(cstreams.get(c, []), p["audio_channels"]),
                    "tracks": p["tracks"]}
```

- [ ] **Step 6: Run the test + full pytest suite**

Run: `python3 -m pytest tests/ -v`
Expected: the new test passes and all existing tests still pass. (If a warm `./cache` exists from earlier runs, the `"width" in got` guard re-probes it; that is intended.)

- [ ] **Step 7: Commit**

```bash
git add src/gen-editions.py tests/test_scan.py
git commit -m "Scan: per-clip resolution (width/height) and per-audio channels"
```

---

### Task 2: Scan emits disc title + poster from BDMV/META

**Files:**
- Modify: `src/gen-editions.py` (new `disc_meta`, `run_scan` emits `disc`)
- Modify: `samples/make-sample.py` (write META xml + poster JPG)
- Modify: `tests/test_scan.py`

**Interfaces:**
- Produces (scan JSON): top-level `"disc": {"title": str|null, "poster": str|null}` (poster is an absolute path to the largest image in `BDMV/META/DL`, or null).
- `disc_meta(bdmv: str) -> dict` with keys `title`, `poster`.
- Sample generator writes `BDMV/META/DL/bdmt_eng.xml` (disc name "Sample Disc") and `BDMV/META/DL/poster.jpg`.

- [ ] **Step 1: Write the failing test** (append to `tests/test_scan.py`)

```python
def test_scan_has_disc_meta(sample_bd):
    doc = json.loads(run_cli([str(sample_bd), "--scan-json", "--fast"]).stdout)
    assert doc["disc"]["title"] == "Sample Disc"
    assert doc["disc"]["poster"] and doc["disc"]["poster"].endswith(".jpg")

def test_scan_disc_meta_absent(tmp_path, ge):
    # a BDMV with a PLAYLIST but no META -> nulls, no crash
    import os
    bd = tmp_path / "BDMV"
    (bd / "PLAYLIST").mkdir(parents=True)
    (bd / "STREAM").mkdir()
    assert ge.disc_meta(str(bd)) == {"title": None, "poster": None}
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -m pytest tests/test_scan.py::test_scan_has_disc_meta tests/test_scan.py::test_scan_disc_meta_absent -v`
Expected: FAIL - `KeyError: 'disc'` and `disc_meta` not defined. (`test_scan_has_disc_meta` also needs the sample META, added in Step 4.)

- [ ] **Step 3: Implement `disc_meta` in `src/gen-editions.py`**

```python
import glob as _glob
import xml.etree.ElementTree as _ET

def disc_meta(bdmv):
    """Disc title (from BDMV/META/DL/bdmt_*.xml, eng preferred) and the largest
    image in META/DL as a poster path. Any failure yields nulls (real discs
    often lack META)."""
    meta = os.path.join(bdmv, "META", "DL")
    title = None
    xmls = sorted(_glob.glob(os.path.join(meta, "bdmt_*.xml")))
    xmls.sort(key=lambda p: 0 if p.endswith("bdmt_eng.xml") else 1)
    for xp in xmls:
        try:
            root = _ET.parse(xp).getroot()
            for el in root.iter():
                if el.tag.rsplit("}", 1)[-1] == "name" and (el.text or "").strip():
                    title = el.text.strip()
                    break
            if title:
                break
        except _ET.ParseError:
            continue
    imgs = [p for p in _glob.glob(os.path.join(meta, "*"))
            if p.lower().endswith((".jpg", ".jpeg", ".png"))]
    poster = max(imgs, key=os.path.getsize) if imgs else None
    return {"title": title, "poster": os.path.abspath(poster) if poster else None}
```

- [ ] **Step 4: Emit `disc` in `run_scan`**

In `run_scan`, change the final `print(json.dumps({...}))` to include `disc`:

```python
    print(json.dumps({"bdmv": os.path.abspath(bdmv), "clips": clips,
                      "playlists": playlists,
                      "slots": compute_slots(
                          {c: clips[c]["streams"] for c in clips}),
                      "disc": disc_meta(bdmv),
                      "warnings": warns}, indent=2))
```

- [ ] **Step 5: Sample generator writes META + poster** (in `samples/make-sample.py`, inside `main` after the STREAM/PLAYLIST are written)

```python
    meta = os.path.join(out_dir, "BDMV", "META", "DL")
    os.makedirs(meta)
    open(os.path.join(meta, "bdmt_eng.xml"), "w").write(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<disclib xmlns:di="urn:BDA:bdmv;discinfo">\n'
        '  <di:discinfo><di:title><di:name>Sample Disc</di:name></di:title></di:discinfo>\n'
        '</disclib>\n')
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
                    "-i", "color=c=teal:s=200x300:d=1", "-frames:v", "1",
                    os.path.join(meta, "poster.jpg")], check=True)
```

- [ ] **Step 6: Run the tests + full suite**

Run: `python3 -m pytest tests/ -v`
Expected: both new tests pass; all existing pass. Confirm `disc` is present and the sample builds.

- [ ] **Step 7: Commit**

```bash
git add src/gen-editions.py samples/make-sample.py tests/test_scan.py
git commit -m "Scan: emit disc title + poster from BDMV/META; sample gains META/poster"
```

---

### Task 3: Main enriches the poster path into a data URL

**Files:**
- Modify: `app/electron/scan.ts`
- Modify: `app/electron/scan.test.ts`

**Interfaces:**
- Consumes: scan JSON `disc.poster` (a path).
- Produces: the `scanDisc` result's `data.disc` has `poster_data_url: string|null` and no `poster` key. A missing/oversize (>4 MB) file yields `poster_data_url: null`.

- [ ] **Step 1: Write the failing test** (append to `app/electron/scan.test.ts`)

```ts
import { enrichPoster } from './scan'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('enrichPoster', () => {
  it('replaces a poster path with a base64 data url and drops the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poster-'))
    const jpg = join(dir, 'p.jpg')
    writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))
    const model: any = { disc: { title: 'X', poster: jpg } }
    enrichPoster(model)
    expect(model.disc.poster).toBeUndefined()
    expect(model.disc.poster_data_url).toMatch(/^data:image\/jpeg;base64,/)
  })
  it('yields null when the poster is missing or disc is absent', () => {
    const m1: any = { disc: { title: 'X', poster: '/no/such.jpg' } }
    enrichPoster(m1)
    expect(m1.disc.poster_data_url).toBe(null)
    const m2: any = {}
    enrichPoster(m2) // must not throw when disc is absent
    expect(m2.disc).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run electron/scan.test.ts`
Expected: FAIL - `enrichPoster` not exported.

- [ ] **Step 3: Implement `enrichPoster` and call it in `scanDisc`** (`app/electron/scan.ts`)

Add the import and function:

```ts
import { readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'

const POSTER_MAX = 4 * 1024 * 1024

/** Replace disc.poster (a path) with disc.poster_data_url (base64), best-effort. */
export function enrichPoster(model: Record<string, any>): void {
  const disc = model?.disc
  if (!disc || typeof disc !== 'object') return
  const path = disc.poster
  delete disc.poster
  disc.poster_data_url = null
  if (!path || typeof path !== 'string') return
  try {
    if (statSync(path).size > POSTER_MAX) return
    const ext = extname(path).toLowerCase() === '.png' ? 'png' : 'jpeg'
    disc.poster_data_url = `data:image/${ext};base64,` + readFileSync(path).toString('base64')
  } catch { /* unreadable -> stays null */ }
}
```

In `scanDisc`, on the success path, enrich before resolving:

```ts
      try {
        const data = JSON.parse(out)
        enrichPoster(data)
        resolve({ ok: true, data })
      }
      catch (e) { resolve({ ok: false, error: 'scan produced invalid JSON: ' + String(e) }) }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run electron/scan.test.ts`
Expected: PASS (enrichPoster cases + the existing scan tests).

- [ ] **Step 5: Commit**

```bash
git add app/electron/scan.ts app/electron/scan.test.ts
git commit -m "Main: enrich disc.poster path into a base64 data url for the renderer"
```

---

### Task 4: Renderer model types + identification helpers

**Files:**
- Modify: `app/renderer/src/lib/model.ts`, `app/renderer/src/lib/model.test.ts`

**Interfaces:**
- Produces (in `model.ts`):
  - `Stream` gains `channels?: number | null`.
  - `Clip` gains `width: number | null`, `height: number | null`.
  - `Disc { title: string | null; poster_data_url: string | null }`; `DiscModel` gains `disc: Disc`.
  - `chapterCount(c: Clip): number` = `c.marks_ns.length`.
  - `fmtChannels(n: number | null | undefined): string` - `''` if null, `'2.0'` (2), `'5.1'` (6), `'7.1'` (8), else `'${n}ch'`.
  - `fmtResolution(w: number | null, h: number | null): string` - `''` if either null, else `'${w}x${h}'`.
  - `clipStreamSummary(c: Clip): string[]` - one line per non-video stream: ```${kind} ${codec}${lang? ' '+lang : ''}${channels? ' '+fmtChannels(channels) : ''}` `` (kind 'subtitle' has no channels).

- [ ] **Step 1: Write the failing test** (append to `app/renderer/src/lib/model.test.ts`)

```ts
import { chapterCount, fmtChannels, fmtResolution, clipStreamSummary } from './model'

describe('identification helpers', () => {
  it('fmtChannels maps common layouts', () => {
    expect(fmtChannels(2)).toBe('2.0')
    expect(fmtChannels(6)).toBe('5.1')
    expect(fmtChannels(8)).toBe('7.1')
    expect(fmtChannels(1)).toBe('1ch')
    expect(fmtChannels(null)).toBe('')
  })
  it('fmtResolution formats WxH or empty', () => {
    expect(fmtResolution(1920, 1080)).toBe('1920x1080')
    expect(fmtResolution(null, 1080)).toBe('')
  })
  it('chapterCount and clipStreamSummary read the clip', () => {
    const clip: any = {
      marks_ns: [0, 1, 2], width: 1920, height: 1080,
      streams: [
        { pid: 1, kind: 'video', codec: 'h264', lang: null },
        { pid: 2, kind: 'audio', codec: 'ac3', lang: 'eng', channels: 6 },
        { pid: 3, kind: 'subtitle', codec: 'pgs', lang: 'spa' },
      ],
    }
    expect(chapterCount(clip)).toBe(3)
    expect(clipStreamSummary(clip)).toEqual(['audio ac3 eng 5.1', 'subtitle pgs spa'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/model.test.ts`
Expected: FAIL - helpers not exported.

- [ ] **Step 3: Implement in `app/renderer/src/lib/model.ts`**

Extend the types (add fields to the existing `Stream` and `Clip` interfaces, add `Disc`, add `disc` to `DiscModel`):
```ts
// Stream: add `channels?: number | null`
// Clip: add `width: number | null` and `height: number | null`
export interface Disc { title: string | null; poster_data_url: string | null }
// DiscModel: add `disc: Disc`
```
Append the helpers:
```ts
export function chapterCount(c: Clip): number { return c.marks_ns.length }

export function fmtChannels(n: number | null | undefined): string {
  if (n == null) return ''
  if (n === 2) return '2.0'
  if (n === 6) return '5.1'
  if (n === 8) return '7.1'
  return `${n}ch`
}

export function fmtResolution(w: number | null, h: number | null): string {
  return w == null || h == null ? '' : `${w}x${h}`
}

export function clipStreamSummary(c: Clip): string[] {
  return c.streams
    .filter((s) => s.kind !== 'video')
    .map((s) => {
      const ch = s.kind === 'audio' ? fmtChannels(s.channels) : ''
      return [s.kind, s.codec, s.lang, ch].filter(Boolean).join(' ')
    })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/lib/model.ts app/renderer/src/lib/model.test.ts
git commit -m "Model: resolution/channels/disc types + identification helpers"
```

---

### Task 5: DetailPanel component (clip / playlist / disc states)

**Files:**
- Create: `app/renderer/src/lib/components/DetailPanel.svelte`, `app/renderer/src/lib/components/DetailPanel.test.ts`

**Interfaces:**
- Consumes: `DiscModel`, `Clip`, `chapterCount`, `fmtResolution`, `clipStreamSummary`, `playlistRows`, `fmtDuration` from `$lib/model`.
- Produces: `DetailPanel.svelte` props `{ model: DiscModel | null; selected: { kind: 'clip' | 'playlist'; id: string } | null }`. Renders: disc overview when `selected == null`; clip detail when a clip is selected; playlist detail when a playlist is selected.

- [ ] **Step 1: Write the failing test** (`app/renderer/src/lib/components/DetailPanel.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import DetailPanel from './DetailPanel.svelte'

const model: any = {
  bdmv: '/x/BDMV',
  disc: { title: 'Sample Disc', poster_data_url: 'data:image/jpeg;base64,AAAA' },
  clips: {
    '00368': {
      path: '/x/BDMV/STREAM/00368.m2ts', dur_ns: 9699e9, codec: 'h264',
      fps: [24000, 1001], width: 1920, height: 1080, marks_ns: [0, 1, 2],
      streams: [
        { pid: 1, kind: 'video', codec: 'h264', lang: null },
        { pid: 2, kind: 'audio', codec: 'ac3', lang: 'eng', channels: 6 },
      ],
      tracks: [{ tid: 0, type: 'video', pid: 1 }],
    },
  },
  playlists: [{ file: '00342.mpls', angles: 1, editions: [{ name: '00342', clips: ['00368'] }] }],
  slots: [], warnings: [],
}

describe('DetailPanel', () => {
  it('shows the disc overview when nothing is selected', () => {
    render(DetailPanel, { model, selected: null })
    expect(screen.getByText('Sample Disc')).toBeInTheDocument()
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
  it('shows clip detail with resolution, chapters and stream summary', () => {
    render(DetailPanel, { model, selected: { kind: 'clip', id: '00368' } })
    expect(screen.getByText(/1920x1080/)).toBeInTheDocument()
    expect(screen.getByText(/3 ch/i)).toBeInTheDocument()
    expect(screen.getByText(/audio ac3 eng 5\.1/)).toBeInTheDocument()
  })
  it('shows playlist detail', () => {
    render(DetailPanel, { model, selected: { kind: 'playlist', id: '00342.mpls' } })
    expect(screen.getByText(/00342\.mpls/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/renderer && npx vitest run src/lib/components/DetailPanel.test.ts`
Expected: FAIL - component not found.

- [ ] **Step 3: Implement `DetailPanel.svelte`**

```svelte
<script lang="ts">
  import type { DiscModel } from '$lib/model'
  import { chapterCount, fmtResolution, clipStreamSummary, playlistRows, fmtDuration } from '$lib/model'
  let { model, selected }: {
    model: DiscModel | null
    selected: { kind: 'clip' | 'playlist'; id: string } | null
  } = $props()

  let clip = $derived(
    model && selected?.kind === 'clip' ? model.clips[selected.id] : null,
  )
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

<div class="h-full overflow-auto border-t border-primary-border/20 bg-surface p-2 text-xs dark:bg-surface-dark">
  {#if clip}
    <div class="font-semibold">{selected?.id}</div>
    <div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 opacity-80">
      <span>{fmtResolution(clip.width, clip.height) || 'resolution unknown'}</span>
      <span>{(clip.fps[0] / clip.fps[1]).toFixed(3)} fps</span>
      <span>{fmtDuration(clip.dur_ns)}</span>
      <span>{chapterCount(clip)} ch</span>
      <span>{clip.codec}</span>
    </div>
    <div class="mt-1">
      {#if clip.tracks.length === 0}
        <div class="text-red-400">unreadable</div>
      {:else}
        {#each clipStreamSummary(clip) as line}
          <div class="opacity-80">{line}</div>
        {/each}
      {/if}
    </div>
    <div class="mt-1 opacity-50">{clip.path}</div>
  {:else if pl && plRow}
    <div class="font-semibold">{plRow.file}</div>
    <div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 opacity-80">
      <span>{fmtDuration(plRow.durNs)}</span>
      <span>{plRow.itemCount} items / {plRow.uniqueCount} clips</span>
      {#if plRow.angles > 1}<span>{plRow.angles} angles</span>{/if}
      {#if plRow.isDecoy}<span class="text-amber-400">likely decoy</span>{/if}
    </div>
    <div class="mt-1 flex flex-wrap gap-1">
      {#each pl.editions[0].clips as c}
        <span class="rounded border border-primary-border/20 px-1">{c} {model ? fmtDuration(model.clips[c]?.dur_ns ?? 0) : ''}</span>
      {/each}
    </div>
  {:else if model}
    <div class="flex items-center gap-3">
      {#if model.disc.poster_data_url}
        <img class="h-28 rounded" src={model.disc.poster_data_url} alt="disc poster" />
      {/if}
      <div>
        <div class="text-base font-semibold">{model.disc.title ?? model.bdmv}</div>
        <div class="mt-1 opacity-70">
          {model.playlists.length} playlists / {Object.keys(model.clips).length} clips
        </div>
        {#if model.warnings.length}
          <div class="mt-1 text-amber-400">{model.warnings[0].message}</div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="opacity-50">Open a disc to see details.</div>
  {/if}
</div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app/renderer && npx vitest run src/lib/components/DetailPanel.test.ts`
Expected: PASS. (If svelte-check later warns, add a targeted svelte-ignore; see Step 5.)

- [ ] **Step 5: Typecheck**

Run: `cd app/renderer && npm run check`
Expected: 0 errors 0 WARNINGS. Fix any type error (e.g. a null-guard) without loosening types.

- [ ] **Step 6: Commit**

```bash
git add app/renderer/src/lib/components/DetailPanel.svelte app/renderer/src/lib/components/DetailPanel.test.ts
git commit -m "DetailPanel: clip / playlist / disc-overview metadata panel"
```

---

### Task 6: Row selection + chapter-count cues in the three components

**Files:**
- Modify: `app/renderer/src/lib/components/ClipLibrary.svelte`, `app/renderer/src/lib/components/PlaylistPicker.svelte`, `app/renderer/src/lib/components/EditionTracks.svelte`
- Modify: `app/renderer/src/lib/components/components? tests` - specifically `app/renderer/src/lib/components/ClipLibrary.test.ts` and `PlaylistPicker.test.ts`

**Interfaces:**
- Consumes: `LibraryClip` gains nothing; a new `chapters?: number` is passed per row. `PlaylistRow` unchanged; chapter count passed alongside.
- Produces:
  - `ClipLibrary` props gain `chapters?: Record<string, number>` and `onselect?: (id: string) => void` and `selectedId?: string`. Each chip shows `${chapters[id]} ch` when present, calls `onselect(id)` on click, and gets a ring when `id === selectedId`.
  - `PlaylistPicker` props gain `chapters?: Record<string, number>` (keyed by file) and `onselect?: (file: string) => void` and `selectedFile?: string`. Each row shows `${chapters[file]} ch`, the row body click calls `onselect(file)`, the import button calls `e.stopPropagation()` before `onimport`, and the selected row gets a ring.
  - `EditionTracks` props gain `onselect?: (clipId: string) => void`; a clip card body click calls `onselect(c)` (the delete button stops propagation).

- [ ] **Step 1: Write the failing tests** (append to `ClipLibrary.test.ts` and `PlaylistPicker.test.ts`)

`ClipLibrary.test.ts`:
```ts
import { vi, fireEvent } from 'vitest'
// (fireEvent may already be imported; keep one import)
it('shows chapter count and calls onselect on click', async () => {
  const clips = [{ id: '00368', durNs: 9600e9, codec: 'h264', readable: true, audioCount: 2, subCount: 2 }]
  const onselect = vi.fn()
  const { getByText } = render(ClipLibrary, { clips, chapters: { '00368': 16 }, onselect })
  expect(getByText(/16 ch/)).toBeTruthy()
  await fireEvent.click(getByText('00368'))
  expect(onselect).toHaveBeenCalledWith('00368')
})
```

`PlaylistPicker.test.ts`:
```ts
it('shows chapter count, selects on row click, and does not import on row click', async () => {
  const rows = [{ file: '00342.mpls', angles: 1, itemCount: 1, uniqueCount: 1, durNs: 9700e9, isDecoy: false }]
  const onselect = vi.fn(); const onimport = vi.fn()
  const { getByText } = render(PlaylistPicker, { rows, chapters: { '00342.mpls': 12 }, onselect, onimport })
  expect(getByText(/12 ch/)).toBeTruthy()
  await fireEvent.click(getByText('00342.mpls'))
  expect(onselect).toHaveBeenCalledWith('00342.mpls')
  expect(onimport).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app/renderer && npx vitest run src/lib/components/ClipLibrary.test.ts src/lib/components/PlaylistPicker.test.ts`
Expected: FAIL - `chapters`/`onselect` not handled.

- [ ] **Step 3: Update `ClipLibrary.svelte`**

```svelte
<script lang="ts">
  import type { LibraryClip } from '$lib/model'
  import { fmtDuration } from '$lib/model'
  let { clips, chapters = {}, selectedId, onselect }: {
    clips: LibraryClip[]
    chapters?: Record<string, number>
    selectedId?: string
    onselect?: (id: string) => void
  } = $props()
  function onDragStart(e: DragEvent, id: string) { e.dataTransfer?.setData('text/plain', id) }
</script>

<div class="flex flex-col gap-1 overflow-y-auto">
  {#each clips as c (c.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex gap-2 rounded border bg-surface px-1.5 py-1 text-xs dark:bg-surface-dark {c.id === selectedId ? 'border-primary ring-1 ring-primary' : 'border-primary-border/20'} {c.readable ? 'cursor-grab hover:border-primary/60' : 'cursor-not-allowed opacity-50'}"
      draggable={c.readable}
      ondragstart={(e) => onDragStart(e, c.id)}
      onclick={() => onselect?.(c.id)}
    >
      <span class="font-medium">{c.id}</span>
      <span class="opacity-70">{fmtDuration(c.durNs)}</span>
      {#if c.readable}
        <span class="opacity-70">{c.audioCount}a {c.subCount}s</span>
      {:else}
        <span class="text-red-400">unreadable</span>
      {/if}
      {#if chapters[c.id] != null}<span class="ml-auto opacity-60">{chapters[c.id]} ch</span>{/if}
    </div>
  {/each}
</div>
```

- [ ] **Step 4: Update `PlaylistPicker.svelte`**

```svelte
<script lang="ts">
  import type { PlaylistRow } from '$lib/model'
  import { fmtDuration } from '$lib/model'
  let { rows, chapters = {}, selectedFile, onimport, onselect }: {
    rows: PlaylistRow[]
    chapters?: Record<string, number>
    selectedFile?: string
    onimport: (file: string) => void
    onselect?: (file: string) => void
  } = $props()
  let q = $state('')
  let shown = $derived(rows.filter((r) => r.file.includes(q)))
</script>

<div class="flex flex-col gap-1 overflow-y-auto">
  <input class="mb-1.5 rounded border border-primary-border/25 bg-surface px-1 dark:bg-surface-dark" type="text" placeholder="filter playlists" bind:value={q} />
  {#each shown as r (r.file)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-primary/10 {r.file === selectedFile ? 'ring-1 ring-primary' : ''} {r.isDecoy ? 'opacity-50' : ''}"
      onclick={() => onselect?.(r.file)}
    >
      <span>{r.file}</span>
      <span class="opacity-70">{fmtDuration(r.durNs)}</span>
      <span class="opacity-70">{r.itemCount} items / {r.uniqueCount} clips</span>
      {#if chapters[r.file] != null}<span class="opacity-60">{chapters[r.file]} ch</span>{/if}
      {#if r.angles > 1}<span class="text-primary-text dark:text-primary-text-dark">{r.angles} angles</span>{/if}
      {#if r.isDecoy}<span class="text-amber-400 text-[10px]">likely decoy</span>{/if}
      <button class="ml-auto rounded border border-primary-border/25 bg-primary/15 px-1.5 hover:bg-primary/25" onclick={(e) => { e.stopPropagation(); onimport(r.file) }}>import</button>
    </div>
  {/each}
</div>
```

- [ ] **Step 5: Update `EditionTracks.svelte`** - add `onselect` to props and to the clip card; the delete button stops propagation.

In the props block add `onselect?: (clipId: string) => void`. On the clip card `<div ... style=...>` add `onclick={() => onselect?.(c)}` and add `<!-- svelte-ignore a11y_no_static_element_interactions -->` above it (it already has interaction handlers via the parent, but a direct onclick needs the ignore on this element). On the delete button change `onclick={() => onremove(i, k)}` to `onclick={(e) => { e.stopPropagation(); onremove(i, k) }}`.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd app/renderer && npx vitest run src/lib/components && npm run check`
Expected: component tests pass (existing + new), svelte-check 0 errors 0 WARNINGS. (Add a targeted `svelte-ignore` only if a new a11y warning appears.)

- [ ] **Step 7: Commit**

```bash
git add app/renderer/src/lib/components/ClipLibrary.svelte app/renderer/src/lib/components/PlaylistPicker.svelte app/renderer/src/lib/components/EditionTracks.svelte app/renderer/src/lib/components/ClipLibrary.test.ts app/renderer/src/lib/components/PlaylistPicker.test.ts
git commit -m "Components: chapter-count cues + click-to-select on clips/playlists/edition cards"
```

---

### Task 7: Wire selection + DetailPanel + header disc title into the shell

**Files:**
- Modify: `app/renderer/src/routes/+page.svelte`

**Interfaces:**
- Consumes: `DetailPanel`, the components' new `chapters`/`onselect`/`selectedId`/`selectedFile` props, `chapterCount` from `$lib/model`.
- Produces: the working shell - a `selected` state, the DetailPanel in a bottom strip, chapter maps passed to the lists, the header disc-title label, and selection reset on a new scan.

- [ ] **Step 1: Add state, chapter maps, and reset-on-scan** in `+page.svelte`'s script

Add the import: `import DetailPanel from '$lib/components/DetailPanel.svelte'` and `chapterCount` to the `$lib/model` import.
Add state near the others:
```ts
  let selected = $state<{ kind: 'clip' | 'playlist'; id: string } | null>(null)
```
In `scanInto`, right after `model = res.data as DiscModel`, add `selected = null` (a fresh disc must not keep a stale selection).
Add derived chapter maps after the existing derived views:
```ts
  let clipChapters = $derived(model ? Object.fromEntries(Object.entries(model.clips).map(([id, c]) => [id, chapterCount(c)])) : {})
  let playlistChapters = $derived(
    model ? Object.fromEntries(model.playlists.map((p) => [p.file, p.editions[0].clips.reduce((n, c) => n + (model!.clips[c] ? chapterCount(model!.clips[c]) : 0), 0)])) : {},
  )
```

- [ ] **Step 2: Header disc-title label** - in the `<header>`, after the "Open project..." button (before `{#if project}`), add:
```svelte
  {#if model?.disc.title}<span class="text-sm font-semibold opacity-90">{model.disc.title}</span>{/if}
```

- [ ] **Step 3: Pass the new props to the three lists and wrap the layout** - replace the `<main>...</main>` block:

```svelte
<div class="flex h-[calc(100vh-52px)] flex-col">
  <main class="grid min-h-0 flex-1 grid-cols-[220px_1fr_300px] gap-2.5 p-2.5">
    <section class="flex flex-col overflow-hidden">
      <h3 class="mb-1.5 text-xs font-bold uppercase tracking-wider text-primary-text dark:text-primary-text-dark">Clips</h3>
      <ClipLibrary clips={lib} chapters={clipChapters} selectedId={selected?.kind === 'clip' ? selected.id : undefined} onselect={(id) => (selected = { kind: 'clip', id })} />
    </section>
    <section class="flex flex-col overflow-hidden">
      <h3 class="mb-1.5 text-xs font-bold uppercase tracking-wider text-primary-text dark:text-primary-text-dark">Editions</h3>
      {#if project}
        <EditionTracks
          {project} {shared} {clipInfo}
          onselect={(id) => (selected = { kind: 'clip', id })}
          onappend={(i, id) => apply((p) => appendClip(p, i, id))}
          onremove={(i, k) => apply((p) => removeClip(p, i, k))}
          onrename={(i, name) => apply((p) => renameEdition(p, i, name))}
          onadd={() => apply((p) => addEdition(p, `Edition ${p.editions.length + 1}`))}
        />
      {/if}
    </section>
    <section class="flex flex-col overflow-hidden">
      <h3 class="mb-1.5 text-xs font-bold uppercase tracking-wider text-primary-text dark:text-primary-text-dark">Playlists</h3>
      <PlaylistPicker
        {rows} chapters={playlistChapters}
        selectedFile={selected?.kind === 'playlist' ? selected.id : undefined}
        onselect={(file) => (selected = { kind: 'playlist', id: file })}
        onimport={(file) => { const pl = model?.playlists.find((p) => p.file === file); if (pl) apply((p) => importPlaylist(p, pl)) }}
      />
    </section>
  </main>
  <div class="h-40 shrink-0">
    <DetailPanel {model} {selected} />
  </div>
</div>
```

(This replaces the previous `<main class="grid h-[calc(100vh-52px)] ...">`; the grid loses its own height and becomes a flex child so the panel gets a fixed 10rem strip. Delete the old `<main>` block entirely.)

- [ ] **Step 4: Build, typecheck, full tests**

Run: `cd app && npm run build && npm run check --workspace renderer && npx vitest run && cd renderer && npx vitest run`
Expected: build clean, svelte-check 0 errors 0 WARNINGS, all electron + renderer tests pass.

- [ ] **Step 5: Manual launch check**

Run: `cd app && timeout 25 npm start` and confirm the `[main] ready-to-show` log with no crash. Record it. (Full interactive verification - the panel updating on selection - is the real-disc validation below.)

- [ ] **Step 6: Commit**

```bash
git add app/renderer/src/routes/+page.svelte
git commit -m "Shell: bottom DetailPanel, selection state, chapter cues, header disc title"
```

---

## Real-disc validation (after Task 7)

With `/mnt/br` mounted: `cd app && ./` build+start (or `../run-app.sh`), Open folder on `/mnt/br`, and confirm: the header shows "Blade Runner 2049"; the default panel shows the poster + title + counts; clicking clip `00368` shows 1920x1080, 23.976 fps, 16 ch, and `audio ac3 eng 5.1` / `audio ac3 spa 5.1` / `subtitle pgs eng` / `subtitle pgs spa`; clicking a 101-item decoy playlist shows a low chapter count; a decoy clip row shows `1 ch`.

## Self-review notes

- Spec coverage: resolution+channels scan (T1), disc title+poster scan + sample META (T2), poster data-url enrichment (T3), model types+helpers (T4), DetailPanel three states (T5), chapter-count cues + selection (T6), shell wiring + header title + panel strip + reset-on-scan (T7).
- Cache compatibility: T1's `"width" in got` guard re-probes pre-existing cache entries, so a warm `./cache` cannot surface a `KeyError`.
- Type consistency: `Stream.channels`/`Clip.width`/`Clip.height`/`Disc`/`DiscModel.disc` defined in T4 and consumed by T5/T7; `chapterCount`/`fmtChannels`/`fmtResolution`/`clipStreamSummary` defined in T4 and used in T5/T6/T7; the components' `chapters`/`onselect`/`selectedId`/`selectedFile` props defined in T6 and passed in T7.
- Renderer stays fs-free: only main (T3) reads the poster file; the renderer consumes `poster_data_url`.
