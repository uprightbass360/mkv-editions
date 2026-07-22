# Editioned MKV via ordered chapters + segment linking

Rebuild a theatrical + extended cut from shared on-disc segments, no duplicated video.

Tarulia's example segment layout:

    Theatrical: 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010
    Extended  : 0001 0002 0011 0004 0005 0006 0012 0008 0013 0010

Shared: 01,02,04,05,06,08,10 · Theatrical-only: 03,07,09 · Extended-only: 11,12,13

## Step 1 — remux each segment to its own MKV with a FIXED SegmentUID

The SegmentUID is how the chapter file addresses each piece, so it must be
deterministic (don't let mkvmerge randomise it).

    # theatrical-only + shared
    mkvmerge -o seg01.mkv --segment-uid 0x00000000000000000000000000000001 00001.m2ts
    mkvmerge -o seg02.mkv --segment-uid 0x00000000000000000000000000000002 00002.m2ts
    mkvmerge -o seg03.mkv --segment-uid 0x00000000000000000000000000000003 00003.m2ts
    mkvmerge -o seg04.mkv --segment-uid 0x00000000000000000000000000000004 00004.m2ts
    mkvmerge -o seg05.mkv --segment-uid 0x00000000000000000000000000000005 00005.m2ts
    mkvmerge -o seg06.mkv --segment-uid 0x00000000000000000000000000000006 00006.m2ts
    mkvmerge -o seg07.mkv --segment-uid 0x00000000000000000000000000000007 00007.m2ts
    mkvmerge -o seg08.mkv --segment-uid 0x00000000000000000000000000000008 00008.m2ts
    mkvmerge -o seg09.mkv --segment-uid 0x00000000000000000000000000000009 00009.m2ts
    mkvmerge -o seg10.mkv --segment-uid 0x00000000000000000000000000000010 00010.m2ts
    # extended-only swaps
    mkvmerge -o seg11.mkv --segment-uid 0x00000000000000000000000000000011 00011.m2ts
    mkvmerge -o seg12.mkv --segment-uid 0x00000000000000000000000000000012 00012.m2ts
    mkvmerge -o seg13.mkv --segment-uid 0x00000000000000000000000000000013 00013.m2ts

Get each segment's exact duration for the ChapterTimeEnd values:

    mkvmerge -J seg01.mkv | jq -r '.container.properties.duration'   # ns
    # or: ffprobe -v0 -show_entries format=duration -of csv=p=0 seg01.mkv

## Step 2 — chapters.xml with two ORDERED editions

- `EditionFlagOrdered = 1`  → play ONLY the listed atoms, in listed order.
- `ChapterSegmentUID`       → pull this atom's frames from that external file.
- `ChapterTimeStart/End`    → the in/out point inside the linked segment
                              (00:00:00 → full duration = "use the whole clip").

Times below are placeholders — replace End with each clip's real duration.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE Chapters SYSTEM "matroskachapters.dtd">
<Chapters>

  <!-- ================= EDITION 1: Theatrical ================= -->
  <EditionEntry>
    <EditionUID>1</EditionUID>
    <EditionFlagOrdered>1</EditionFlagOrdered>
    <EditionFlagDefault>1</EditionFlagDefault>

    <ChapterAtom>
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:10:00.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000001</ChapterSegmentUID>
      <ChapterDisplay><ChapterString>Seg 01</ChapterString></ChapterDisplay>
    </ChapterAtom>

    <ChapterAtom>
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:08:00.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000002</ChapterSegmentUID>
    </ChapterAtom>

    <ChapterAtom>                              <!-- theatrical seg 03 -->
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:05:00.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000003</ChapterSegmentUID>
    </ChapterAtom>

    <ChapterAtom>
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:12:00.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000004</ChapterSegmentUID>
    </ChapterAtom>
    <!-- ...05, 06... -->
    <ChapterAtom>                              <!-- theatrical seg 07 -->
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:06:00.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000007</ChapterSegmentUID>
    </ChapterAtom>
    <!-- ...08... -->
    <ChapterAtom>                              <!-- theatrical seg 09 -->
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:04:00.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000009</ChapterSegmentUID>
    </ChapterAtom>
    <ChapterAtom>                              <!-- seg 10 -->
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:15:00.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000010</ChapterSegmentUID>
    </ChapterAtom>
  </EditionEntry>

  <!-- ================= EDITION 2: Extended ================= -->
  <EditionEntry>
    <EditionUID>2</EditionUID>
    <EditionFlagOrdered>1</EditionFlagOrdered>

    <!-- 01, 02 shared -->
    <ChapterAtom>
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:10:00.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000001</ChapterSegmentUID>
    </ChapterAtom>
    <ChapterAtom>
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:08:00.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000002</ChapterSegmentUID>
    </ChapterAtom>

    <ChapterAtom>                              <!-- 11 replaces 03 -->
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:05:30.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000011</ChapterSegmentUID>
    </ChapterAtom>

    <!-- 04, 05, 06 shared -->
    <ChapterAtom>
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:12:00.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000004</ChapterSegmentUID>
    </ChapterAtom>
    <!-- ...05, 06... -->

    <ChapterAtom>                              <!-- 12 replaces 07 -->
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:06:30.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000012</ChapterSegmentUID>
    </ChapterAtom>

    <!-- 08 shared -->
    <ChapterAtom>                              <!-- 13 replaces 09 -->
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:04:30.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000013</ChapterSegmentUID>
    </ChapterAtom>
    <ChapterAtom>                              <!-- seg 10 shared -->
      <ChapterTimeStart>00:00:00.000000000</ChapterTimeStart>
      <ChapterTimeEnd>00:15:00.000000000</ChapterTimeEnd>
      <ChapterSegmentUID format="hex">00000000000000000000000000000010</ChapterSegmentUID>
    </ChapterAtom>
  </EditionEntry>

</Chapters>
```

## Step 3 — build the master "playlist" file

The master carries the editions and links to every segment. Give it its own UID
and make seg01 (the common opening) its body so players have a valid first segment:

    mkvmerge -o LOTR.mkv \
      --segment-uid 0x000000000000000000000000000000A0 \
      --chapters chapters.xml \
      seg01.mkv

Keep `seg01.mkv … seg13.mkv` in the SAME folder as `LOTR.mkv`. mpv resolves the
`ChapterSegmentUID` links by scanning sibling files for matching SegmentUIDs.

## Notes / gotchas
- ChapterTimeEnd must equal each clip's real duration or you'll clip/overrun the join.
- Splices are frame-accurate on seamless-branching discs, so stream-copy joins cleanly.
- Player support: mpv = good; VLC/most others ignore ordered editions and just play the master.
- Alternative (max compatibility): drop linking, `mkvmerge -o extended.mkv seg01 + seg02 + seg11 ...`
  to hard-concatenate each edition — simple, plays everywhere, but duplicates the shared segments.
- The whole point of linking: shared segments stored once. Two editions ≈ one movie's worth of bytes.

## Step 4 — auto-generate this XML from the disc (`gen-editions.py`)

Instead of hand-writing atoms, `src/gen-editions.py` reads the on-disc `.mpls` play
order and emits `chapters.xml` + `build.sh` for you. It parses the MPLS PlayItem
list directly (no libbluray/mpls_dump needed) and dedupes clips so each shared
segment is remuxed once. Requires `mkvmerge` + `ffprobe` on PATH.

    # 1. MakeMKV -> Backup mode -> decrypted BDMV/ (contains PLAYLIST/ + STREAM/)
    # 2. Identify the two playlists (MakeMKV title info, or bdinfo, shows the .mpls names)
    # 3. Generate:
    python3 src/gen-editions.py /mnt/backup/BDMV ./out \
        theatrical=00001.mpls extended=00002.mpls

    # 4. Build:
    cd out && bash build.sh          # remuxes each segment + muxes movie.mkv

    # 5. Play:
    mpv movie.mkv --edition=0        # theatrical
    mpv movie.mkv --edition=1        # extended

What it produces in `./out/`:
- `segNNNNN.mkv` — one per unique on-disc clip, fixed SegmentUID = `%032x` of the clip number
- `chapters.xml` — one ordered `<EditionEntry>` per playlist, atoms in play order
- `build.sh`     — the remux commands + the master `mkvmerge` mux
- `movie.mkv`    — master "playlist" carrying both editions, links to the seg files

Assumptions / when to intervene:
- Assumes each PlayItem uses the WHOLE clip (start 0 -> clip duration). True for real
  seamless-branching discs. If a playlist references only a sub-range of a clip, the
  script still writes a whole-clip atom but prints a `WARNING` naming that clip — fix
  its `ChapterTimeStart/End` by hand (the .mpls alone lacks the clip's first-PTS offset).
- Keep all `segNNNNN.mkv` in the same folder as `movie.mkv`; mpv resolves the
  `ChapterSegmentUID` links by scanning sibling files.
- More than two editions? Just pass more `name=playlist.mpls` args — one edition each.
