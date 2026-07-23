# CLI Contract (Phase 1 of Electron Workbench) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `src/gen-editions.py` a JSON in/out contract (`--scan-json`, `--project`) plus STN track parsing, per-clip chapter marks, track selection, a probe cache, and seedable UIDs, so an authored `.mkvedproj` builds headlessly - and fix the sample generator bug that silently drops all audio.

**Architecture:** All changes are additive to the single-file CLI `src/gen-editions.py` (stdlib only). The sample generator `samples/make-sample.py` grows AC-3 audio in two languages plus a real STN table so the new parsing is testable without a disc. A pytest suite loads both scripts via importlib (their filenames contain dashes).

**Tech Stack:** Python 3 stdlib, pytest (dev-only), ffmpeg/ffprobe, mkvmerge.

**Spec:** `docs/superpowers/specs/2026-07-23-electron-workbench-design.md`

## Global Constraints

- No em-dashes in any repo file (commit 9117736 removed them all). Use "-".
- Python stdlib only in `src/` and `samples/`. pytest is dev-only, never imported by shipped code.
- Existing argv behavior unchanged: same inputs produce the same `build.sh` (modulo random EditionUIDs).
- New CLI surface is additive only: `--scan-json`, `--fast`, `--cache DIR`, `--seed N`, `--project FILE`.
- `mkvmerge`, `ffprobe`, `ffmpeg` on PATH (all verified present on this machine).
- Run tests with: `python3 -m pytest tests/ -v` (pytest is NOT yet installed - Task 1 installs it).
- Comment density/style: match existing code (short docstrings, terse inline comments).

## Verified facts the plan builds on (do not re-litigate)

- **Audio-loss bug (verified 2026-07-23, ffmpeg 6.x / mkvmerge v82):** when ffmpeg muxes AAC into a file with the `.m2ts` extension (m2ts mode), it writes PMT stream_type 0x06 (private data). `mkvmerge --identify` then sees ONLY the video track, so every MKV built from the current sample silently lost its audio. The same command with `-c:a ac3` yields stream_type 0x81 and mkvmerge sees both tracks. AC-3, E-AC-3, and pcm_bluray all survive; AAC does not. Fix: AC-3 (BD-legal).
- ffmpeg's m2ts mode uses HDMV PIDs: video 0x1011, audio 0x1100, 0x1101, ... (verified via `ffprobe -show_entries stream=id`). The sample's STN table must claim the same PIDs.
- Current `parse_mpls` returns `(items, marks)`; items are `(clips, in_t, out_t)` 3-tuples with one clip id per angle; STN table offset within a PlayItem is 32 (no angles) or `34 + 10*(angle_count-1)` (the existing angle code already reads byte 32 as the count).
- `mkvmerge -J` track `properties.number` should be the PID for MPEG TS input; Task 6 asserts this against the sample and the code carries an order-based fallback in case a mkvmerge version reports otherwise.

## File Structure

- Modify: `samples/make-sample.py` - AC-3 audio, per-segment languages, new clip 00031 + playlist 00004.mpls, STN table, `main(out_dir=None)`.
- Modify: `src/gen-editions.py` - everything else (kept single-file, matching repo layout).
- Create: `tests/conftest.py`, `tests/test_sample.py`, `tests/test_stn.py`, `tests/test_marks.py`, `tests/test_args.py`, `tests/test_probe.py`, `tests/test_scan.py`, `tests/test_project.py`, `tests/test_tracks.py`, `tests/test_roundtrip.py`.
- Modify (Task 9): `README.md`, `mkv-editions.sh` (usage comment only), `.gitignore`.

---

### Task 1: Test harness + fix silent audio loss in the sample generator

**Files:**
- Create: `tests/conftest.py`, `tests/test_sample.py`
- Modify: `samples/make-sample.py`

**Interfaces:**
- Produces: pytest fixtures `ge` (gen-editions module), `ms` (make-sample module), `sample_bd` (session-scoped Path to a generated `BDMV/`); `make_sample.main(out_dir=None)`; `SEGMENTS` entries gain a 6th field `langs` (tuple); new clip `00031` (langs `("eng",)`) and playlist `00004.mpls` = `00001 00031`; module constant `MISMATCH`.

- [ ] **Step 1: Install pytest and confirm**

```bash
python3 -m pip install --user pytest 2>/dev/null || python3 -m pip install --user --break-system-packages pytest
python3 -m pytest --version
```
Expected: a pytest version line.

- [ ] **Step 2: Write conftest.py**

```python
import importlib.util
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="session")
def ge():
    return load("gen_editions", "src/gen-editions.py")


@pytest.fixture(scope="session")
def ms():
    return load("make_sample", "samples/make-sample.py")


@pytest.fixture(scope="session")
def sample_bd(ms, tmp_path_factory):
    out = tmp_path_factory.mktemp("sample")
    ms.main(str(out))
    return out / "BDMV"
```

- [ ] **Step 3: Write the failing test** (`tests/test_sample.py`)

```python
import json
import subprocess


def mkvmerge_json(path):
    return json.loads(subprocess.check_output(["mkvmerge", "-J", str(path)]))


def test_mkvmerge_sees_audio_in_every_clip(sample_bd):
    # AAC in ffmpeg's m2ts mode gets PMT stream_type 0x06 and mkvmerge drops
    # it silently; AC-3 must yield visible audio tracks.
    for f in sorted((sample_bd / "STREAM").glob("*.m2ts")):
        kinds = [t["type"] for t in mkvmerge_json(f)["tracks"]]
        want_audio = 1 if f.stem == "00031" else 2
        assert kinds.count("video") == 1, f.name
        assert kinds.count("audio") == want_audio, f.name


def test_audio_is_ac3(sample_bd):
    out = subprocess.check_output(
        ["ffprobe", "-v", "0", "-select_streams", "a", "-show_entries",
         "stream=codec_name", "-of", "csv=p=0",
         str(sample_bd / "STREAM" / "00001.m2ts")]).decode()
    assert set(out.split()) == {"ac3"}


def test_mismatch_playlist_exists(sample_bd):
    assert (sample_bd / "PLAYLIST" / "00004.mpls").exists()
    assert (sample_bd / "STREAM" / "00031.m2ts").exists()
```

- [ ] **Step 4: Run to verify failure**

Run: `python3 -m pytest tests/test_sample.py -v`
Expected: FAIL (`main()` takes no out_dir argument, or audio counts wrong: mkvmerge currently sees 1 track per clip).

- [ ] **Step 5: Modify samples/make-sample.py**

Replace `SEGMENTS`, `make_segment`, and the `main` signature; add `MISMATCH`:

```python
# id, on-screen tag, colour, seconds, tone Hz, audio languages
# (00031 deliberately lacks the jpn track: it exercises the append-mismatch
#  guard via playlist 00004. AC-3 not AAC: ffmpeg's m2ts mode writes AAC with
#  PMT stream_type 0x06, which mkvmerge silently ignores - every build lost
#  its audio. AC-3 is BD-legal and gets stream_type 0x81.)
SEGMENTS = [
    ("00001", "BOTH",        "red",     4, 220, ("eng", "jpn")),
    ("00002", "BOTH",        "orange",  4, 247, ("eng", "jpn")),
    ("00003", "THEATRICAL",  "green",   4, 262, ("eng", "jpn")),
    ("00004", "BOTH",        "blue",    4, 294, ("eng", "jpn")),
    ("00005", "BOTH",        "purple",  4, 330, ("eng", "jpn")),
    ("00011", "EXTENDED",    "teal",    5, 349, ("eng", "jpn")),
    ("00012", "EXTENDED",    "magenta", 5, 392, ("eng", "jpn")),
    ("00013", "EXTENDED",    "brown",   4, 440, ("eng", "jpn")),
    ("00021", "ANGLE2",      "gold",    4, 494, ("eng", "jpn")),
    ("00031", "MISMATCH",    "gray",    4, 523, ("eng",)),
]
THEATRICAL = ["00001", "00002", "00003", "00004", "00005"]
EXTENDED   = ["00001", "00002", "00011", "00004", "00012", "00005", "00013"]
ANGLED     = ["00001", "00002", ("00003", "00021"), "00004", "00005"]
MISMATCH   = ["00001", "00031"]
```

