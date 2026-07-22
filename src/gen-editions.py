#!/usr/bin/env python3
"""
gen-editions.py — build editioned MKVs from a decrypted BD backup by reading
the on-disc .mpls play order.

MODES
  flat    (default) One self-contained file per edition, produced by appending
          the on-disc segments with mkvmerge. Plays on ANY player, including
          Plex / Jellyfin / Emby, because each cut is a real linear track.
          Cost: shared video is duplicated on disk — the unavoidable price of
          ffmpeg not honoring ordered chapters. Files are named for the media
          server "Editions" feature:  "<title> {edition-Name}.mkv".

  linked  Space-efficient, but mpv-ONLY. Theatrical husk + external per-segment
          files joined by ordered chapters / segment linking. Shared segments
          are stored once. ffmpeg-based media servers CANNOT assemble the
          extended cut from this — they'll only ever see the theatrical husk.

USAGE
  gen-editions.py <BDMV_dir> <out_dir> [--mode flat|linked] [--title NAME]
                  "<Edition Name>=<playlist.mpls>" [ "<Edition Name>=..." ] ...

EXAMPLE
  gen-editions.py /mnt/backup/BDMV ./out --title "The Fellowship of the Ring" \\
      "Theatrical Cut=00001.mpls" "Extended Cut=00002.mpls"

Then:  cd out && bash build.sh

Requires mkvmerge on PATH (+ ffprobe for --mode linked). The .mpls PlayItem list
is parsed directly (no libbluray/mpls_dump needed); MPLS timestamps are 45 kHz.
"""

import os
import sys
import shlex
import subprocess

TICKS_PER_SEC = 45000  # MPLS IN/OUT times are 45 kHz


def parse_mpls(path):
    """Return [(clip_id, in_tick, out_tick), ...] in play order."""
    data = open(path, "rb").read()
    if data[0:4] != b"MPLS":
        sys.exit(f"{path}: not an MPLS file")
    pl_start = int.from_bytes(data[8:12], "big")
    n_items = int.from_bytes(data[pl_start + 6:pl_start + 8], "big")
    pos = pl_start + 10
    items = []
    for _ in range(n_items):
        length = int.from_bytes(data[pos:pos + 2], "big")
        it = data[pos + 2:pos + 2 + length]
        clip = it[0:5].decode("ascii")            # "00001" -> STREAM/00001.m2ts
        in_t = int.from_bytes(it[12:16], "big")
        out_t = int.from_bytes(it[16:20], "big")
        items.append((clip, in_t, out_t))
        pos += 2 + length
    return items


def uid_for(clip_id):
    """Deterministic 32-hex-char SegmentUID derived from the clip number."""
    return "%032x" % int(clip_id)


def fmt_ns(ns):
    s, ns = divmod(ns, 1_000_000_000)
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    return f"{h:02d}:{m:02d}:{s:02d}.{ns:09d}"


def ffprobe_ns(path):
    out = subprocess.check_output(
        ["ffprobe", "-v", "0", "-show_entries", "format=duration",
         "-of", "csv=p=0", path]).decode().strip()
    return int(round(float(out) * 1_000_000_000))


def parse_args(argv):
    mode, title, pos, eds = "flat", "movie", [], []
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
        if "=" in a and len(pos) >= 2:               # "<Name>=<playlist.mpls>"
            name, mpls = a.split("=", 1)
            eds.append((name, mpls)); i += 1; continue
        pos.append(a); i += 1
    if len(pos) < 2 or not eds or mode not in ("flat", "linked"):
        sys.exit(__doc__)
    return pos[0], pos[1], mode, title, eds


def load_editions(bdmv, eds):
    out = []
    for name, mpls in eds:
        if not os.path.isabs(mpls) and not os.path.exists(mpls):
            mpls = os.path.join(bdmv, "PLAYLIST", mpls)
        out.append((name, parse_mpls(mpls)))
    return out


# ----------------------------------------------------------------------------
# flat mode: one self-contained, server-playable file per edition
# ----------------------------------------------------------------------------
def build_flat(bdmv, out_dir, title, editions):
    stream = os.path.abspath(os.path.join(bdmv, "STREAM"))  # absolute: build.sh runs from out_dir
    lines = ["#!/usr/bin/env bash", "set -euo pipefail", "",
             "# flat mode: each cut is a real linear track -> plays on Plex/Jellyfin/Emby.",
             "# Shared video is duplicated across files (unavoidable for ffmpeg players).", ""]
    outputs = []
    for name, items in editions:
        srcs = [os.path.join(stream, f"{c}.m2ts") for c, _i, _o in items]
        appended = " + ".join(shlex.quote(s) for s in srcs)
        outfn = f"{title} {{edition-{name}}}.mkv"
        outputs.append(outfn)
        lines.append(f"# {name}: {len(items)} segments")
        lines.append(
            f"mkvmerge -o {shlex.quote(outfn)} "
            f"--generate-chapters when-appending {appended}")
        lines.append("")
    return "\n".join(lines) + "\n", outputs


