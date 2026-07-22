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

## Which mode do you want? (read this first)

The whole design hinges on one fact: **ffmpeg honors neither ordered chapters nor
segment linking.** It plays the linear default track and nothing else. Plex,
Jellyfin, and Emby all analyze/transcode through ffmpeg — so *only mpv* (which
ships its own Matroska demuxer) can assemble a branched cut. That forces a choice:

| Approach | What a media server actually plays | Space | Verdict |
|---|---|---|---|
| **Xin1** — scenes appended to one track, chapters seek back/forth | theatrical, then extended scenes dumped out-of-context at the end | 1× + scenes | runtime **skewed**, garbage tail; extended cut mpv-only |
| **Two video tracks** — theatrical=trk1, extended=trk2 | default track only (theatrical) | ~2× | no auto-branching anywhere; server can't reach trk2 |
| **Ordered chapters** (`--mode linked`) | theatrical husk, *correct* | 1× + scenes | extended cut **mpv-only**; scene files clutter the scanner |
| **Flat files** (`--mode flat`, default) | every cut, *correctly* | N× (dup) | **plays everywhere**; shared video duplicated on disk |

"Flatten" and "dedup" are the same coin, opposite sides: `mkvmerge` gives you a
universally-playable file *because* it writes the shared video out as real bytes.
There is no ffmpeg-visible way to have a playable extended cut without its full
timeline existing somewhere. So:

- **Both cuts must play on Plex/Jellyfin/Emby** → `--mode flat` (duplicates shared video).
- **Space-efficient archive, full experience in mpv** → `--mode linked`.

## Step 4 — auto-generate it from the disc (`gen-editions.py`)

`src/gen-editions.py` reads the on-disc `.mpls` play order and writes a `build.sh`.
It parses the MPLS PlayItem list directly (no libbluray/mpls_dump needed); MPLS
timestamps are 45 kHz. Use the wrapper `./mkv-editions.sh`, which also checks/installs
dependencies (`mkvmerge`, `ffprobe`, `python3`):

    # 1. MakeMKV -> Backup mode -> decrypted BDMV/ (contains PLAYLIST/ + STREAM/)
    # 2. Identify the playlists (MakeMKV title info / bdinfo shows the .mpls names)

    # 3a. FLAT (default) — server-ready, one self-contained file per edition:
    ./mkv-editions.sh --install-deps /mnt/backup/BDMV ./out --title "Fellowship" \
        "Theatrical Cut=00001.mpls" "Extended Cut=00002.mpls"

    # 3b. LINKED — mpv-only, space-efficient:
    ./mkv-editions.sh /mnt/backup/BDMV ./out --mode linked --title "Fellowship" \
        "Theatrical Cut=00001.mpls" "Extended Cut=00002.mpls"

    # 4. Build:
    cd out && bash build.sh

**flat** produces `Fellowship {edition-Theatrical Cut}.mkv` etc. — the `{edition-…}`
tag is Plex's native Editions convention (Jellyfin/Emby group alternate versions the
same way). Scene chapters are added at each append point. Plays in anything.

**linked** produces `Fellowship.mkv` (husk) + `segNNNNN.mkv` (one per unique clip,
SegmentUID = `%032x` of the clip number) + `chapters.xml` (one ordered `<EditionEntry>`
per playlist). Play with `mpv Fellowship.mkv --edition=0|1`.

Assumptions / when to intervene (linked mode):
- Assumes each PlayItem uses the WHOLE clip (start 0 -> duration). True for real
  seamless-branching discs. If a playlist references only a sub-range, the script
  still writes a whole-clip atom but prints a `WARNING` naming that clip — fix its
  `ChapterTimeStart/End` by hand (the .mpls alone lacks the clip's first-PTS offset).
- Keep all `segNNNNN.mkv` beside `Fellowship.mkv`; mpv resolves the links by scanning
  siblings. Don't point a media server at this folder — it can't assemble editions.
- More editions? Pass more `"Name=playlist.mpls"` args — one ordered edition each.

## Why this is still a hack: the chicken-and-egg problem

Editioned/branched MKVs remain a niche curiosity rather than a solved feature, and
it's not an accident — it's a self-reinforcing deadlock:

    no authoring tools  <-- no player support  <-- no media uses it  <-- no authoring tools

Each link starves the next:

- **Players don't implement it** because almost no one's library contains branched
  MKVs, so there's no demand to justify the engineering.
- **Nobody authors branched MKVs** because they won't play in the tools people
  actually use — so why produce them?
- **No automated authoring tool exists** for the same reason: a tool whose output
  chokes 95% of players has no audience.

### ffmpeg is the keystone

Ordered chapters and segment linking aren't missing from "some players" — they're
missing from **ffmpeg's Matroska demuxer (libavformat)**, and that's the whole
ballgame. Jellyfin, Plex, Emby, Kodi, VLC, HandBrake and most transcoders demux
through libavformat. So one absent feature in one library silently vetoes the entire
downstream ecosystem at once. This is why the flat-file duplication path is the only
thing that plays everywhere: it needs zero special demuxer support.

### mpv is the lone exception, and here's why

mpv (via its mplayer2/MPlayer lineage) wrote its **own** Matroska demuxer instead of
using libavformat's, and implemented ordered chapters + hard/soft linking back in the
mplayer2 era. The driver was the fansub/anime scene, which used linked segments to
share common openings/endings across episodes without duplicating them. The feature
exists in mpv only because *one* community had a concrete use case and *one* project
controlled its own demuxer. Everywhere else it dead-ended at the shared library.

### What would actually break the loop

Only two things, neither likely:

1. **ffmpeg implements ordered chapters in libavformat** — this unblocks the whole
   downstream ecosystem in one stroke, but faces near-zero demand pressure (the
   chicken-and-egg again).
2. **Enough people hand-author these** that demand becomes visible to player devs.

Until then the pragmatic answer stands: **mpv for the real branched experience,
flat duplicated files (`--mode flat`) for everything else.** This toolkit just makes
both cheap to produce — it can't vote ffmpeg a new feature.