```python
def make_segment(path, seg_id, tag, colour, dur, hz, langs):
    label = f"SEG {seg_id} {tag}"
    vf = (f"drawtext=fontfile={FONT}:text='{label}':fontcolor=white:"
          f"fontsize=64:box=1:boxcolor=black@0.5:boxborderw=12:"
          f"x=(w-text_w)/2:y=(h-text_h)/2") if os.path.exists(FONT) else "null"
    cmd = ["ffmpeg", "-y", "-loglevel", "error",
           "-f", "lavfi", "-i", f"color=c={colour}:s=1280x720:d={dur}:r=24"]
    for k, _lang in enumerate(langs):        # distinct tone per language
        cmd += ["-f", "lavfi", "-i", f"sine=frequency={hz * (k + 1)}:duration={dur}"]
    cmd += ["-vf", vf,
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
            "-c:a", "ac3", "-ar", "48000", "-ac", "2", "-map", "0:v"]
    for k in range(len(langs)):
        cmd += ["-map", f"{k + 1}:a"]
    cmd += ["-f", "mpegts", path]
    subprocess.run(cmd, check=True)
```

In `main`: change signature to `def main(out_dir=None):` with first line
`out_dir = out_dir or (sys.argv[1] if len(sys.argv) > 1 else "sample")`;
update the encode loop unpack to `for seg_id, tag, colour, dur, hz, langs in SEGMENTS:` and pass `langs` through; collect `langmap = {seg_id: langs ...}` (used by Task 2); add
`write_mpls(os.path.join(playlist, "00004.mpls"), MISMATCH, durs)` and a
`Mismatch   (00004.mpls): 00001 00031` line to the summary print and docstring.

- [ ] **Step 6: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_sample.py -v`
Expected: 3 PASS (session fixture encodes 10 clips, a few seconds).

- [ ] **Step 7: Commit**

```bash
git add tests/conftest.py tests/test_sample.py samples/make-sample.py
git commit -m "Fix silent audio loss in sample (AAC->AC-3); add langs, 00031, pytest harness"
```

---

### Task 2: STN table - write in sample, parse in gen-editions

**Files:**
- Modify: `samples/make-sample.py` (write_mpls), `src/gen-editions.py` (parse_mpls)
- Create: `tests/test_stn.py`

**Interfaces:**
- Consumes: `sample_bd`, `ge`, `langmap` from Task 1.
- Produces: `parse_mpls(path)` now returns `(items, marks, streams)` where `streams[i]` is the i-th PlayItem's stream list `[{"pid": int|None, "kind": "video"|"audio"|"subtitle"|"other", "codec": str, "lang": str|None}]`; module constant `STREAM_CODECS`; `make-sample.stn_block(langs)`; `write_mpls(path, slots, durs, langmap)`.

- [ ] **Step 1: Write the failing test** (`tests/test_stn.py`)

```python
def test_parse_mpls_returns_streams(ge, sample_bd):
    items, marks, streams = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00001.mpls"))
    assert len(streams) == len(items) == 5
    st = streams[0]
    assert [s["kind"] for s in st] == ["video", "audio", "audio"]
    assert st[0]["codec"] == "h264" and st[0]["pid"] == 0x1011
    assert [(s["lang"], s["pid"]) for s in st[1:]] == [
        ("eng", 0x1100), ("jpn", 0x1101)]


def test_stn_survives_angle_block(ge, sample_bd):
    items, _m, streams = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00003.mpls"))
    assert len(items[2][0]) == 2          # the 2-angle slot
    assert [s["kind"] for s in streams[2]] == ["video", "audio", "audio"]


def test_mismatch_clip_has_one_audio(ge, sample_bd):
    _i, _m, streams = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00004.mpls"))
    assert len([s for s in streams[1] if s["kind"] == "audio"]) == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_stn.py -v`
Expected: FAIL - `parse_mpls` returns 2 values, not 3.

- [ ] **Step 3: Implement stn_block + write_mpls in make-sample.py**

```python
def stn_block(langs):
    """Real-layout STN table: length(2), reserved(2), 12 count bytes, then one
    entry per stream. Entry = stream_entry(len,type=1,PID,pad) followed by
    stream_attributes(len, coding_type, ...). h264=0x1B, AC-3=0x81; PIDs match
    what ffmpeg's m2ts mode actually writes (video 0x1011, audio 0x1100+k)."""
    body = bytes([1, len(langs), 0, 0, 0, 0, 0]) + b"\x00" * 5
    body += bytes([9, 1]) + struct.pack(">H", 0x1011) + b"\x00" * 6
    body += bytes([5, 0x1B, 0x00]) + b"\x00" * 3
    for k, lang in enumerate(langs):
        body += bytes([9, 1]) + struct.pack(">H", 0x1100 + k) + b"\x00" * 6
        body += bytes([5, 0x81, 0x03]) + lang.encode("ascii")
    after = b"\x00\x00" + body
    return struct.pack(">H", len(after)) + after
```

In `write_mpls(path, slots, durs, langmap)`: after the angle block (i.e. as the
last content of each PlayItem, before `items += struct.pack(">H", len(it)) + it`),
append `it += stn_block(langmap[clips[0]])`. Update the four `write_mpls` call
sites in `main` to pass `langmap`.

- [ ] **Step 4: Implement STN parsing in src/gen-editions.py**

Add below `parse_mpls`'s helpers:

```python
STREAM_CODECS = {
    0x01: ("video", "mpeg1"), 0x02: ("video", "mpeg2"),
    0x1B: ("video", "h264"), 0xEA: ("video", "vc1"), 0x24: ("video", "hevc"),
    0x80: ("audio", "pcm_bluray"), 0x81: ("audio", "ac3"),
    0x82: ("audio", "dts"), 0x83: ("audio", "truehd"), 0x84: ("audio", "eac3"),
    0x85: ("audio", "dts_hd"), 0x86: ("audio", "dts_hd_ma"),
    0xA1: ("audio", "eac3_sec"), 0xA2: ("audio", "dts_sec"),
    0x90: ("subtitle", "pgs"), 0x91: ("subtitle", "igs"),
    0x92: ("subtitle", "text"),
}


def parse_stn(it, off):
    """Parse the STN table at offset off inside a PlayItem. Tolerant: skips by
    the length fields, keeps unknown coding types as kind "other", never reads
    past the table. Returns primary video + audio + PG streams."""
    if off + 4 > len(it):
        return []
    end = min(off + 2 + int.from_bytes(it[off:off + 2], "big"), len(it))
    p = off + 4
    if p + 12 > end:
        return []
    n_v, n_a, n_pg = it[p], it[p + 1], it[p + 2]
    p += 12
    out = []
    for _ in range(n_v + n_a + n_pg):
        if p + 2 > end:
            break
        elen, etype = it[p], it[p + 1]
        pid = (int.from_bytes(it[p + 2:p + 4], "big")
               if etype == 1 and p + 4 <= end else None)
        p += 1 + elen
        if p + 2 > end:
            break
        alen, coding = it[p], it[p + 1]
        kind, codec = STREAM_CODECS.get(coding, ("other", f"0x{coding:02x}"))
        lang = None
        if kind == "audio" and p + 6 <= end:
            lang = it[p + 3:p + 6].decode("ascii", "replace")
        elif codec == "pgs" and p + 5 <= end:
            lang = it[p + 2:p + 5].decode("ascii", "replace")
        elif codec == "text" and p + 6 <= end:
            lang = it[p + 3:p + 6].decode("ascii", "replace")
        p += 1 + alen
        out.append({"pid": pid, "kind": kind, "codec": codec, "lang": lang})
    return out
