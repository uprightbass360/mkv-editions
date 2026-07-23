#!/usr/bin/env python3
"""
make-sample.py - generate a synthetic, decrypted-BD-style sample tree for
validating gen-editions.py. No copyrighted material: every segment is a short
solid-colour clip with its number burned in, plus a distinct sine tone.

It builds four playlists that exercise every case at once:
  Theatrical (00001.mpls): 1 2 3 4 5
  Extended   (00002.mpls): 1 2 11 4 12 5 13
    -> 3 swapped for 11, 12 & 13 are extended-ONLY additions, positions shift.
  Angled     (00003.mpls): 1 2 [3|21] 4 5
    -> ONE playlist, TWO angles: slot 3 plays clip 3 (angle 1) or 21 (angle 2);
       gen-editions.py auto-expands it into one edition per angle.
  Mismatch   (00004.mpls): 1 31
    -> 00031 has only one audio track (eng); exercises the append track-layout
       mismatch guard.

All segments share identical codecs/resolution (except 00031's audio track
count), so both mkvmerge append (flat/xin1) and mpv segment linking (linked)
are valid.

Usage:
  make-sample.py [out_dir]            # default ./sample
Then:
  ./mkv-editions.sh <out_dir>/BDMV ./out --title Sample \\
      "Theatrical=00001.mpls" "Extended=00002.mpls"
  cd out && bash build.sh

Requires ffmpeg on PATH.
"""

import os
import sys
import struct
import shutil
import subprocess

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

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


def write_mpls(path, slots, durs):
    """MPLS with real full-layout PlayItems (IN=0, OUT=duration) and a chapter
    mark 2s into each segment (PlayListMark), so --preserve-chapters has data
    to read. A slot given as a tuple is multi-angle: one clip per angle."""
    items = b""
    for slot in slots:
        clips = [slot] if isinstance(slot, str) else list(slot)
        out_t = int(durs[clips[0]] * 45000)
        multi = len(clips) > 1
        it = (clips[0].encode() + b"M2TS"
              + bytes([0x00, 0x10 if multi else 0x00])  # 11 reserved bits, is_multi_angle, connection_condition
              + b"\x00"                                 # stc_id
              + struct.pack(">I", 0) + struct.pack(">I", out_t)
              + b"\x00" * 8                             # uo_mask
              + b"\x00" * 4)                            # flags, still_mode, still_time
        if multi:
            it += bytes([len(clips), 0x00])             # angle count, angle flags
            for c in clips[1:]:
                it += c.encode() + b"M2TS" + b"\x00"    # clip, codec, stc_id
        items += struct.pack(">H", len(it)) + it
    pl_after = struct.pack(">H", 0) + struct.pack(">H", len(slots)) + struct.pack(">H", 0) + items
    playlist_block = struct.pack(">I", len(pl_after)) + pl_after

    marks = [(i, 2 * 45000) for i in range(len(slots))]   # 2s into each PlayItem
    entries = b""
    for pi, ts in marks:
        entries += (b"\x00" + b"\x01" + struct.pack(">H", pi)      # reserved, type=chapter, ref
                    + struct.pack(">I", ts) + b"\x00\x00" + struct.pack(">I", 0))
    mk_after = struct.pack(">H", len(marks)) + entries
    mark_block = struct.pack(">I", len(mk_after)) + mk_after

    pl_addr = 40
    mark_addr = pl_addr + len(playlist_block)
    header = (b"MPLS0200" + struct.pack(">I", pl_addr) + struct.pack(">I", mark_addr)
              + struct.pack(">I", 0) + b"\x00" * 20)          # 40-byte header
    open(path, "wb").write(header + playlist_block + mark_block)


def main(out_dir=None):
    out_dir = out_dir or (sys.argv[1] if len(sys.argv) > 1 else "sample")
    stream = os.path.join(out_dir, "BDMV", "STREAM")
    playlist = os.path.join(out_dir, "BDMV", "PLAYLIST")
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(stream); os.makedirs(playlist)

    durs = {}
    langmap = {}
    for seg_id, tag, colour, dur, hz, langs in SEGMENTS:
        print(f"  encoding {seg_id} ({tag}, {dur}s)")
        make_segment(os.path.join(stream, f"{seg_id}.m2ts"), seg_id, tag, colour, dur, hz, langs)
        durs[seg_id] = dur
        langmap[seg_id] = langs

    write_mpls(os.path.join(playlist, "00001.mpls"), THEATRICAL, durs)
    write_mpls(os.path.join(playlist, "00002.mpls"), EXTENDED, durs)
    write_mpls(os.path.join(playlist, "00003.mpls"), ANGLED, durs)
    write_mpls(os.path.join(playlist, "00004.mpls"), MISMATCH, durs)

    def slot_str(s):
        return s if isinstance(s, str) else "[" + "|".join(s) + "]"

    print(f"\nSample BDMV at: {out_dir}/BDMV")
    print(f"  Theatrical (00001.mpls): {' '.join(THEATRICAL)}")
    print(f"  Extended   (00002.mpls): {' '.join(EXTENDED)}")
    print(f"  Angled     (00003.mpls): {' '.join(slot_str(s) for s in ANGLED)}  (2 angles)")
    print(f"  Mismatch   (00004.mpls): {' '.join(MISMATCH)}")
    print("\nNext:")
    print(f'  ./mkv-editions.sh {out_dir}/BDMV ./out --title Sample \\')
    print('      "Theatrical=00001.mpls" "Extended=00002.mpls"')
    print("  cd out && bash build.sh")


if __name__ == "__main__":
    main()
