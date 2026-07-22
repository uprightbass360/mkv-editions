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

USAGE
  gen-editions.py <BDMV_dir> <out_dir> [--mode flat|linked|xin1] [--title NAME]
                  [--preserve-chapters] [--qpfile]
                  "<Edition Name>=<playlist.mpls>" [ ... ]

Requires mkvmerge (+ ffprobe) on PATH. MPLS PlayItem/PlayListMark tables are
parsed directly (no libbluray/mpls_dump needed); MPLS timestamps are 45 kHz.
"""

import os
import random
import sys
import shlex
import subprocess
from collections import namedtuple

TICKS = 45000  # MPLS timestamps are 45 kHz
NS = 1_000_000_000

ClipInfo = namedtuple("ClipInfo", "frames num den dur codec")


# ---------------------------------------------------------------------------
# .mpls parsing (PlayItems + chapter marks)
# ---------------------------------------------------------------------------
def parse_mpls(path):
    """Return (items, marks): items=[(clips,in,out)] with one clip id per angle
    (clips[0] = base angle), marks=[(playitem_idx,ts)]."""
    data = open(path, "rb").read()
    if data[0:4] != b"MPLS":
        sys.exit(f"{path}: not an MPLS file")
    pl_start = int.from_bytes(data[8:12], "big")
    mark_start = int.from_bytes(data[12:16], "big")

    n_items = int.from_bytes(data[pl_start + 6:pl_start + 8], "big")
    pos, items = pl_start + 10, []
    for _ in range(n_items):
        length = int.from_bytes(data[pos:pos + 2], "big")
        it = data[pos + 2:pos + 2 + length]
        clips = [it[0:5].decode("ascii")]
        if (it[10] >> 4) & 1:                    # is_multi_angle
            for a in range(it[32] - 1):          # entries: clip(5)+codec(4)+stc(1)
                off = 34 + 10 * a
                clips.append(it[off:off + 5].decode("ascii"))
        items.append((clips,
                      int.from_bytes(it[12:16], "big"),
                      int.from_bytes(it[16:20], "big")))
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
    return items, marks


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
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


def frame_info(path):
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
    if not nbf.isdigit():  # m2ts often lacks nb_frames -> count (slow but exact)
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


def edition_mark_positions(items, marks, clipinfo):
    """Chapter-mark timestamps mapped to ns offsets on this edition's virtual timeline."""
    offsets, off = [], 0
    for clip, _i, _o in items:
        offsets.append(off)
        off += clipinfo[clip].dur
    out = set()
    for pi, ts in marks:
        if pi >= len(items):
            continue
        _clip, in_t, _out = items[pi]
        p = offsets[pi] + int(round((ts - in_t) * NS / TICKS))
        if p > 0:
            out.add(p)
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
    warns = []
    for _n, items, _m in editions:
        for i, (c, in_t, out_t) in enumerate(items):
            spans = {out_t - in_t}
            if i + 1 < len(items):
                spans.add(items[i + 1][1] - in_t)
            if all(abs(s * NS / TICKS - clipinfo[c].dur) > 500_000_000 for s in spans):
                warns.append(
                    f"clip {c}: playlist references only "
                    f"{fmt_ns(int((out_t - in_t) * NS / TICKS))} of a "
                    f"{fmt_ns(clipinfo[c].dur)} clip - atom uses WHOLE clip; fix by hand.")
    return warns


# ---------------------------------------------------------------------------
# args
# ---------------------------------------------------------------------------
def parse_args(argv):
    mode, title, pos, eds = "flat", "movie", [], []
    preserve = qpfile = False
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
        if "=" in a and len(pos) >= 2:
            name, mpls = a.split("=", 1)
            eds.append((name, mpls)); i += 1; continue
        pos.append(a); i += 1
    if len(pos) < 2 or not eds or mode not in ("flat", "linked", "xin1"):
        sys.exit(__doc__)
    return pos[0], pos[1], mode, title, preserve, qpfile, eds