```

In `parse_mpls`: add `streams = []` before the PlayItem loop; inside the loop
compute the STN offset and collect:

```python
        stn_off = 32
        clips = [clip_id(it[0:5])]
        if (it[10] >> 4) & 1:                    # is_multi_angle
            ...existing angle code...
            stn_off = 34 + 10 * n_extra
        streams.append(parse_stn(it, stn_off))
```

Change the final `return items, marks` to `return items, marks, streams`, and
update the one existing caller (`load_editions`):
`items, marks, _streams = parse_mpls(mpls)`.

- [ ] **Step 5: Run tests**

Run: `python3 -m pytest tests/test_stn.py tests/test_sample.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add samples/make-sample.py src/gen-editions.py tests/test_stn.py
git commit -m "STN table: emit in sample MPLS, parse in gen-editions (PID/codec/lang)"
```

---

### Task 3: Re-key chapter marks per clip

**Files:**
- Modify: `src/gen-editions.py` (`load_editions`, `edition_mark_positions`, `main` summary print)
- Create: `tests/test_marks.py`

**Interfaces:**
- Consumes: `parse_mpls` 3-tuple return.
- Produces: `marks_by_item(items, marks) -> [ (ns, ...), ... ]` (parallel to `items`); `clip_marks_from(items, marks) -> {clip: (ns_offset, ...)}` (for the scan model only); editions become `(name, ed_items, item_marks)` where `item_marks` is POSITIONAL, parallel to `ed_items`; `edition_mark_positions(items, item_marks, clipinfo)`.

**Why positional, not keyed by clip:** a clip may appear more than once in one
edition (repeated segments are a documented supported case). Keying marks by
clip id alone makes the second occurrence inherit the first's chapters, which
invents a chapter the disc author never wrote and breaks this task's
byte-identical invariant. Positional marks keep each occurrence's own marks.
`clip_marks_from` still exists because the SCAN model needs per-clip marks: an
authored edition has no PlayItem indices, so there its marks attach to clips,
and every occurrence intentionally gets them.

- [ ] **Step 1: Write the failing test** (`tests/test_marks.py`)

```python
def synth_clipinfo(ge, items):
    return {c: ge.ClipInfo(None, 24, 1, 4 * ge.NS, "h264")
            for c, _i, _o in items}


def test_marks_are_positional(ge, sample_bd):
    _n, items, im = ge.load_editions(str(sample_bd), [("T", "00001.mpls")])[0]
    assert im == [(2 * ge.NS,)] * 5        # mark 2s into every sample clip
    pos = ge.edition_mark_positions(items, im, synth_clipinfo(ge, items))
    assert pos == [2 * ge.NS, 6 * ge.NS, 10 * ge.NS, 14 * ge.NS, 18 * ge.NS]


def test_repeated_clip_does_not_inherit_marks(ge):
    # A clip appearing twice must NOT gain the other occurrence's chapters:
    # that would invent a chapter the disc author never wrote.
    items = [("A", 0, 0), ("B", 0, 0), ("A", 0, 0)]
    im = [(2 * ge.NS,), (), ()]            # disc marks only the FIRST A
    ci = {c: ge.ClipInfo(None, 24, 1, 4 * ge.NS, "h264") for c in "AB"}
    assert ge.edition_mark_positions(items, im, ci) == [2 * ge.NS]


def test_marks_travel_when_resequenced(ge, sample_bd):
    # The authored path attaches a clip's marks to every occurrence, via
    # clip_marks_from - that is what lets marks survive re-sequencing.
    _n, items, _im = ge.load_editions(str(sample_bd), [("T", "00001.mpls")])[0]
    raw_items, marks, _s = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00001.mpls"))
    cm = ge.clip_marks_from(raw_items, marks)
    assert cm["00001"] == (2 * ge.NS,)
    resq = [items[2], items[0]]            # authored order: clip 3 then clip 1
    im = [cm.get(c, ()) for c, _i, _o in resq]
    pos = ge.edition_mark_positions(resq, im, synth_clipinfo(ge, items))
    assert pos == [2 * ge.NS, 6 * ge.NS]   # mark follows each clip


def test_angle_marks_attach_to_all_angle_clips(ge, sample_bd):
    raw_items, marks, _s = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00003.mpls"))
    cm = ge.clip_marks_from(raw_items, marks)
    assert cm["00021"] == (2 * ge.NS,)     # angle-2 clip gets the item's mark
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_marks.py -v`
Expected: FAIL - editions carry `[(pi, ts)]`, not a dict.

- [ ] **Step 3: Implement**

Add after `parse_mpls`:

```python
def marks_by_item(items, marks):
    """Mark offsets within each PlayItem, positionally parallel to items, so a
    playlist's marks stay bound to the occurrence that carried them (a clip may
    appear more than once in one edition)."""
    per = [set() for _ in items]
    for pi, ts in marks:
        _clips, in_t, _o = items[pi]
        per[pi].add(int(round((ts - in_t) * NS / TICKS)))
    return [tuple(sorted(s)) for s in per]


def clip_marks_from(items, marks):
    """The same marks re-keyed by clip id, for the scan model: an authored
    edition has no PlayItem indices, so its marks attach to clips and every
    occurrence gets them. A mark on a multi-angle item attaches to every
    angle's clip."""
    out = {}
    for pi, ts in marks:
        clips, in_t, _o = items[pi]
        off = int(round((ts - in_t) * NS / TICKS))
        for c in clips:
            out.setdefault(c, set()).add(off)
    return {c: tuple(sorted(v)) for c, v in out.items()}
```

Rewrite `edition_mark_positions` (same name, drop-in at its current location):

```python
def edition_mark_positions(items, item_marks, clipinfo):
    """Chapter-mark timestamps mapped onto this edition's virtual timeline.
    item_marks is parallel to items, so each occurrence contributes only its
    own marks."""
    out, off = set(), 0
    for (clip, _i, _o), local in zip(items, item_marks):
        for m in local:
            p = off + m
            if p > 0 and m < clipinfo[clip].dur:
                out.add(p)
        off += clipinfo[clip].dur
    return sorted(out)
```

In `load_editions`: after the existing mark-validity filter, add
`im = marks_by_item(items, marks)` and append `(ed_name, ed_items, im)`
instead of `(ed_name, ed_items, marks)`. Note `marks_by_item` is computed from
the FULL item list once and shared by every angle's edition, since all angles
have the same PlayItem positions.

In `main`, the summary print `len(m)` becomes `sum(len(v) for v in m)`.

The `preserve and marks` truthiness checks in `build_flat` and `editions_xml`
MUST become `preserve and any(marks)`. `marks_by_item` returns one entry per
item, so the list is truthy even when every entry is an empty tuple - unlike
the old flat list of pairs, which was falsy when the playlist had no marks.
Left as-is, a mark-free playlist would take the has-marks path and emit
different chapters (positions `[]` splits every clip rather than yielding one
whole-clip atom per item).

- [ ] **Step 4: Run the full suite + a real build**

Run: `python3 -m pytest tests/ -v` - all PASS.
Then regenerate and build once (chapters must land where they always did):

```bash
python3 samples/make-sample.py /tmp/mkved-sample
python3 src/gen-editions.py /tmp/mkved-sample/BDMV /tmp/mkved-out --mode xin1 \
  --title S --preserve-chapters "T=00001.mpls" "E=00002.mpls"
grep -c ChapterTimeStart /tmp/mkved-out/chapters.xml
```
Expected: same atom count as before this task (24 atoms across 2 editions).

- [ ] **Step 5: Commit**

```bash
git add src/gen-editions.py tests/test_marks.py
git commit -m "Re-key chapter marks per clip so they travel with re-sequenced clips"
```

---

### Task 4: Args namedtuple + all new flags parsed + --seed

**Files:**
- Modify: `src/gen-editions.py` (`parse_args`, `main`, docstring OPTIONS/USAGE)
- Create: `tests/test_args.py`

**Interfaces:**
- Produces: `Args = namedtuple("Args", "bdmv out_dir mode title preserve qpfile eds scan fast cache seed project")`; `parse_args` returns it; `main` seeds `random` when `args.seed is not None`. `--scan-json`/`--project` are parsed here but implemented in Tasks 6/7 (until then they fall through to `sys.exit(__doc__)` only if their positional rules are unmet; a scan/project invocation before those tasks exits with "not implemented" - see Step 3).

- [ ] **Step 1: Write the failing test** (`tests/test_args.py`)

```python
import pytest


