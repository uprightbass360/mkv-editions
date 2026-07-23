#!/usr/bin/env python3
"""
gen-editions.py - build editioned MKVs from a decrypted BD backup by reading
the on-disc .mpls play order (and chapter marks).

MODES
  flat    (default) One self-contained file per edition (mkvmerge append).
          Plays on ANY player incl. Plex/Jellyfin/Emby. Shared video duplicated.
          Files are named for the media-server Editions feature:
          "<title> {edition-Name}.mkv".
  linked  Space-efficient, mpv-ONLY. Husk + external per-segment files joined by
          ordered chapters / segment linking. Shared segments stored once.
  xin1    Single "<title>.mkv": every unique clip appended once, each edition an
          ordered-chapter timeline seeking inside that one file. Alternate cuts
          are mpv-only; other players see the raw concatenation (skewed runtime).

Multi-angle playlists (discs that branch via angles instead of separate
playlists) auto-expand: "Name=pl.mpls" with N angles yields N editions -
"Name", "Name (Angle 2)", ...

OPTIONS
  --title NAME           base output name (default "movie")
  --preserve-chapters    read the disc's chapter marks (.mpls PlayListMark) and
                         emit them as real chapters in each edition
  --qpfile               (flat/xin1) emit an x264/x265 --qpfile forcing IDR
                         frames at each segment join, for seamless re-encoding
  --seed N               seed random (deterministic EditionUIDs, for testing)
  --scan-json [--fast] [--cache DIR]
                         scan BDMV_dir and emit a JSON description instead of
                         building anything
  --project FILE.mkvedproj
                         build from a project file (names its own BDMV_dir)

USAGE
  gen-editions.py <BDMV_dir> <out_dir> [--mode flat|linked|xin1] [--title NAME]
                  [--preserve-chapters] [--qpfile] [--seed N]
                  "<Edition Name>=<playlist.mpls>" [ ... ]
  gen-editions.py <BDMV_dir> --scan-json [--fast] [--cache DIR]
  gen-editions.py --project FILE.mkvedproj <out_dir> [--seed N]

Requires mkvmerge (+ ffprobe) on PATH. MPLS PlayItem/PlayListMark tables are
parsed directly (no libbluray/mpls_dump needed); MPLS timestamps are 45 kHz.
"""

import hashlib
import json
import os
import random
import sys
import shlex
import subprocess
import tempfile
from collections import namedtuple
from xml.sax.saxutils import escape as xml_escape

TICKS = 45000  # MPLS timestamps are 45 kHz
NS = 1_000_000_000
JOIN_TOL_NS = 1_000_000  # marks within 1 ms of a splice count as AT the splice

ClipInfo = namedtuple("ClipInfo", "frames num den dur codec")