def load_editions(bdmv, eds):
    """Parse each playlist; a multi-angle playlist expands to one edition per
    angle (angle k plays each item's k-th clip, base clip where absent)."""
    out = []
    for name, mpls in eds:
        if not os.path.isabs(mpls) and not os.path.exists(mpls):
            mpls = os.path.join(bdmv, "PLAYLIST", mpls)
        items, marks = parse_mpls(mpls)
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
        for a in range(n_ang):
            ed_name = name if a == 0 else f"{name} (Angle {a + 1})"
            ed_items = [(clips[a] if a < len(clips) else clips[0], i, o)
                        for clips, i, o in items]
            out.append((ed_name, ed_items, marks))
    return out


def gather_clips(stream, editions):
    info = {}
    for _n, items, _m in editions:
        for clip, _i, _o in items:
            if clip in info:
                continue
            path = os.path.join(stream, f"{clip}.m2ts")
            codec, fr, num, den = frame_info(path)
            info[clip] = ClipInfo(fr, num, den,
                                  clip_duration_ns(fr, num, den, path), codec)
    return info


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
              f"        <ChapterString>{name}</ChapterString>",
              "        <ChapterLanguage>eng</ChapterLanguage>", "      </ChapterDisplay>"]
    a.append("    </ChapterAtom>")
    return a


def edition_atom_specs(name, items, clipinfo, positions):
    """Yield (clip, start, end, hidden, label) atoms for one ordered edition;
    start/end are within-clip ns. positions=None -> one visible whole-clip atom
    per item. Else split each clip at the disc-mark positions: pieces starting
    at a mark are visible chapters; pieces starting at a segment boundary are
    hidden "joins", except the very first (= movie start, visible Chapter 01)."""
    if positions is None:
        for n, (c, _i, _o) in enumerate(items, 1):
            yield c, 0, clipinfo[c].dur, False, f"{name} {n:02d}"
        return
    voff, first, ch = 0, True, 0
    for c, _i, _o in items:
        dur = clipinfo[c].dur
        lm = [p - voff for p in positions if voff < p < voff + dur]
        bounds = [0] + lm + [dur]
        for k in range(len(bounds) - 1):
            hidden = (k == 0 and not first)
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
                f"      <EditionString>{name}</EditionString>", "    </EditionDisplay>"]
        positions = (edition_mark_positions(items, marks, clipinfo)
                     if preserve and marks else None)
        for spec in edition_atom_specs(name, items, clipinfo, positions):
            xml += atom_fn(*spec)
        xml.append("  </EditionEntry>")
        tags += ["  <Tag>",
                 f"    <Targets><EditionUID>{ed}</EditionUID></Targets>",
                 "    <Simple><Name>TITLE</Name>"
                 f"<String>{name}</String></Simple>", "  </Tag>"]
    xml.append("</Chapters>")
    tags.append("</Tags>")
    return "\n".join(xml) + "\n", "\n".join(tags) + "\n"


# ---------------------------------------------------------------------------
# flat mode
# ---------------------------------------------------------------------------
def build_flat(stream, out_dir, title, editions, clipinfo, preserve, qpfile):
    lines = ["#!/usr/bin/env bash", "set -euo pipefail", "",
             "# flat mode: each cut is a real linear track -> plays on Plex/Jellyfin/Emby.",
             "# Shared video is duplicated across files (unavoidable for ffmpeg players).", ""]
    outputs = []
    for name, items, marks in editions:
        srcs = [os.path.join(stream, f"{c}.m2ts") for c, _i, _o in items]
        appended = " + ".join(shlex.quote(s) for s in srcs)
        outfn = f"{title} {{edition-{name}}}.mkv"
        outputs.append(outfn)

        if preserve and marks:
            positions = edition_mark_positions(items, marks, clipinfo)
            chapfn = f"{title}.{name}.chapters.xml"
            open(os.path.join(out_dir, chapfn), "w").write(simple_chapters_xml(positions))
            chap = f"--chapters {shlex.quote(chapfn)}"
        else:
            chap = "--generate-chapters when-appending"

        lines.append(f"# {name}: {len(items)} segments")
        lines.append(f"mkvmerge -o {shlex.quote(outfn)} {chap} {appended}")
        lines.append("")

        if qpfile:
            qfn = f"{title}.{name}.qpfile.txt"
            if write_qpfile(os.path.join(out_dir, qfn),
                            [c for c, _i, _o in items], clipinfo):
                lines.append(f"# re-encode seam list -> {qfn} (x264/x265 --qpfile)")
            else:
                lines.append(f"# {qfn} skipped: frame counts unavailable")
            lines.append("")
    return "\n".join(lines) + "\n", outputs