def test_new_flags_parse(ge):
    a = ge.parse_args(["/bd", "--scan-json", "--fast", "--cache", "/c",
                       "--seed", "42"])
    assert a.scan and a.fast and a.cache == "/c" and a.seed == 42
    assert a.bdmv == "/bd" and a.out_dir is None


def test_project_parses(ge):
    a = ge.parse_args(["--project", "p.mkvedproj", "outdir", "--seed", "7"])
    assert a.project == "p.mkvedproj" and a.out_dir == "outdir"


def test_old_form_unchanged(ge):
    a = ge.parse_args(["bd", "out", "--mode", "xin1", "--title", "T",
                       "--preserve-chapters", "N=1.mpls"])
    assert (a.bdmv, a.out_dir, a.mode, a.title) == ("bd", "out", "xin1", "T")
    assert a.preserve and a.eds == [("N", "1.mpls")] and a.seed is None


def test_old_form_still_requires_editions(ge):
    with pytest.raises(SystemExit):
        ge.parse_args(["bd", "out"])
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_args.py -v`
Expected: FAIL - unknown flags land in `pos`, return is a 7-tuple.

- [ ] **Step 3: Implement**

Replace `parse_args` wholesale:

```python
Args = namedtuple("Args", "bdmv out_dir mode title preserve qpfile eds "
                          "scan fast cache seed project")


def parse_args(argv):
    mode, title, pos, eds = "flat", "movie", [], []
    preserve = qpfile = scan = fast = False
    cache = seed = project = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--mode":
            mode = argv[i + 1]; i += 2; continue
        if a == "--title":
            title = argv[i + 1]; i += 2; continue
        if a.startswith("--mode="):
            mode = a.split("=", 1)[1]; i += 1; continue
        if a.startswith("--title="):
            title = a.split("=", 1)[1]; i += 1; continue
        if a == "--preserve-chapters":
            preserve = True; i += 1; continue
        if a == "--qpfile":
            qpfile = True; i += 1; continue
        if a == "--scan-json":
            scan = True; i += 1; continue
        if a == "--fast":
            fast = True; i += 1; continue
        if a == "--cache":
            cache = argv[i + 1]; i += 2; continue
        if a == "--seed":
            seed = int(argv[i + 1]); i += 2; continue
        if a == "--project":
            project = argv[i + 1]; i += 2; continue
        if "=" in a and len(pos) >= 2:
            name, mpls = a.split("=", 1)
            eds.append((name, mpls)); i += 1; continue
        pos.append(a); i += 1
    if mode not in ("flat", "linked", "xin1"):
        sys.exit(__doc__)
    if scan:
        if len(pos) < 1:
            sys.exit(__doc__)
        return Args(pos[0], None, mode, title, preserve, qpfile, eds,
                    True, fast, cache, seed, None)
    if project:
        if len(pos) < 1:
            sys.exit(__doc__)
        return Args(None, pos[0], mode, title, preserve, qpfile, eds,
                    False, fast, cache, seed, project)
    if len(pos) < 2 or not eds:
        sys.exit(__doc__)
    return Args(pos[0], pos[1], mode, title, preserve, qpfile, eds,
                False, fast, cache, seed, None)
```

In `main`, replace the first line with:

```python
    args = parse_args(sys.argv[1:])
    if args.seed is not None:
        random.seed(args.seed)
    if args.scan or args.project:
        sys.exit("scan/project: not implemented yet")   # replaced in Tasks 6/7
    bdmv, out_dir, mode, title = args.bdmv, args.out_dir, args.mode, args.title
    preserve, qpfile, eds = args.preserve, args.qpfile, args.eds
```

(keep the rest of `main` reading those locals). Add the new OPTIONS lines to the
module docstring: `--seed N` (deterministic EditionUIDs, testing),
`--scan-json [--fast] [--cache DIR]`, `--project FILE.mkvedproj`.

- [ ] **Step 4: Run full suite**

Run: `python3 -m pytest tests/ -v` - all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gen-editions.py tests/test_args.py
git commit -m "Args namedtuple: parse --scan-json/--fast/--cache/--seed/--project; seed UIDs"
```

---

### Task 5: Probe layer - mkvmerge -J, --fast, --cache

**Files:**
- Modify: `src/gen-editions.py` (`frame_info`, new `probe_clip`, `gather_clips`, `main`)
- Create: `tests/test_probe.py`

**Interfaces:**
- Consumes: `Args` fields `fast`, `cache`.
- Produces: `frame_info(path, count=True)`; `probe_clip(path, fast=False, cache_dir=None) -> {"codec","frames","fps":[num,den],"dur_ns","tracks":[{"tid","type","pid"}]}`; `gather_clips(stream, clips, fast=False, cache_dir=None, progress=None) -> (clipinfo, probes)` where `clips` is a list of ids and `progress` is `f(clip, done, total)`.

- [ ] **Step 1: Write the failing test** (`tests/test_probe.py`)

```python
import json


def test_probe_shape_and_pids(ge, sample_bd):
    p = ge.probe_clip(str(sample_bd / "STREAM" / "00001.m2ts"))
    assert p["codec"] == "h264" and p["frames"] == 96
    assert p["fps"] == [24, 1] and p["dur_ns"] == 4 * ge.NS
    auds = [t for t in p["tracks"] if t["type"] == "audio"]
    assert len(auds) == 2
    # mkvmerge reports the TS PID as properties.number - the STN join key
    assert sorted(t["pid"] for t in auds) == [0x1100, 0x1101]


def test_fast_skips_frame_count(ge, sample_bd):
    p = ge.probe_clip(str(sample_bd / "STREAM" / "00001.m2ts"), fast=True)
    assert p["frames"] is None and p["dur_ns"] > 0


def test_cache_hit_and_upgrade(ge, sample_bd, tmp_path, monkeypatch):
    clip = str(sample_bd / "STREAM" / "00002.m2ts")
    cd = str(tmp_path)
    fast = ge.probe_clip(clip, fast=True, cache_dir=cd)
    assert fast["frames"] is None
    full = ge.probe_clip(clip, cache_dir=cd)          # upgrades the entry
    assert full["frames"] == 96
    def boom(*a, **k):
        raise AssertionError("subprocess ran despite warm cache")
    monkeypatch.setattr(ge.subprocess, "check_output", boom)
    again = ge.probe_clip(clip, cache_dir=cd)         # served from cache
    assert again == full
    fast2 = ge.probe_clip(clip, fast=True, cache_dir=cd)  # full satisfies fast
    assert fast2["frames"] == 96


def test_cache_invalidated_by_mtime(ge, sample_bd, tmp_path):
    import os, shutil
    clip = tmp_path / "c.m2ts"
    shutil.copy(sample_bd / "STREAM" / "00003.m2ts", clip)
    cd = str(tmp_path / "cache")
    ge.probe_clip(str(clip), fast=True, cache_dir=cd)
    files = list((tmp_path / "cache").iterdir())
    assert len(files) == 1
    os.utime(clip, (1, 1))
    ge.probe_clip(str(clip), fast=True, cache_dir=cd)
    assert len(list((tmp_path / "cache").iterdir())) == 2  # new key, old orphaned
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_probe.py -v`
Expected: FAIL - `probe_clip` does not exist.

- [ ] **Step 3: Implement**

Add `import json` to the imports. Change `frame_info` signature to
`def frame_info(path, count=True):` and guard the counting fallback:

```python
    if not nbf.isdigit() and count:  # m2ts often lacks nb_frames -> count (slow but exact)
```

(with `count=False`, a non-digit `nbf` just yields `None` frames).

Add after `clip_duration_ns`:

```python
def probe_clip(path, fast=False, cache_dir=None):
    """ffprobe + mkvmerge -J for one clip, optionally through a cache keyed by
    name/size/mtime. fast skips frame counting (frames=None); a cached full
    result satisfies a fast request; a fast entry is upgraded in place when a
    full probe is asked for. A changed clip gets a new key (old entry orphaned)."""
    st = os.stat(path)
    key = f"{os.path.basename(path)}.{st.st_size}.{int(st.st_mtime)}.json"
    cf = os.path.join(cache_dir, key) if cache_dir else None
    if cf and os.path.exists(cf):
        got = json.load(open(cf))
        if fast or got["frames"] is not None:
            return got
    codec, frames, num, den = frame_info(path, count=not fast)
    tracks = [{"tid": t["id"], "type": t["type"],
               "pid": t.get("properties", {}).get("number")}
              for t in json.loads(subprocess.check_output(
                  ["mkvmerge", "-J", path]))["tracks"]]
    got = {"codec": codec, "frames": frames, "fps": [num, den],
           "dur_ns": clip_duration_ns(frames, num, den, path),
           "tracks": tracks}
    if cf:
        os.makedirs(cache_dir, exist_ok=True)
        json.dump(got, open(cf, "w"))
    return got
```

Replace `gather_clips`:

```python
def gather_clips(stream, clips, fast=False, cache_dir=None, progress=None):
    """Probe the given clip ids. Returns (clipinfo, probes)."""
    info, probes = {}, {}
    for n, clip in enumerate(clips, 1):
        path = os.path.join(stream, f"{clip}.m2ts")
        if not os.path.exists(path):
            sys.exit(f"missing clip: {path}")
        p = probe_clip(path, fast=fast, cache_dir=cache_dir)
        probes[clip] = p
        info[clip] = ClipInfo(p["frames"], p["fps"][0], p["fps"][1],
                              p["dur_ns"], p["codec"])
        if progress:
            progress(clip, n, len(clips))
    return info, probes
```

(The "referenced by edition" detail in the old missing-clip message is dropped;
the message still names the exact path.) In `main`, the call becomes:

```python
    clipinfo, probes = gather_clips(stream, unique_clips(editions),
                                    cache_dir=args.cache)
```

- [ ] **Step 4: Run full suite**

Run: `python3 -m pytest tests/ -v` - all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gen-editions.py tests/test_probe.py
git commit -m "Probe layer: mkvmerge -J track map, --fast probes, --cache keyed by size/mtime"
```

---

### Task 6: --scan-json with slots and stderr progress

**Files:**
- Modify: `src/gen-editions.py`
- Create: `tests/test_scan.py`

**Interfaces:**
- Consumes: `parse_mpls`, `clip_marks_from`, `probe_clip`.
- Produces: `sweep_playlists(bdmv) -> (playlists, clip_marks, clip_streams, warnings)`; `compute_slots(clip_streams) -> [slot dicts]`; `run_scan(args)` printing the scan JSON to stdout and `{"type":"progress",...}` lines to stderr. Slot id format: `kind:lang:codec:ordinal` (video excluded; `lang` falls back to `und`; ordinal counts same-key streams within a clip in STN order).

- [ ] **Step 1: Write the failing test** (`tests/test_scan.py`)

```python
import json
import subprocess
import sys

from conftest import ROOT

GE = str(ROOT / "src" / "gen-editions.py")


def run_cli(args):
    return subprocess.run([sys.executable, GE] + args,
                          capture_output=True, text=True)


def test_scan_json_fast(sample_bd):
    r = run_cli([str(sample_bd), "--scan-json", "--fast"])
    assert r.returncode == 0, r.stderr
    doc = json.loads(r.stdout)              # stdout is ONE clean JSON document
    pls = {p["file"]: p for p in doc["playlists"]}
    assert set(pls) == {"00001.mpls", "00002.mpls", "00003.mpls", "00004.mpls"}
    assert pls["00003.mpls"]["angles"] == 2
    assert [e["name"] for e in pls["00003.mpls"]["editions"]] == \
        ["00003", "00003 (Angle 2)"]
    assert pls["00003.mpls"]["editions"][1]["clips"][2] == "00021"
    c = doc["clips"]["00001"]
    assert c["marks_ns"] == [2_000_000_000] and c["exact"] is False
    assert c["frames"] is None
    assert [s["lang"] for s in c["streams"] if s["kind"] == "audio"] == \
        ["eng", "jpn"]
    jpn = next(s for s in doc["slots"] if s["id"] == "audio:jpn:ac3:1")
    assert jpn["missing_from"] == ["00031"]
    eng = next(s for s in doc["slots"] if s["id"] == "audio:eng:ac3:1")
    assert eng["missing_from"] == []
    prog = [json.loads(l) for l in r.stderr.splitlines()
            if l.startswith('{"type": "progress"') or l.startswith('{"type":"progress"')]
    assert len(prog) == len(doc["clips"])


def test_scan_full_is_exact(sample_bd):
    r = run_cli([str(sample_bd), "--scan-json"])
    doc = json.loads(r.stdout)
    assert doc["clips"]["00001"]["frames"] == 96
    assert doc["clips"]["00001"]["exact"] is True
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_scan.py -v`
Expected: FAIL with "scan/project: not implemented yet".

- [ ] **Step 3: Implement**

Add after `clip_marks_from`:

```python
def sweep_playlists(bdmv):
    """Parse every playlist in BDMV/PLAYLIST once. Returns (playlists,
    clip_marks, clip_streams, warnings); marks and streams are unioned per
    clip across playlists. A malformed .mpls becomes a warning, not a fatal
    error (real discs carry menu/junk playlists)."""
    pl_dir = os.path.join(bdmv, "PLAYLIST")
    playlists, cmarks, cstreams, warns = [], {}, {}, []
    for fn in sorted(os.listdir(pl_dir)):
        if not fn.lower().endswith(".mpls"):
            continue
        try:
            items, marks, streams = parse_mpls(os.path.join(pl_dir, fn))
        except SystemExit as e:
            warns.append({"kind": "mpls", "clips": [],
                          "message": f"{fn}: {e}"})
            continue
        marks = [(pi, ts) for pi, ts in marks if pi < len(items)]
        for c, offs in clip_marks_from(items, marks).items():
            cmarks.setdefault(c, set()).update(offs)
        for (clips, _i, _o), st in zip(items, streams):
            for c in clips:                  # angle clips share the item's STN
                cstreams.setdefault(c, st)
        n_ang = max((len(cl) for cl, _i, _o in items), default=1)
        stem = fn[:-5]
        playlists.append({"file": fn, "angles": n_ang, "editions": [
            {"name": stem if a == 0 else f"{stem} (Angle {a + 1})",
             "clips": [cl[a] if a < len(cl) else cl[0] for cl, _i, _o in items]}
            for a in range(n_ang)]})
    return (playlists, {c: sorted(v) for c, v in cmarks.items()},
            cstreams, warns)


def slot_ids_for_clip(streams):
    """[(slot_id|None, stream)] in STN order; video and unknown kinds get None.
    Slot id = kind:lang:codec:ordinal - the ordinal separates e.g. a main and
    a commentary track that share kind, language and codec."""
    counter, out = {}, []
    for s in streams:
        if s["kind"] not in ("audio", "subtitle"):
            out.append((None, s))
            continue
        base = (s["kind"], s["lang"] or "und", s["codec"])
        counter[base] = counter.get(base, 0) + 1
        out.append((f"{base[0]}:{base[1]}:{base[2]}:{counter[base]}", s))
    return out


def compute_slots(clip_streams):
    """Union per-clip slot ids into project-wide slots with presence info."""
    present, order = {}, []
    for clip in sorted(clip_streams):
        for sid, _s in slot_ids_for_clip(clip_streams[clip]):
            if sid is None:
                continue
            if sid not in present:
                present[sid] = set()
                order.append(sid)
            present[sid].add(clip)
    every = set(clip_streams)
    out = []
    for sid in order:
        kind, lang, codec, ordn = sid.split(":")   # ids never contain extra colons
        out.append({"id": sid, "kind": kind, "lang": lang, "codec": codec,
                    "ordinal": int(ordn),
                    "present_in": sorted(present[sid]),
                    "missing_from": sorted(every - present[sid])})
    return out