# ---------------------------------------------------------------------------
# .mpls parsing (PlayItems + chapter marks)
# ---------------------------------------------------------------------------
def parse_mpls(path):
    """Return (items, marks, streams): items=[(clips,in,out)] with one clip id
    per angle (clips[0] = base angle), marks=[(playitem_idx,ts)], streams[i] =
    i-th PlayItem's STN stream list."""
    data = open(path, "rb").read()
    if data[0:4] != b"MPLS":
        sys.exit(f"{path}: not an MPLS file")
    pl_start = int.from_bytes(data[8:12], "big")
    mark_start = int.from_bytes(data[12:16], "big")

    n_items = int.from_bytes(data[pl_start + 6:pl_start + 8], "big")
    pos, items, streams = pl_start + 10, [], []
    def clip_id(raw):
        if len(raw) != 5 or not raw.isdigit():
            sys.exit(f"{path}: malformed PlayItem (bad clip id {raw!r})")
        return raw.decode("ascii")

    for _ in range(n_items):
        length = int.from_bytes(data[pos:pos + 2], "big")
        it = data[pos + 2:pos + 2 + length]
        if len(it) < 20:
            sys.exit(f"{path}: malformed PlayItem ({len(it)} bytes)")
        stn_off = 32
        clips = [clip_id(it[0:5])]
        if (it[10] >> 4) & 1:                    # is_multi_angle
            n_extra = it[32] - 1 if len(it) > 32 else -1
            if n_extra < 0 or len(it) < 34 + 10 * n_extra:
                sys.exit(f"{path}: truncated multi-angle table in PlayItem")
            for a in range(n_extra):             # entries: clip(5)+codec(4)+stc(1)
                off = 34 + 10 * a
                clips.append(clip_id(it[off:off + 5]))
            stn_off = 34 + 10 * n_extra
        items.append((clips,
                      int.from_bytes(it[12:16], "big"),
                      int.from_bytes(it[16:20], "big")))
        streams.append(parse_stn(it, stn_off))
        pos += 2 + length

    marks = []
    if mark_start and mark_start + 6 <= len(data):
        n_marks = int.from_bytes(data[mark_start + 4:mark_start + 6], "big")
        mp = mark_start + 6
        for _ in range(n_marks):
            m = data[mp:mp + 14]
            if len(m) < 8:
                break
            if m[1] == 1:  # mark_type 1 = chapter/entry mark
                marks.append((int.from_bytes(m[2:4], "big"),
                              int.from_bytes(m[4:8], "big")))
            mp += 14
    return items, marks, streams


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
    the length fields, classifies each stream via STREAM_CODECS (unmapped
    coding types become kind "other"), never reads past the table."""
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


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def comment_safe(s):
    """Strip anything that could end a generated build.sh comment and start a
    new (executable) line. load_project already rejects such names; this keeps
    a future non-project caller from reintroducing the hole."""
    return "".join(" " if ord(c) < 0x20 or ord(c) == 0x7F else c for c in str(s))


def emit_progress(clip, done, total):
    """One progress line on stderr, shared by scan and build so both speak the
    same JSON-lines contract."""
    print(json.dumps({"type": "progress", "clip": clip,
                      "done": done, "total": total}),
          file=sys.stderr, flush=True)


def uid_for(clip_id):
    return "%032x" % int(clip_id)


def uid():
    """Random nonzero 64-bit Edition UID (unique across files, per spec)."""
    return random.randrange(1, 1 << 64)


def fmt_ns(ns):
    s, ns = divmod(int(ns), NS)
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    return f"{h:02d}:{m:02d}:{s:02d}.{ns:09d}"


def ffprobe_duration_ns(path):
    out = subprocess.check_output(
        ["ffprobe", "-v", "0", "-show_entries", "format=duration",
         "-of", "csv=p=0", path]).decode().strip()
    return int(round(float(out) * NS))


def frame_info(path, count=True):
    """(codec, frames|None, fps_num, fps_den). Container metadata; counts only if needed."""
    def probe(extra):
        return subprocess.check_output(
            ["ffprobe", "-v", "0", "-select_streams", "v:0"] + extra + [path]).decode()
    d = dict(l.split("=", 1) for l in probe(
        ["-show_entries", "stream=codec_name,r_frame_rate,nb_frames", "-of", "default=nw=1"]
    ).splitlines() if "=" in l)
    rfr = (d.get("r_frame_rate", "0/1").split("/") + ["1"])[:2]
    num, den = int(rfr[0]), int(rfr[1] or 1)
    nbf = d.get("nb_frames", "N/A")
    if not nbf.isdigit() and count:  # m2ts often lacks nb_frames -> count (slow but exact)
        d2 = dict(l.split("=", 1) for l in probe(
            ["-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "default=nw=1"]
        ).splitlines() if "=" in l)
        nbf = d2.get("nb_read_frames", "N/A")
    return d.get("codec_name", ""), (int(nbf) if nbf.isdigit() else None), num, den


def clip_duration_ns(frames, num, den, path):
    """Frame-exact duration when possible (frames * den/num), else container duration."""
    if frames and num:
        return int(round(frames * den * NS / num))
    return ffprobe_duration_ns(path)


def cache_key(path, st=None):
    """Cache filename for one clip: basename (for humans) + a hash of the
    ABSOLUTE path + size + mtime. The path hash is what keeps two discs that
    share a cache dir - both have a 00001.m2ts - from colliding."""
    st = st or os.stat(path)
    h = hashlib.sha1(os.path.abspath(path).encode()).hexdigest()[:12]
    return f"{os.path.basename(path)}.{h}.{st.st_size}.{int(st.st_mtime)}.json"


def probe_clip(path, fast=False, cache_dir=None):
    """ffprobe + mkvmerge -J for one clip, optionally through a cache keyed by
    abspath/size/mtime. fast skips frame counting (frames=None); a cached full
    result satisfies a fast request; a fast entry is upgraded in place when a
    full probe is asked for. A changed clip gets a new key (old entry orphaned)."""
    st = os.stat(path)
    key = cache_key(path, st)
    cf = os.path.join(cache_dir, key) if cache_dir else None
    if cf and os.path.exists(cf):
        try:
            got = json.load(open(cf))
            if fast or got["frames"] is not None:
                return got
        except (json.JSONDecodeError, OSError):
            pass  # corrupt/truncated entry (e.g. interrupted write) - re-probe
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
        fd, tmp = tempfile.mkstemp(dir=cache_dir, prefix=key + ".")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(got, f)
            os.replace(tmp, cf)  # atomic: readers see old or complete entry, never partial
        except BaseException:
            os.unlink(tmp)
            raise
    return got


def marks_by_item(items, marks):
    """Mark offsets within each PlayItem, positionally parallel to items, so a
    playlist's marks stay bound to the occurrence that carried them (a clip may
    appear more than once in one edition)."""
    per = [set() for _ in items]
    for pi, ts in marks:
        if pi >= len(items):
            continue
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


def sweep_playlists(bdmv):
    """Parse every playlist in BDMV/PLAYLIST once. Returns (playlists,
    clip_marks, clip_streams, warnings). Marks are unioned per clip across
    playlists. Streams are NOT unioned: each clip keeps the RICHEST STN list
    seen (most entries; first seen wins a tie), because 00000.mpls is usually
    the FirstPlay/menu playlist and often carries a restricted stream list for
    a clip the feature plays in full - letting it win would feed
    check_track_layout a wrong layout and make a good disc unbuildable.
    A malformed .mpls becomes a warning, not a fatal error (real discs carry
    menu/junk playlists)."""
    pl_dir = os.path.join(bdmv, "PLAYLIST")
    if not os.path.isdir(pl_dir):
        sys.exit(f"{pl_dir}: no such directory - expected a BDMV folder "
                 "containing PLAYLIST/ and STREAM/ (pass .../BDMV, not the "
                 "disc root)")
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
                if c not in cstreams or len(st) > len(cstreams[c]):
                    cstreams[c] = st
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


def clip_track_opts(streams, tracks_sel, tracks):
    """Returns (opts, unresolved): mkvmerge options placed before ONE input
    file, realizing the project's slot selection on this clip, plus the slot
    ids that could not be resolved to a track id at all. TIDs come from
    matching the STN PID against mkvmerge -J properties.number; if a PID is
    missing, fall back to pairing the k-th STN stream of a kind with
    mkvmerge's k-th track of that type. Video is always kept.

    An unresolved slot means the STN and the probe disagree; dropping it
    silently produces exactly the mis-paired append check_track_layout exists
    to prevent, so the caller decides (fatal when appending). Returning it
    rather than exiting here keeps this function mode-agnostic."""
    keep = {t["slot"]: t for t in tracks_sel if t.get("keep")}
    by_pid = {t["pid"]: t["tid"] for t in tracks if t.get("pid") is not None}
    typed = {"audio": [t["tid"] for t in tracks if t["type"] == "audio"],
             "subtitle": [t["tid"] for t in tracks if t["type"] == "subtitles"]}
    seen, aud, sub, extra, unresolved = {}, [], [], [], []
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
            unresolved.append(sid)
            continue
        (aud if s["kind"] == "audio" else sub).append(tid)
        lang = sel.get("lang") or s["lang"]
        if lang:
            extra.append("--language " + shlex.quote(f"{tid}:{lang}"))
        if "default" in sel:
            extra.append(
                f"--default-track-flag {tid}:{1 if sel['default'] else 0}")
    opts = ["--audio-tracks " + ",".join(map(str, sorted(aud)))
            if aud else "--no-audio",
            "--subtitle-tracks " + ",".join(map(str, sorted(sub)))
            if sub else "--no-subtitles"]
    return opts + extra, unresolved


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


def unique_clips(editions):
    """All clip ids across editions, first-appearance order."""
    order, seen = [], set()
    for _n, items, _m in editions:
        for c, _i, _o in items:
            if c not in seen:
                seen.add(c)
                order.append(c)
    return order


def input_spec(stream, clip, clip_opts):
    """One mkvmerge input: its per-clip track options (if any) followed by the
    quoted path. Shared by all three modes so option emission lives in one
    place."""
    q = shlex.quote(os.path.join(stream, f"{clip}.m2ts"))
    o = " ".join(clip_opts.get(clip, [])) if clip_opts else ""
    return f"{o} {q}".strip()


def write_qpfile(path, clips, clipinfo):
    """Force an IDR at each clip join (cumulative frame numbers, x264/x265
    --qpfile format). False if any clip's frame count is unknown."""
    cum, joins = 0, []
    for c in clips:
        if clipinfo[c].frames is None:
            return False
        cum += clipinfo[c].frames
        joins.append(cum)
    # drop the final boundary (end of file)
    open(path, "w").write("".join(f"{n} I\n" for n in joins[:-1]))
    return True


