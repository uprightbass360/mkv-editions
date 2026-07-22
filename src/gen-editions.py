#!/usr/bin/env python3
"""
gen-editions.py — build editioned MKVs (seamless-branching style) from a
decrypted BD backup, by reading the on-disc .mpls play order.

For each named playlist it emits one ordered <EditionEntry>; shared segments
are stored once and referenced by every edition that uses them.

Usage:
    gen-editions.py <BDMV_dir> <out_dir> <name=playlist.mpls> [<name=playlist.mpls> ...]

Example (LOTR: theatrical = 00001.mpls, extended = 00002.mpls):
    gen-editions.py /mnt/backup/BDMV ./out theatrical=00001.mpls extended=00002.mpls

Then:
    cd out && bash build.sh        # remuxes segments + muxes the master
    mpv movie.mkv                  # --edition=0 theatrical, --edition=1 extended

Requires: mkvmerge + ffprobe on PATH. No libbluray/mpls_dump needed — the .mpls
PlayItem list is parsed directly (MPLS timestamps are 45 kHz).
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
        clip = it[0:5].decode("ascii")            # e.g. "00001" -> STREAM/00001.m2ts
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


def main():
    if len(sys.argv) < 4 or "=" not in sys.argv[3]:
        sys.exit(__doc__)
    bdmv, out_dir = sys.argv[1], sys.argv[2]
    stream = os.path.join(bdmv, "STREAM")
    editions = []
    for arg in sys.argv[3:]:
        name, mpls = arg.split("=", 1)
        if not os.path.isabs(mpls):
            mpls = os.path.join(bdmv, "PLAYLIST", mpls)
        editions.append((name, parse_mpls(mpls)))

    os.makedirs(out_dir, exist_ok=True)

    # Unique clips across all editions -> one remux each.
    clips = {}
    order = []
    for _, items in editions:
        for clip, in_t, out_t in items:
            if clip not in clips:
                clips[clip] = (in_t, out_t)
                order.append(clip)

    # 1. build.sh: remux each clip to its own MKV with a fixed SegmentUID.
    remux, seg_files = [], {}
    for clip in order:
        src = os.path.join(stream, f"{clip}.m2ts")
        dst = f"seg{clip}.mkv"
        seg_files[clip] = dst
        remux.append(
            f"mkvmerge -o {shlex.quote(dst)} "
            f"--segment-uid 0x{uid_for(clip)} {shlex.quote(src)}")

    # 2. Durations: probe the SOURCE clip now so we can write the XML in one pass.
    #    (build.sh reproduces the remux; probing the .m2ts gives the same length.)
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
        if abs(span_ns - dur_ns) > 500_000_000:  # >0.5s => partial reference
            warnings.append(
                f"clip {clip}: playlist references only {fmt_ns(span_ns)} of a "
                f"{fmt_ns(dur_ns)} clip — atom uses WHOLE clip; fix in/out by hand.")

    # 3. chapters.xml
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

    # 4. Master mux: body = first clip of first edition, plus the editions.
    first_clip = editions[0][1][0][0]
    master = (
        "mkvmerge -o movie.mkv "
        "--segment-uid 0x000000000000000000000000000000ff "
        "--chapters chapters.xml "
        f"{shlex.quote(seg_files[first_clip])}")

    with open(os.path.join(out_dir, "build.sh"), "w") as f:
        f.write("#!/usr/bin/env bash\nset -euo pipefail\n\n")
        f.write("# 1. remux each on-disc segment to its own MKV (fixed SegmentUID)\n")
        f.write("\n".join(remux) + "\n\n")
        f.write("# 2. mux the master 'playlist' carrying both editions\n")
        f.write(master + "\n")
    os.chmod(os.path.join(out_dir, "build.sh"), 0o755)

    print(f"Wrote {out_dir}/chapters.xml and {out_dir}/build.sh")
    print(f"Editions: " + ", ".join(f"{n}={len(i)} segs" for n, i in editions))
    print(f"Unique segments: {len(order)} (shared clips stored once)")
    if warnings:
        print("\nWARNINGS:")
        for w in warnings:
            print("  ! " + w)


if __name__ == "__main__":
    main()