```

Add `run_scan` before `main`:

```python
def run_scan(args):
    bdmv = args.bdmv
    playlists, cmarks, cstreams, warns = sweep_playlists(bdmv)
    stream_dir = os.path.join(bdmv, "STREAM")
    order = []
    for pl in playlists:
        for ed in pl["editions"]:
            for c in ed["clips"]:
                if c not in order:
                    order.append(c)
    clips = {}
    for done, c in enumerate(order, 1):
        path = os.path.join(stream_dir, f"{c}.m2ts")
        if not os.path.exists(path):
            warns.append({"kind": "missing", "clips": [c],
                          "message": f"missing clip: {path}"})
            continue
        p = probe_clip(path, fast=args.fast, cache_dir=args.cache)
        print(json.dumps({"type": "progress", "clip": c,
                          "done": done, "total": len(order)}),
              file=sys.stderr, flush=True)
        clips[c] = {"path": os.path.abspath(path), "frames": p["frames"],
                    "fps": p["fps"], "dur_ns": p["dur_ns"],
                    "codec": p["codec"], "exact": p["frames"] is not None,
                    "marks_ns": cmarks.get(c, []),
                    "streams": cstreams.get(c, []), "tracks": p["tracks"]}
    bad = sorted(c for c, d in clips.items() if d["codec"] == "vc1")
    if bad:
        warns.append({"kind": "vc1", "clips": bad,
                      "message": "VC-1 video: mkvmerge skips one frame per "
                                 "append splice (mkvtoolnix#6194) - prefer "
                                 "--mode linked"})
    print(json.dumps({"bdmv": os.path.abspath(bdmv), "clips": clips,
                      "playlists": playlists,
                      "slots": compute_slots(
                          {c: clips[c]["streams"] for c in clips}),
                      "warnings": warns}, indent=2))
```

In `main`, replace the placeholder from Task 4:

```python
    if args.scan:
        run_scan(args)
        return
    if args.project:
        sys.exit("project: not implemented yet")       # replaced in Task 7
```

- [ ] **Step 4: Run full suite**

Run: `python3 -m pytest tests/ -v` - all PASS. If `test_probe.py`'s PID
assertion fails on this machine's mkvmerge (properties.number not the PID),
STOP and report - Task 8's PID join and its order-based fallback both need
reviewing against the actual `mkvmerge -J` output.

- [ ] **Step 5: Commit**

```bash
git add src/gen-editions.py tests/test_scan.py
git commit -m "--scan-json: disc model with slots, per-clip marks, stderr progress"
```

---

### Task 7: --project builds from a .mkvedproj

**Files:**
- Modify: `src/gen-editions.py`
- Create: `tests/test_project.py`

**Interfaces:**
- Consumes: `sweep_playlists`, `gather_clips`.
- Produces: `load_project(path)` (validates version 1, required keys `bdmv title mode editions`, mode in the three modes); `main` builds editions from the project (whole-clip items, marks from the disc sweep union); `tracks_sel` (the project's `tracks` list or None) is plumbed to Task 8. Project semantics: project wins over CLI `--mode/--title/--preserve-chapters/--qpfile` (they are ignored with a printed notice if given alongside `--project`).

- [ ] **Step 1: Write the failing test** (`tests/test_project.py`)

```python
import json
import subprocess
import sys

from conftest import ROOT

GE = str(ROOT / "src" / "gen-editions.py")


def run_cli(args):
    return subprocess.run([sys.executable, GE] + args,
                          capture_output=True, text=True)


def write_proj(tmp_path, sample_bd, **kw):
    proj = {"version": 1, "bdmv": str(sample_bd), "title": "P",
            "mode": "xin1",
            "editions": [{"name": "Mixed",
                          "clips": ["00011", "00001", "00011"]}]}
    proj.update(kw)
    f = tmp_path / "t.mkvedproj"
    f.write_text(json.dumps(proj))
    return str(f)


def test_project_builds_authored_edition(sample_bd, tmp_path):
    pf = write_proj(tmp_path, sample_bd)
    out = tmp_path / "out"
    r = run_cli(["--project", pf, str(out)])
    assert r.returncode == 0, r.stderr
    script = (out / "build.sh").read_text()
    assert script.count("00011.m2ts") == 1     # xin1: unique clips only
    chapters = (out / "chapters.xml").read_text()
    assert "Mixed" in (out / "tags.xml").read_text()
    # edition timeline: 00011(5s) + 00001(4s) + 00011(5s) = 3 atoms
    assert chapters.count("<ChapterAtom>") == 3


def test_project_marks_from_disc(sample_bd, tmp_path):
    pf = write_proj(tmp_path, sample_bd, preserve_chapters=True)
    out = tmp_path / "out2"
    r = run_cli(["--project", pf, str(out)])
    assert r.returncode == 0, r.stderr
    # marks 2s into each occurrence: atoms split at 2, 7, 11 (s) on a 14s line
    x = (out / "chapters.xml").read_text()
    assert "00:00:07.000000000" in x


def test_project_rejects_bad_version(sample_bd, tmp_path):
    pf = write_proj(tmp_path, sample_bd, version=2)
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode != 0 and "version" in (r.stdout + r.stderr)
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_project.py -v`
Expected: FAIL with "project: not implemented yet".

- [ ] **Step 3: Implement**

Add near `parse_args`:

```python
def load_project(path):
    """Validate and return a .mkvedproj (version 1). The project file is the
    GUI/CLI contract: everything the app can author must round-trip here."""
    p = json.load(open(path))
    if p.get("version") != 1:
        sys.exit(f"{path}: unsupported project version {p.get('version')!r}")
    for k in ("bdmv", "title", "mode", "editions"):
        if k not in p:
            sys.exit(f"{path}: missing {k!r}")
    if p["mode"] not in ("flat", "linked", "xin1"):
        sys.exit(f"{path}: bad mode {p['mode']!r}")
    for ed in p["editions"]:
        if not ed.get("name") or not ed.get("clips"):
            sys.exit(f"{path}: every edition needs a name and clips")
    return p
```

Restructure the top of `main` (after the seed handling and `run_scan` branch):

```python
    tracks_sel = cstreams = None
    if args.project:
        p = load_project(args.project)
        if args.eds or args.mode != "flat" or args.title != "movie" \
                or args.preserve or args.qpfile:
            print("  ! --project given: CLI mode/title/flag arguments ignored")
        bdmv, mode, title = p["bdmv"], p["mode"], p["title"]
        preserve = bool(p.get("preserve_chapters"))
        qpfile = bool(p.get("qpfile"))
        tracks_sel = p.get("tracks")
        _pls, cmarks, cstreams, _w = sweep_playlists(bdmv)
        stream = os.path.abspath(os.path.join(bdmv, "STREAM"))
        clip_order = []
        for ed in p["editions"]:
            for c in ed["clips"]:
                if c not in clip_order:
                    clip_order.append(c)
        clipinfo, probes = gather_clips(stream, clip_order,
                                        cache_dir=args.cache)
        editions = []
        for ed in p["editions"]:
            items = [(c, 0, int(round(clipinfo[c].dur * TICKS / NS)))
                     for c in ed["clips"]]
            # authored editions have no PlayItem indices: each occurrence of a
            # clip gets that clip's disc marks (marks travel with the clip)
            im = [tuple(cmarks.get(c, ())) for c in ed["clips"]]
            editions.append((ed["name"], items, im))
        out_dir = args.out_dir
    else:
        bdmv, out_dir, mode, title = (args.bdmv, args.out_dir, args.mode,
                                      args.title)
        preserve, qpfile = args.preserve, args.qpfile
        editions = load_editions(bdmv, args.eds)
        stream = os.path.abspath(os.path.join(bdmv, "STREAM"))
        clipinfo, probes = gather_clips(stream, unique_clips(editions),
                                        cache_dir=args.cache)
    os.makedirs(out_dir, exist_ok=True)