def vc1_warnings(clipinfo, mode):
    """mkvmerge append skips one frame per splice on VC-1 (V_MS/VFW stores DTS;
    decoder delay compensates once per file, not per splice - mkvtoolnix#6194).
    linked mode never appends, so only flat/xin1 are affected."""
    if mode == "linked":
        return []
    bad = sorted(c for c, ci in clipinfo.items() if ci.codec == "vc1")
    if not bad:
        return []
    return [f"VC-1 video ({', '.join(bad)}): mkvmerge skips one frame per append "
            "splice (mkvtoolnix#6194) - use --mode linked, which never appends."]


def partial_clip_warnings(editions, clipinfo):
    """(linked mode) A PlayItem spanning less than its whole clip needs its atom
    fixed by hand. MPLS out_time is unreliable (aobikari's finding), so also
    accept the span implied by the NEXT item's in_time before warning."""
    warns, seen = [], set()
    for _n, items, _m in editions:
        for i, (c, in_t, out_t) in enumerate(items):
            spans = {out_t - in_t}
            if i + 1 < len(items):
                spans.add(items[i + 1][1] - in_t)
            if all(abs(s * NS / TICKS - clipinfo[c].dur) > 500_000_000 for s in spans):
                msg = (f"clip {c}: playlist references only "
                       f"{fmt_ns(int((out_t - in_t) * NS / TICKS))} of a "
                       f"{fmt_ns(clipinfo[c].dur)} clip - atom uses WHOLE clip; fix by hand.")
                if msg not in seen:
                    seen.add(msg)
                    warns.append(msg)
    return warns