# ----------------------------------------------------------------------------
# linked mode: mpv-only, space-efficient ordered-chapters / segment linking
# ----------------------------------------------------------------------------
def build_linked(bdmv, out_dir, title, editions):
    stream = os.path.abspath(os.path.join(bdmv, "STREAM"))  # absolute: build.sh runs from out_dir
    clips, order = {}, []
    for _n, items in editions:
        for clip, in_t, out_t in items:
            if clip not in clips:
                clips[clip] = (in_t, out_t); order.append(clip)

    remux, seg_files = [], {}
    for clip in order:
        dst = f"seg{clip}.mkv"; seg_files[clip] = dst
        remux.append(
            f"mkvmerge -o {shlex.quote(dst)} --segment-uid 0x{uid_for(clip)} "
            f"{shlex.quote(os.path.join(stream, f'{clip}.m2ts'))}")

    durations, warnings = {}, []
    for clip, (in_t, out_t) in clips.items():
        src = os.path.join(stream, f"{clip}.m2ts")
        try:
            dur_ns = ffprobe_ns(src)
        except Exception as e:
            dur_ns = (out_t - in_t) * 1_000_000_000 // TICKS_PER_SEC
            warnings.append(f"clip {clip}: ffprobe failed ({e}); used mpls span")
        durations[clip] = dur_ns
        span_ns = (out_t - in_t) * 1_000_000_000 // TICKS_PER_SEC
        if abs(span_ns - dur_ns) > 500_000_000:
            warnings.append(
                f"clip {clip}: playlist references only {fmt_ns(span_ns)} of a "
                f"{fmt_ns(dur_ns)} clip — atom uses WHOLE clip; fix in/out by hand.")

    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<!DOCTYPE Chapters SYSTEM "matroskachapters.dtd">', "<Chapters>"]
    for idx, (name, items) in enumerate(editions):
        xml += ["  <EditionEntry>",
                f"    <EditionUID>{idx + 1}</EditionUID>",
                "    <EditionFlagOrdered>1</EditionFlagOrdered>",
                f"    <EditionFlagDefault>{1 if idx == 0 else 0}</EditionFlagDefault>"]
        for n, (clip, _i, _o) in enumerate(items, 1):
            xml += [
                "    <ChapterAtom>",
                "      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>",
                f"      <ChapterTimeEnd>{fmt_ns(durations[clip])}</ChapterTimeEnd>",
                f'      <ChapterSegmentUID format="hex">{uid_for(clip)}</ChapterSegmentUID>',
                "      <ChapterDisplay>",
                f"        <ChapterString>{name} {n:02d} (clip {clip})</ChapterString>",
                "      </ChapterDisplay>",
                "    </ChapterAtom>"]
        xml.append("  </EditionEntry>")
    xml.append("</Chapters>")
    open(os.path.join(out_dir, "chapters.xml"), "w").write("\n".join(xml) + "\n")

    first = editions[0][1][0][0]
    master = (
        f"mkvmerge -o {shlex.quote(title + '.mkv')} "
        "--segment-uid 0x000000000000000000000000000000ff "
        f"--chapters chapters.xml {shlex.quote(seg_files[first])}")

    lines = ["#!/usr/bin/env bash", "set -euo pipefail", "",
             f"# linked mode: mpv-ONLY. Keep every seg*.mkv beside {title}.mkv.",
             "# Do NOT let a media server scan this folder (it can't assemble editions).", "",
             "# 1. remux each unique on-disc segment (fixed SegmentUID)"]
    lines += remux
    lines += ["", "# 2. mux the husk carrying both editions", master, ""]
    return "\n".join(lines) + "\n", warnings


def main():
    bdmv, out_dir, mode, title, eds = parse_args(sys.argv[1:])
    editions = load_editions(bdmv, eds)
    os.makedirs(out_dir, exist_ok=True)

    warnings = []
    if mode == "flat":
        script, outputs = build_flat(bdmv, out_dir, title, editions)
        summary = "\n".join(f"  {o}" for o in outputs)
    else:
        script, warnings = build_linked(bdmv, out_dir, title, editions)
        summary = f"  {title}.mkv (+ seg*.mkv, chapters.xml) — mpv only"

    with open(os.path.join(out_dir, "build.sh"), "w") as f:
        f.write(script)
    os.chmod(os.path.join(out_dir, "build.sh"), 0o755)

    print(f"mode: {mode}")
    print("editions: " + ", ".join(f"{n} ({len(i)} segs)" for n, i in editions))
    print(f"wrote {out_dir}/build.sh -> produces:\n{summary}")
    if warnings:
        print("\nWARNINGS:")
        for w in warnings:
            print("  ! " + w)


if __name__ == "__main__":
    main()