```

(The rest of `main` - warnings, mode dispatch, build.sh write, summary - reads
these locals unchanged. `tracks_sel`/`cstreams`/`probes` are consumed in Task 8.)

Note the flag-ignored heuristic: `args.mode != "flat"` etc. treats explicit
defaults as "not given"; that is acceptable for a notice-only message.

- [ ] **Step 4: Run full suite**

Run: `python3 -m pytest tests/ -v` - all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gen-editions.py tests/test_project.py
git commit -m "--project: build authored editions from a .mkvedproj headlessly"
```

---

### Task 8: Track selection flags + append-mismatch guard

**Files:**
- Modify: `src/gen-editions.py` (`clip_track_opts`, `check_track_layout`, `build_flat`, `build_linked`, `build_xin1`, `main`)
- Create: `tests/test_tracks.py`

**Interfaces:**
- Consumes: `slot_ids_for_clip`, `probes[clip]["tracks"]`, `cstreams`, `tracks_sel`.
- Produces: `clip_track_opts(streams, tracks_sel, tracks) -> [option strings]`; `check_track_layout(editions, tracks_sel, clip_streams, mode) -> [warning strings]` (calls `sys.exit` for flat/xin1 mismatches); `input_spec(stream, clip, clip_opts) -> str`; all three `build_*` gain a final `clip_opts=None` parameter (dict clip -> list of option strings emitted before that input file).

- [ ] **Step 1: Write the failing test** (`tests/test_tracks.py`)

```python
import json
import subprocess
import sys

import pytest

from conftest import ROOT

GE = str(ROOT / "src" / "gen-editions.py")


def run_cli(args):
    return subprocess.run([sys.executable, GE] + args,
                          capture_output=True, text=True)


def proj(sample_bd, tmp_path, mode, clips, tracks):
    f = tmp_path / "t.mkvedproj"
    f.write_text(json.dumps({
        "version": 1, "bdmv": str(sample_bd), "title": "T", "mode": mode,
        "editions": [{"name": "E", "clips": clips}], "tracks": tracks}))
    return str(f)


ENG_ONLY = [{"slot": "audio:eng:ac3:1", "keep": True, "default": True},
            {"slot": "audio:jpn:ac3:1", "keep": False}]
WANT_JPN = [{"slot": "audio:jpn:ac3:1", "keep": True}]


def test_clip_track_opts_unit(ge, sample_bd):
    _i, _m, streams = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00001.mpls"))
    p = ge.probe_clip(str(sample_bd / "STREAM" / "00001.m2ts"), fast=True)
    opts = ge.clip_track_opts(streams[0], ENG_ONLY, p["tracks"])
    joined = " ".join(opts)
    assert "--audio-tracks" in joined and "--no-subtitles" in joined
    assert "--language" in joined and ":eng" in joined
    assert "--default-track-flag" in joined


def test_selection_lands_in_output(sample_bd, tmp_path):
    pf = proj(sample_bd, tmp_path, "flat", ["00001", "00002"], ENG_ONLY)
    out = tmp_path / "out"
    r = run_cli(["--project", pf, str(out)])
    assert r.returncode == 0, r.stderr
    subprocess.run(["bash", "build.sh"], cwd=out, check=True,
                   capture_output=True)
    mkv = next(out.glob("*.mkv"))
    j = json.loads(subprocess.check_output(["mkvmerge", "-J", str(mkv)]))
    auds = [t for t in j["tracks"] if t["type"] == "audio"]
    assert len(auds) == 1
    assert auds[0]["properties"]["language"] == "eng"
    assert auds[0]["properties"]["default_track"] is True


def test_mismatch_blocks_append_mode(sample_bd, tmp_path):
    pf = proj(sample_bd, tmp_path, "flat", ["00001", "00031"], WANT_JPN)
    r = run_cli(["--project", pf, str(tmp_path / "o1")])
    assert r.returncode != 0
    assert "00031" in (r.stdout + r.stderr)


def test_mismatch_only_warns_in_linked(sample_bd, tmp_path):
    pf = proj(sample_bd, tmp_path, "linked", ["00001", "00031"], WANT_JPN)
    r = run_cli(["--project", pf, str(tmp_path / "o2")])
    assert r.returncode == 0, r.stderr
    assert "00031" in r.stdout
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_tracks.py -v`
Expected: FAIL - `clip_track_opts` does not exist.

- [ ] **Step 3: Implement**

Add after `compute_slots`:

```python
def clip_track_opts(streams, tracks_sel, tracks):
    """mkvmerge options placed before ONE input file, realizing the project's
    slot selection on this clip. TIDs come from matching the STN PID against
    mkvmerge -J properties.number; if a PID is missing, fall back to pairing
    the k-th STN stream of a kind with mkvmerge's k-th track of that type.
    Video is always kept."""
    keep = {t["slot"]: t for t in tracks_sel if t.get("keep")}
    by_pid = {t["pid"]: t["tid"] for t in tracks if t.get("pid") is not None}
    typed = {"audio": [t["tid"] for t in tracks if t["type"] == "audio"],
             "subtitle": [t["tid"] for t in tracks if t["type"] == "subtitles"]}
    seen, aud, sub, extra = {}, [], [], []
    for sid, s in slot_ids_for_clip(streams):
        if sid is None:
            continue
        k = seen.get(s["kind"], 0)
        seen[s["kind"]] = k + 1
        sel = keep.get(sid)
        if not sel:
            continue
        tid = by_pid.get(s["pid"])
        if tid is None:
            lst = typed.get(s["kind"], [])
            tid = lst[k] if k < len(lst) else None
        if tid is None:
            continue
        (aud if s["kind"] == "audio" else sub).append(tid)
        lang = sel.get("lang") or s["lang"]
        if lang:
            extra.append(f"--language {tid}:{lang}")
        if "default" in sel:
            extra.append(
                f"--default-track-flag {tid}:{1 if sel['default'] else 0}")
    opts = ["--audio-tracks " + ",".join(map(str, sorted(aud)))
            if aud else "--no-audio",
            "--subtitle-tracks " + ",".join(map(str, sorted(sub)))
            if sub else "--no-subtitles"]
    return opts + extra


def check_track_layout(editions, tracks_sel, clip_streams, mode):
    """A selected slot missing from a clip corrupts appends (mkvmerge pairs
    tracks by order/type). Fatal for flat/xin1; a warning for linked, which
    never appends."""
    selected = [t["slot"] for t in tracks_sel if t.get("keep")]
    warns, seen = [], set()
    for name, items, _m in editions:
        for c, _i, _o in items:
            have = {sid for sid, _s in slot_ids_for_clip(
                clip_streams.get(c, []))}
            for sid in selected:
                if sid in have:
                    continue
                msg = (f'edition "{name}": clip {c} has no {sid} stream - '
                       "appending would mis-pair tracks")
                if msg in seen:
                    continue
                seen.add(msg)
                if mode in ("flat", "xin1"):
                    sys.exit("ERROR: " + msg)
                warns.append(msg)
    return warns
```

Wire into `main` right after the editions/probes are ready (both paths), before
the mode dispatch:

```python
    clip_opts = None
    if tracks_sel:
        warnings += check_track_layout(editions, tracks_sel, cstreams, mode)
        clip_opts = {c: clip_track_opts(cstreams.get(c, []), tracks_sel,
                                        probes[c]["tracks"])
                     for c in probes}
```

(move the existing `warnings = vc1_warnings(clipinfo, mode)` line above this).

Add ONE shared helper next to `unique_clips` (the spec's Refactor scope requires
a shared helper here, so all three modes stay consistent - do NOT inline this
logic three times):

```python
def input_spec(stream, clip, clip_opts):
    """One mkvmerge input: its per-clip track options (if any) followed by the
    quoted path. Shared by all three modes so option emission lives in one
    place."""
    q = shlex.quote(os.path.join(stream, f"{clip}.m2ts"))
    o = " ".join(clip_opts.get(clip, [])) if clip_opts else ""
    return f"{o} {q}".strip()
```