# ---------------------------------------------------------------------------
# args
# ---------------------------------------------------------------------------
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


def check_name(path, field, val):
    """A project is shareable, attacker-influenceable input, and title/edition
    names are interpolated into a generated SHELL SCRIPT (comment lines) and
    into output filenames. Control characters would let a name close the
    comment and start a command; separators and ".." would write outside
    out_dir. Reject both at the boundary."""
    if not isinstance(val, str) or not val:
        sys.exit(f"{path}: {field} must be a non-empty string")
    bad = next((c for c in val if ord(c) < 0x20 or ord(c) == 0x7F), None)
    if bad is not None:
        sys.exit(f"{path}: {field} contains a control character "
                 f"(0x{ord(bad):02x}) - it would inject lines into build.sh")
    if "/" in val or "\\" in val:
        sys.exit(f"{path}: {field} contains a path separator - "
                 "it would write outside the output directory")
    if any(part == ".." for part in val.replace("\\", "/").split("/")):
        sys.exit(f"{path}: {field} contains a '..' path component - "
                 "it would write outside the output directory")


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
    check_name(path, "title", p["title"])
    if not isinstance(p["editions"], list) or not p["editions"]:
        sys.exit(f"{path}: editions must be a non-empty list")
    for i, ed in enumerate(p["editions"]):
        if not isinstance(ed, dict) or not ed.get("name") or not ed.get("clips"):
            sys.exit(f"{path}: every edition needs a name and clips")
        check_name(path, f"editions[{i}].name", ed["name"])
    if "tracks" in p:
        if not isinstance(p["tracks"], list):
            sys.exit(f"{path}: tracks must be a list")
        for i, t in enumerate(p["tracks"]):
            if not isinstance(t, dict) or not isinstance(t.get("slot"), str):
                sys.exit(f"{path}: tracks[{i}] must be an object with a "
                         "string 'slot'")
    return p