# ---------------------------------------------------------------------------
# linked mode (ordered chapters + segment linking)
# ---------------------------------------------------------------------------
def build_linked(stream, out_dir, title, editions, clipinfo, preserve):
    order = unique_clips(editions)
    remux = [f"mkvmerge -o seg{c}.mkv --no-chapters --segment-uid 0x{uid_for(c)} "
             f"{shlex.quote(os.path.join(stream, f'{c}.m2ts'))}" for c in order]

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
             f"# linked mode: mpv-ONLY. Keep every seg*.mkv beside {title}.mkv.",
             "# Do NOT let a media server scan this folder (it can't assemble editions).", "",
             "# 1. remux each unique on-disc segment (fixed SegmentUID, no stray chapters)"]
    lines += remux
    lines += ["", "# 2. mux the husk carrying the editions + edition names", master, ""]
    return "\n".join(lines) + "\n", partial_clip_warnings(editions, clipinfo)


# ---------------------------------------------------------------------------
# xin1 mode (one file, in-file ordered-chapter editions)
# ---------------------------------------------------------------------------
def build_xin1(stream, out_dir, title, editions, clipinfo, preserve, qpfile):
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
    appended = " + ".join(shlex.quote(os.path.join(stream, f"{c}.m2ts"))
                          for c in order)
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
            lines.append(f"# re-encode seam list -> {qfn} (x264/x265 --qpfile)")
        else:
            lines.append(f"# {qfn} skipped: frame counts unavailable")
        lines.append("")
    return "\n".join(lines) + "\n", outfn


def main():
    bdmv, out_dir, mode, title, preserve, qpfile, eds = parse_args(sys.argv[1:])
    editions = load_editions(bdmv, eds)
    stream = os.path.abspath(os.path.join(bdmv, "STREAM"))
    os.makedirs(out_dir, exist_ok=True)
    clipinfo = gather_clips(stream, editions)

    warnings = vc1_warnings(clipinfo, mode)
    if mode == "flat":
        script, outputs = build_flat(stream, out_dir, title, editions, clipinfo,
                                     preserve, qpfile)
        summary = "\n".join(f"  {o}" for o in outputs)
    elif mode == "xin1":
        script, outfn = build_xin1(stream, out_dir, title, editions, clipinfo,
                                   preserve, qpfile)
        summary = f"  {outfn} (one file, ordered-chapter editions) - alternate cuts mpv only"
    else:
        script, w = build_linked(stream, out_dir, title, editions, clipinfo, preserve)
        warnings += w
        summary = f"  {title}.mkv (+ seg*.mkv, chapters.xml, tags.xml) - mpv only"

    with open(os.path.join(out_dir, "build.sh"), "w") as f:
        f.write(script)
    os.chmod(os.path.join(out_dir, "build.sh"), 0o755)

    print(f"mode: {mode}  preserve-chapters: {preserve}  qpfile: {qpfile}")
    print("editions: " + ", ".join(
        f"{n} ({len(i)} segs, {len(m)} marks)" for n, i, m in editions))
    print(f"wrote {out_dir}/build.sh -> produces:\n{summary}")
    if qpfile and mode in ("flat", "xin1"):
        print("  qpfile(s) written - consume only if you RE-ENCODE a cut:")
        print("    x264 --qpfile <file>.qpfile.txt ...   |   x265 --qpfile <file>.qpfile.txt ...")
    for w in warnings:
        print("  ! " + w)


if __name__ == "__main__":
    main()