Each `build_*` gains a final `clip_opts=None` parameter and calls it:

```python
# build_flat, replacing its srcs/appended lines:
        appended = " + ".join(input_spec(stream, c, clip_opts)
                              for c, _i, _o in items)

# build_xin1, replacing its appended line:
    appended = " + ".join(input_spec(stream, c, clip_opts) for c in order)

# build_linked, replacing its remux list:
    remux = [f"mkvmerge -o seg{c}.mkv --no-chapters --segment-uid 0x{uid_for(c)} "
             f"{input_spec(stream, c, clip_opts)}" for c in order]
```

Update the three `build_*` call sites in `main` to pass `clip_opts=clip_opts`.

- [ ] **Step 4: Run full suite**

Run: `python3 -m pytest tests/ -v` - all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gen-editions.py tests/test_tracks.py
git commit -m "Track selection: per-input mkvmerge flags from slots; block mismatched appends"
```

---

### Task 9: Round-trip equivalence, full validation, docs

**Files:**
- Create: `tests/test_roundtrip.py`
- Modify: `README.md`, `mkv-editions.sh` (usage comment), `.gitignore`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing (or passing) round-trip test** (`tests/test_roundtrip.py`)

This is the load-bearing test: `--project` must reproduce the argv path
byte-for-byte when both are seeded.

```python
import json
import subprocess
import sys

from conftest import ROOT

GE = str(ROOT / "src" / "gen-editions.py")


def run_cli(args):
    return subprocess.run([sys.executable, GE] + args,
                          capture_output=True, text=True)


def test_roundtrip_byte_identical(sample_bd, tmp_path):
    outa, outp = tmp_path / "argv", tmp_path / "proj"
    r = run_cli([str(sample_bd), str(outa), "--mode", "xin1", "--title",
                 "Sample", "--preserve-chapters", "--qpfile", "--seed", "42",
                 "Theatrical=00001.mpls", "Extended=00002.mpls"])
    assert r.returncode == 0, r.stderr

    scan = json.loads(run_cli([str(sample_bd), "--scan-json",
                               "--fast"]).stdout)
    pls = {p["file"]: p for p in scan["playlists"]}
    proj = {"version": 1, "bdmv": str(sample_bd), "title": "Sample",
            "mode": "xin1", "preserve_chapters": True, "qpfile": True,
            "editions": [
                {"name": "Theatrical",
                 "clips": pls["00001.mpls"]["editions"][0]["clips"]},
                {"name": "Extended",
                 "clips": pls["00002.mpls"]["editions"][0]["clips"]}]}
    pf = tmp_path / "rt.mkvedproj"
    pf.write_text(json.dumps(proj))
    r = run_cli(["--project", str(pf), str(outp), "--seed", "42"])
    assert r.returncode == 0, r.stderr

    for fn in ("build.sh", "chapters.xml", "tags.xml", "Sample.qpfile.txt"):
        assert (outa / fn).read_bytes() == (outp / fn).read_bytes(), fn


def test_roundtrip_flat_build_sh(sample_bd, tmp_path):
    outa, outp = tmp_path / "fa", tmp_path / "fp"
    run_cli([str(sample_bd), str(outa), "--mode", "flat", "--title", "S",
             "--seed", "1", "T=00001.mpls"])
    scan = json.loads(run_cli([str(sample_bd), "--scan-json",
                               "--fast"]).stdout)
    clips = next(p for p in scan["playlists"]
                 if p["file"] == "00001.mpls")["editions"][0]["clips"]
    pf = tmp_path / "f.mkvedproj"
    pf.write_text(json.dumps({"version": 1, "bdmv": str(sample_bd),
                              "title": "S", "mode": "flat",
                              "editions": [{"name": "T", "clips": clips}]}))
    run_cli(["--project", str(pf), str(outp), "--seed", "1"])
    assert (outa / "build.sh").read_bytes() == (outp / "build.sh").read_bytes()
```

Run: `python3 -m pytest tests/test_roundtrip.py -v`. If a byte diff appears,
diff the two files - the intended equivalence is exact, so any divergence is a
bug in Tasks 3/7 (most likely: mark union vs per-playlist marks, or item
out_time rounding). Fix there, not by loosening this test.

- [ ] **Step 2: Full-pipeline validation (spec's validation section)**

```bash
cd /tmp && rm -rf mkved-val && mkdir mkved-val && cd mkved-val
python3 ~/src/mkv-editions/samples/make-sample.py bd
for m in flat linked xin1; do
  python3 ~/src/mkv-editions/src/gen-editions.py bd/BDMV out-$m --mode $m \
    --title Sample --preserve-chapters "Theatrical=00001.mpls" "Extended=00002.mpls"
  (cd out-$m && bash build.sh > /dev/null)
done
mkvmerge -J out-xin1/Sample.mkv | python3 -c "
import json,sys; j=json.load(sys.stdin)
print('editions:', len(j['chapters']), 'tracks:',
      [(t['type'], t['properties'].get('language')) for t in j['tracks']])"
```
Expected: three clean builds; xin1 shows 1 chapters entry (2 editions inside),
and tracks now INCLUDE the two AC-3 audio tracks (they were silently absent
before Task 1). Run the angle playlist too:
`python3 ~/src/mkv-editions/src/gen-editions.py bd/BDMV out-ang --mode xin1 --title Ang "Angled=00003.mpls"` - expect "2 angles -> 2 editions".

- [ ] **Step 3: Update README.md**

Add to the gen-editions options section (after the aobikari options block), a
new subsection "JSON contract (for frontends and scripting)" documenting:
`--scan-json [--fast] [--cache DIR]` (stdout = disc model JSON, stderr =
progress lines), `--project FILE.mkvedproj` (version-1 schema with a complete
example - copy the one from the spec), `--seed N`, and the track-selection
semantics (project-wide slots; mismatch fatal in flat/xin1, warning in linked).
In the sample-generator section, document the AC-3 change with one sentence:
AAC in ffmpeg's m2ts mode gets PMT stream_type 0x06 and mkvmerge silently
drops it - the sample now uses AC-3 so audio actually survives, and clip
00031/playlist 00004.mpls exist to exercise the mismatch guard.

- [ ] **Step 4: Update mkv-editions.sh usage comment + .gitignore**

In the wrapper's usage block add one line after the existing options line:
`#   (also forwarded: --scan-json --fast --cache DIR --seed N --project FILE)`.
Append `__pycache__/` and `.pytest_cache/` to `.gitignore` if not present.

- [ ] **Step 5: Full suite one last time, then commit**

```bash
python3 -m pytest tests/ -v
git add tests/test_roundtrip.py README.md mkv-editions.sh .gitignore
git commit -m "Round-trip equivalence test; document JSON contract; validate pipeline"
```

---

## Self-review notes (already applied)

- Spec coverage: mark re-keying (T3), STN parsing (T2), seedable UIDs (T4),
  track flags + mismatch guard (T8), --scan-json/--fast/--cache/progress (T5/T6),
  --project (T7), sample audio + mismatch clip (T1), round-trip + docs (T9).
  Spec's "pytest over the probe cache" is T5; "fast output matches full except
  frames/exact" is covered by T5's upgrade test plus T6's two scan tests.
- The spec's `00003.mpls` angle-expansion validation is asserted in
  test_scan.py (names and the 00021 clip substitution) and re-run end-to-end
  in T9 Step 2.
- Type consistency: editions are `(name, items, clip_marks)` everywhere after
  T3; `gather_clips` returns `(clipinfo, probes)` everywhere after T5;
  `slot_ids_for_clip` is defined in T6 and consumed in T8.
- Known accepted divergences (documented in README by T9): project marks are
  the union across playlists (identical on the sample; can differ on discs
  where the same clip carries different marks in different playlists); the
  missing-clip error no longer names the referencing edition.