def load_editions(bdmv, eds):
    """Parse each playlist; a multi-angle playlist expands to one edition per
    angle (angle k plays each item's k-th clip, base clip where absent)."""
    out = []
    for name, mpls in eds:
        if not os.path.isabs(mpls) and not os.path.exists(mpls):
            mpls = os.path.join(bdmv, "PLAYLIST", mpls)
        items, marks, _streams = parse_mpls(mpls)
        n_ang = max((len(clips) for clips, _i, _o in items), default=1)
        if n_ang > 1:
            print(f"  {name}: {n_ang} angles -> {n_ang} editions")
            counts = {len(clips) for clips, _i, _o in items if len(clips) > 1}
            if len(counts) > 1:
                print(f"  ! {name}: inconsistent angle counts across PlayItems "
                      f"({', '.join(map(str, sorted(counts)))}) - missing angles reuse the base clip")
        valid = [(pi, ts) for pi, ts in marks if pi < len(items)]
        if len(valid) != len(marks):
            print(f"  ! {name}: {len(marks) - len(valid)} chapter mark(s) reference "
                  "missing PlayItems - dropped")
        marks = valid
        im = marks_by_item(items, marks)
        for a in range(n_ang):
            ed_name = name if a == 0 else f"{name} (Angle {a + 1})"
            ed_items = [(clips[a] if a < len(clips) else clips[0], i, o)
                        for clips, i, o in items]
            out.append((ed_name, ed_items, im))
    return out


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


# ---------------------------------------------------------------------------
# chapters XML
# ---------------------------------------------------------------------------
def simple_chapters_xml(positions):
    """Plain (non-ordered) chapters - used by flat --preserve-chapters."""
    x = ['<?xml version="1.0" encoding="UTF-8"?>',
         '<!DOCTYPE Chapters SYSTEM "matroskachapters.dtd">',
         "<Chapters>", "  <EditionEntry>"]
    for n, p in enumerate([0] + positions, 1):
        x += ["    <ChapterAtom>",
              f"      <ChapterTimeStart>{fmt_ns(p)}</ChapterTimeStart>",
              "      <ChapterDisplay>",
              f"        <ChapterString>Chapter {n:02d}</ChapterString>",
              "        <ChapterLanguage>eng</ChapterLanguage>",
              "      </ChapterDisplay>", "    </ChapterAtom>"]
    x += ["  </EditionEntry>", "</Chapters>"]
    return "\n".join(x) + "\n"


def atom_xml(start, end, hidden, name, seg_uid=None):
    a = ["    <ChapterAtom>",
         f"      <ChapterTimeStart>{fmt_ns(start)}</ChapterTimeStart>",
         f"      <ChapterTimeEnd>{fmt_ns(end)}</ChapterTimeEnd>"]
    if seg_uid:
        a.append(f'      <ChapterSegmentUID format="hex">{seg_uid}</ChapterSegmentUID>')
    a += [f"      <ChapterFlagHidden>{1 if hidden else 0}</ChapterFlagHidden>",
          "      <ChapterFlagEnabled>1</ChapterFlagEnabled>"]
    if not hidden:
        a += ["      <ChapterDisplay>",
              f"        <ChapterString>{xml_escape(name)}</ChapterString>",
              "        <ChapterLanguage>eng</ChapterLanguage>", "      </ChapterDisplay>"]
    a.append("    </ChapterAtom>")
    return a


def edition_atom_specs(name, items, clipinfo, positions):
    """Yield (clip, start, end, hidden, label) atoms for one ordered edition;
    start/end are within-clip ns. positions=None -> one visible whole-clip atom
    per item. Else split each clip at the disc-mark positions: pieces starting
    at a mark are visible chapters; pieces starting at a segment boundary are
    hidden "joins", except the very first (= movie start, visible Chapter 01)
    and joins that coincide with a disc mark (real discs put most chapters
    exactly at splice points - those joins ARE the chapters)."""
    if positions is None:
        for n, (c, _i, _o) in enumerate(items, 1):
            yield c, 0, clipinfo[c].dur, False, f"{name} {n:02d}"
        return
    voff, first, ch = 0, True, 0
    for c, _i, _o in items:
        dur = clipinfo[c].dur
        lm = [p - voff for p in positions if voff + JOIN_TOL_NS < p < voff + dur]
        mark_at_join = any(abs(p - voff) <= JOIN_TOL_NS for p in positions)
        bounds = [0] + lm + [dur]
        for k in range(len(bounds) - 1):
            hidden = (k == 0 and not first and not mark_at_join)
            if not hidden:
                ch += 1
            yield c, bounds[k], bounds[k + 1], hidden, f"Chapter {ch:02d}"
        voff += dur
        first = False


def editions_xml(editions, clipinfo, preserve, atom_fn):
    """chapters.xml + tags.xml for ordered editions (linked & xin1 modes).
    atom_fn maps an atom spec to XML lines (adding SegmentUID links or physical
    file offsets, per mode)."""
    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<!DOCTYPE Chapters SYSTEM "matroskachapters.dtd">', "<Chapters>"]
    tags = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<!DOCTYPE Tags SYSTEM "matroskatags.dtd">', "<Tags>"]
    for idx, (name, items, marks) in enumerate(editions):
        ed = uid()
        xml += ["  <EditionEntry>",
                f"    <EditionUID>{ed}</EditionUID>",
                "    <EditionFlagOrdered>1</EditionFlagOrdered>",
                f"    <EditionFlagDefault>{1 if idx == 0 else 0}</EditionFlagDefault>",
                "    <EditionDisplay>",
                f"      <EditionString>{xml_escape(name)}</EditionString>",
                "    </EditionDisplay>"]
        positions = (edition_mark_positions(items, marks, clipinfo)
                     if preserve and any(marks) else None)
        for spec in edition_atom_specs(name, items, clipinfo, positions):
            xml += atom_fn(*spec)
        xml.append("  </EditionEntry>")
        tags += ["  <Tag>",
                 f"    <Targets><EditionUID>{ed}</EditionUID></Targets>",
                 "    <Simple><Name>TITLE</Name>"
                 f"<String>{xml_escape(name)}</String></Simple>", "  </Tag>"]
    xml.append("</Chapters>")
    tags.append("</Tags>")
    return "\n".join(xml) + "\n", "\n".join(tags) + "\n"


# ---------------------------------------------------------------------------
# flat mode
# ---------------------------------------------------------------------------
def build_flat(stream, out_dir, title, editions, clipinfo, preserve, qpfile,
               clip_opts=None):
    lines = ["#!/usr/bin/env bash", "set -euo pipefail", "",
             "# flat mode: each cut is a real linear track -> plays on Plex/Jellyfin/Emby.",
             "# Shared video is duplicated across files (unavoidable for ffmpeg players).", ""]
    outputs = []
    for name, items, marks in editions:
        appended = " + ".join(input_spec(stream, c, clip_opts)
                              for c, _i, _o in items)
        outfn = f"{title} {{edition-{name}}}.mkv"
        outputs.append(outfn)

        if preserve and any(marks):
            positions = edition_mark_positions(items, marks, clipinfo)
            chapfn = f"{title}.{name}.chapters.xml"
            open(os.path.join(out_dir, chapfn), "w").write(simple_chapters_xml(positions))
            chap = f"--chapters {shlex.quote(chapfn)}"
        else:
            chap = "--generate-chapters when-appending"

        lines.append(f"# {comment_safe(name)}: {len(items)} segments")
        lines.append(f"mkvmerge -o {shlex.quote(outfn)} {chap} {appended}")
        lines.append("")

        if qpfile:
            qfn = f"{title}.{name}.qpfile.txt"
            if write_qpfile(os.path.join(out_dir, qfn),
                            [c for c, _i, _o in items], clipinfo):
                lines.append(f"# re-encode seam list -> {comment_safe(qfn)}"
                             " (x264/x265 --qpfile)")
            else:
                lines.append(f"# {comment_safe(qfn)} skipped: "
                             "frame counts unavailable")
            lines.append("")
    return "\n".join(lines) + "\n", outputs


# ---------------------------------------------------------------------------
# linked mode (ordered chapters + segment linking)
# ---------------------------------------------------------------------------
def build_linked(stream, out_dir, title, editions, clipinfo, preserve,
                 clip_opts=None):
    order = unique_clips(editions)
    remux = [f"mkvmerge -o seg{c}.mkv --no-chapters --segment-uid 0x{uid_for(c)} "
             f"{input_spec(stream, c, clip_opts)}" for c in order]

    def atom_fn(clip, start, end, hidden, label):
        return atom_xml(start, end, hidden, label, seg_uid=uid_for(clip))

    xml, tags = editions_xml(editions, clipinfo, preserve, atom_fn)
    open(os.path.join(out_dir, "chapters.xml"), "w").write(xml)
    open(os.path.join(out_dir, "tags.xml"), "w").write(tags)

    first = editions[0][1][0][0]
    master = (f"mkvmerge -o {shlex.quote(title + '.mkv')} "
              "--segment-uid 0x000000000000000000000000000000ff "
              "--chapters chapters.xml --global-tags tags.xml "
              f"{shlex.quote('seg' + first + '.mkv')}")

    lines = ["#!/usr/bin/env bash", "set -euo pipefail", "",
             "# linked mode: mpv-ONLY. Keep every seg*.mkv beside "
             f"{comment_safe(title)}.mkv.",
             "# Do NOT let a media server scan this folder (it can't assemble editions).", "",
             "# 1. remux each unique on-disc segment (fixed SegmentUID, no stray chapters)"]
    lines += remux
    lines += ["", "# 2. mux the husk carrying the editions + edition names", master, ""]
    return "\n".join(lines) + "\n", partial_clip_warnings(editions, clipinfo)


# ---------------------------------------------------------------------------
# xin1 mode (one file, in-file ordered-chapter editions)
# ---------------------------------------------------------------------------
def build_xin1(stream, out_dir, title, editions, clipinfo, preserve, qpfile,
               clip_opts=None):
    order = unique_clips(editions)
    poff, off = {}, 0                 # physical ns offset of each clip in the file
    for c in order:
        poff[c] = off
        off += clipinfo[c].dur

    def atom_fn(clip, start, end, hidden, label):
        return atom_xml(poff[clip] + start, poff[clip] + end, hidden, label)

    xml, tags = editions_xml(editions, clipinfo, preserve, atom_fn)
    open(os.path.join(out_dir, "chapters.xml"), "w").write(xml)
    open(os.path.join(out_dir, "tags.xml"), "w").write(tags)

    outfn = f"{title}.mkv"
    appended = " + ".join(input_spec(stream, c, clip_opts) for c in order)
    lines = ["#!/usr/bin/env bash", "set -euo pipefail", "",
             "# xin1 mode: every unique clip stored ONCE in one file; each edition is",
             "# an ordered-chapter timeline seeking inside it. Alternate cuts are",
             "# mpv-only; other players see the raw concatenation (skewed runtime).", "",
             f"# {len(order)} unique clips, {len(editions)} editions",
             f"mkvmerge -o {shlex.quote(outfn)} --chapters chapters.xml "
             f"--global-tags tags.xml {appended}", ""]
    if qpfile:
        qfn = f"{title}.qpfile.txt"
        if write_qpfile(os.path.join(out_dir, qfn), order, clipinfo):
            lines.append(f"# re-encode seam list -> {comment_safe(qfn)}"
                         " (x264/x265 --qpfile)")
        else:
            lines.append(f"# {comment_safe(qfn)} skipped: "
                         "frame counts unavailable")
        lines.append("")
    return "\n".join(lines) + "\n", outfn


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
        emit_progress(c, done, len(order))
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


def main():
    args = parse_args(sys.argv[1:])
    if args.seed is not None:
        random.seed(args.seed)
    if args.scan:
        run_scan(args)
        return
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
        clipinfo, probes = gather_clips(stream, clip_order, fast=args.fast,
                                        cache_dir=args.cache,
                                        progress=emit_progress)
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
                                        fast=args.fast, cache_dir=args.cache,
                                        progress=emit_progress)
    os.makedirs(out_dir, exist_ok=True)

    warnings = vc1_warnings(clipinfo, mode)
    clip_opts = None
    if tracks_sel:
        warnings += check_track_layout(editions, tracks_sel, cstreams, mode)
        clip_opts, unresolved = {}, []
        for c in probes:
            clip_opts[c], miss = clip_track_opts(
                cstreams.get(c, []), tracks_sel, probes[c]["tracks"])
            unresolved += [f"clip {c}: selected slot {sid} matched no track in "
                           "the file (STN/probe disagreement) - appending "
                           "would mis-pair tracks" for sid in miss]
        if unresolved:
            if mode in ("flat", "xin1"):
                sys.exit("ERROR: " + "\nERROR: ".join(unresolved))
            warnings += unresolved
    if mode == "flat":
        script, outputs = build_flat(stream, out_dir, title, editions, clipinfo,
                                     preserve, qpfile, clip_opts=clip_opts)
        summary = "\n".join(f"  {o}" for o in outputs)
    elif mode == "xin1":
        script, outfn = build_xin1(stream, out_dir, title, editions, clipinfo,
                                   preserve, qpfile, clip_opts=clip_opts)
        summary = f"  {outfn} (one file, ordered-chapter editions) - alternate cuts mpv only"
    else:
        script, w = build_linked(stream, out_dir, title, editions, clipinfo, preserve,
                                 clip_opts=clip_opts)
        warnings += w
        summary = f"  {title}.mkv (+ seg*.mkv, chapters.xml, tags.xml) - mpv only"

    with open(os.path.join(out_dir, "build.sh"), "w") as f:
        f.write(script)
    os.chmod(os.path.join(out_dir, "build.sh"), 0o755)

    print(f"mode: {mode}  preserve-chapters: {preserve}  qpfile: {qpfile}")
    print("editions: " + ", ".join(
        f"{n} ({len(i)} segs, {sum(len(v) for v in m)} marks)"
        for n, i, m in editions))
    print(f"wrote {out_dir}/build.sh -> produces:\n{summary}")
    if qpfile and mode in ("flat", "xin1"):
        # --fast leaves frames=None, so write_qpfile degrades to a comment
        if any(ci.frames is None for ci in clipinfo.values()):
            print("  qpfile(s) SKIPPED: frame counts unavailable "
                  "(--fast) - re-run without --fast to emit them")
        else:
            print("  qpfile(s) written - consume only if you RE-ENCODE a cut:")
            print("    x264 --qpfile <file>.qpfile.txt ...   |   x265 --qpfile <file>.qpfile.txt ...")
    for w in warnings:
        print("  ! " + w)


if __name__ == "__main__":
    main()
