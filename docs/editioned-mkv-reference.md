# Editioned MKV via ordered chapters + segment linking

Rebuild a theatrical + extended cut from shared on-disc segments, no duplicated video.

Tarulia's example segment layout:

    Theatrical: 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010
    Extended  : 0001 0002 0011 0004 0005 0006 0012 0008 0013 0010

Shared: 01,02,04,05,06,08,10 · Theatrical-only: 03,07,09 · Extended-only: 11,12,13

## Step 1 - remux each segment to its own MKV with a FIXED SegmentUID

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

## Step 2 - chapters.xml with two ORDERED editions

- `EditionFlagOrdered = 1`  → play ONLY the listed atoms, in listed order.
- `ChapterSegmentUID`       → pull this atom's frames from that external file.
- `ChapterTimeStart/End`    → the in/out point inside the linked segment
                              (00:00:00 → full duration = "use the whole clip").

Times below are placeholders - replace End with each clip's real duration.

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

## Step 3 - build the master "playlist" file

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
  to hard-concatenate each edition - simple, plays everywhere, but duplicates the shared segments.
- The whole point of linking: shared segments stored once. Two editions ≈ one movie's worth of bytes.

## Which mode do you want? (read this first)

The whole design hinges on one fact: **ffmpeg honors neither ordered chapters nor
segment linking.** It plays the linear default track and nothing else. Plex,
Jellyfin, and Emby all analyze/transcode through ffmpeg - so *only mpv* (which
ships its own Matroska demuxer) can assemble a branched cut. That forces a choice:

| Approach | What a media server actually plays | Space | Verdict |
|---|---|---|---|
| **Xin1** (`--mode xin1`) - unique clips appended once into ONE file, ordered chapters seek back/forth | theatrical, then extended scenes dumped out-of-context at the end | 1× + scenes | runtime **skewed**, garbage tail; extended cut mpv-only; but a single tidy file |
| **Two video tracks** - theatrical=trk1, extended=trk2 | default track only (theatrical) | ~2× | no auto-branching anywhere; server can't reach trk2 |
| **Ordered chapters** (`--mode linked`) | theatrical husk, *correct* | 1× + scenes | extended cut **mpv-only**; scene files clutter the scanner |
| **Flat files** (`--mode flat`, default) | every cut, *correctly* | N× (dup) | **plays everywhere**; shared video duplicated on disk |

"Flatten" and "dedup" are the same coin, opposite sides: `mkvmerge` gives you a
universally-playable file *because* it writes the shared video out as real bytes.
There is no ffmpeg-visible way to have a playable extended cut without its full
timeline existing somewhere. So:

- **Both cuts must play on Plex/Jellyfin/Emby** → `--mode flat` (duplicates shared video).
- **Space-efficient archive, full experience in mpv** → `--mode linked`.
- **Same, but as ONE file with no `seg*.mkv` siblings** → `--mode xin1` (other
  players see the raw concatenation, so keep it away from media servers too).

## Step 4 - auto-generate it from the disc (`gen-editions.py`)

`src/gen-editions.py` reads the on-disc `.mpls` play order and writes a `build.sh`.
It parses the MPLS PlayItem list directly (no libbluray/mpls_dump needed); MPLS
timestamps are 45 kHz. Use the wrapper `./mkv-editions.sh`, which also checks/installs
dependencies (`mkvmerge`, `ffprobe`, `python3`):

    # 1. MakeMKV -> Backup mode -> decrypted BDMV/ (contains PLAYLIST/ + STREAM/)
    # 2. Identify the playlists (MakeMKV title info / bdinfo shows the .mpls names)

    # 3a. FLAT (default) - server-ready, one self-contained file per edition:
    ./mkv-editions.sh --install-deps /mnt/backup/BDMV ./out --title "Fellowship" \
        "Theatrical Cut=00001.mpls" "Extended Cut=00002.mpls"

    # 3b. LINKED - mpv-only, space-efficient:
    ./mkv-editions.sh /mnt/backup/BDMV ./out --mode linked --title "Fellowship" \
        "Theatrical Cut=00001.mpls" "Extended Cut=00002.mpls"

    # 3c. XIN1 - mpv-only alternates, space-efficient, single file:
    ./mkv-editions.sh /mnt/backup/BDMV ./out --mode xin1 --title "Fellowship" \
        "Theatrical Cut=00001.mpls" "Extended Cut=00002.mpls"

    # 3d. add real disc chapters + a re-encode seam list:
    ./mkv-editions.sh /mnt/backup/BDMV ./out --title "Fellowship" \
        --preserve-chapters --qpfile \
        "Theatrical Cut=00001.mpls" "Extended Cut=00002.mpls"

    # 4. Build:
    cd out && bash build.sh

**flat** produces `Fellowship {edition-Theatrical Cut}.mkv` etc. - the `{edition-…}`
tag is Plex's native Editions convention (Jellyfin/Emby group alternate versions the
same way). Scene chapters are added at each append point. Plays in anything.

**linked** produces `Fellowship.mkv` (husk) + `segNNNNN.mkv` (one per unique clip,
SegmentUID = `%032x` of the clip number) + `chapters.xml` (ordered `<EditionEntry>` per
playlist) + `tags.xml` (edition names). Play with `mpv Fellowship.mkv --edition=0|1`.

**xin1** produces a single `Fellowship.mkv`: every unique clip appended once, one
ordered `<EditionEntry>` per playlist whose atoms seek within the file itself (no
`ChapterSegmentUID`, no external segments, no duplicated video). Play with
`mpv Fellowship.mkv --edition=0|1` - mpv even shows the edition names here, since
no segment linking is involved. Any other player sees the raw concatenation.

### Input formats (Electron app)

The Electron workbench accepts three input shapes: a ripped-disc folder
(containing `BDMV/`), a ZIP archive of one, or a pre-mounted ISO - mount it
first, then point "Open folder..." at the mount:

    udisksctl loop-setup -f your-disc.iso

If the resulting scan comes back mostly "unreadable" clips (over half with
zero decodable tracks), the image is probably still AACS-encrypted or was
never decrypted - re-rip it with MakeMKV in Backup mode first.

### Options (after [Xin1Generator](https://code.google.com/archive/p/xin1generator))

- **`--preserve-chapters`** - reads the disc's chapter marks from the `.mpls`
  **PlayListMark** table and emits them as real chapters. In `flat` mode they become
  ordinary chapter stops on the concatenated timeline; in `linked` mode the disc
  chapters are *visible* while the segment-join atoms are *hidden* (`ChapterFlagHidden`),
  so you get proper chapter navigation without the joins cluttering the menu.
- **`--qpfile`** (flat/xin1) - writes `<title>.<Edition>.qpfile.txt` per flat
  edition (or one `<title>.qpfile.txt` for the xin1 file), forcing an IDR frame
  at each segment seam (`<frame> I`, valid for **both** x264 and x265 `--qpfile`). Use
  it if you re-encode a flat edition, so cuts stay seamless: `x265 --qpfile … in.y4m`.
- **Edition names** - `linked` mode writes `EditionDisplay/EditionString` *and* a
  `tags.xml` TITLE per edition. (mpv 0.37 ignores both and selects editions by index,
  but MPC-HC/LAV, mkvtoolnix GUI and Jellyfin read them.)
- **Frame-exact boundaries** - chapter end times are computed from exact frame count ÷
  frame rate (via ffprobe), not container duration, so splice points land on real frame
  boundaries. Falls back to container duration if a stream lacks a frame count.

### Options (after [aobikari](https://codeberg.org/arch1t3cht/aobikari))

- **Multi-angle playlists** - some discs branch via camera *angles* instead of
  separate playlists: one `.mpls` where each PlayItem carries one clip per angle.
  These auto-expand: `"Name=pl.mpls"` with N angles yields N editions - `Name`,
  `Name (Angle 2)`, ... (angle k plays each item's k-th clip, base clip where an
  item has fewer angles). Previously the extra angles were silently dropped.
- **`--mode xin1`** - aobikari's single-file architecture (see the mode table),
  built with mkvmerge appends instead of its raw PES-timestamp rewriting.
- **VC-1 append warning** - mkvmerge appends skip one frame per splice on VC-1
  (V_MS/VFW stores DTS; the decoder-delay offset compensates once per file, not
  per splice - [mkvtoolnix#6194](https://codeberg.org/mbunkus/mkvtoolnix/issues/6194),
  the bug aobikari exists to avoid). flat/xin1 runs warn when any source clip is
  VC-1 and point at `--mode linked`, which never appends.
- **out_time distrust** - aobikari: "we seemingly cannot rely on pi->out_time".
  The linked-mode partial-clip warning now also accepts the span implied by the
  NEXT PlayItem's in_time before flagging a clip, avoiding false alarms on discs
  with junk out_time values.
- **Random EditionUIDs** - editions get random nonzero 64-bit UIDs (spec-friendly
  uniqueness across files) instead of 1, 2, ... SegmentUIDs stay deterministic -
  they are the linking addresses.

### JSON contract (for frontends and scripting)

`gen-editions.py` also speaks JSON in and out, so a frontend (or a script) can
drive it without scraping stdout or hand-writing `"Name=playlist.mpls"` argv.
Existing argv behavior is unchanged; these are additive flags.

**`--scan-json [--fast] [--cache DIR]`** - parse the BDMV, ffprobe every clip,
parse the STN table, print the whole disc model to **stdout** as one JSON
document, and exit. Nothing is written to disk except the optional cache.
Per-clip progress goes to **stderr** as JSON lines, so stdout stays clean:

    {"type":"progress","clip":"00003","done":4,"total":9}

The document has `bdmv`, `clips` (per-clip path, frame count, fps, duration,
codec, marks, and STN streams), `playlists` (auto-expanding multi-angle
playlists into one edition per angle, same as argv mode), `slots` (see below),
and `warnings` (e.g. VC-1 append risk). `--fast` skips frame counting -
`frames` comes back `null` and each clip carries `"exact": false` - so a scan
that would otherwise take minutes on a real disc (ffprobe falls back to
`-count_frames` for m2ts, which means reading the whole file) returns in
seconds with container durations instead. Run `--fast` first for a usable UI,
then a full scan in the background to upgrade frame-exact features
(`--qpfile`, exact chapter boundaries) once it lands. `--cache DIR` stores
per-clip probe results keyed by **absolute path, size, and mtime** (the entry
is named `<basename>.<path-hash>.<size>.<mtime>.json`, so two discs that share
one cache dir - both have a `00001.m2ts` - cannot collide), and reuses them
across runs; a changed or replaced clip invalidates only its own entry.

`--fast` and the progress lines apply to the **build** path too, not just
`--scan-json`: building without `--fast` re-probes every clip with
`ffprobe -count_frames`, which on a retail disc is tens of minutes. Use
`--fast` when you do not need `--qpfile` or frame-exact chapter boundaries.
With `--fast --qpfile` the frame counts are unknown, so no qpfile is written -
`build.sh` carries a `# ... skipped: frame counts unavailable` comment instead
and the run says so on stdout.

A slot id is `kind:lang:codec:ordinal` (video streams don't get a slot).
`ordinal` disambiguates streams that share kind/lang/codec - e.g. a disc with
two English AC-3 tracks (main mix, commentary) needs it to keep them apart.
Each slot lists `present_in` / `missing_from` clip ids, computed by unioning
every clip's STN streams project-wide.

When several playlists describe the same clip, that clip keeps the **richest**
STN list (most stream entries; first seen wins a tie) rather than the one from
the lowest-numbered playlist. `00000.mpls` is usually the FirstPlay/menu
playlist and often advertises a cut-down stream list for a clip the feature
plays in full; letting it win would make `check_track_layout` reject a
perfectly good disc.

**`--project FILE.mkvedproj`** - read title, mode, flags, editions, and track
selection from a JSON file instead of `"Name=playlist.mpls"` argv, then
generate the out directory exactly as today. When `--project` is given, CLI
`--mode/--title/--preserve-chapters/--qpfile` are ignored (with a printed
notice) - the project file is authoritative. Version-1 schema:

```jsonc
{
  "version": 1,
  "bdmv": "/mnt/bd/BDMV",
  "title": "Sample",
  "mode": "xin1",
  "preserve_chapters": true,
  "qpfile": false,
  "editions": [
    {"name": "Theatrical", "clips": ["00001", "00002", "00003", "00004", "00005"]},
    {"name": "Extended",
     "clips": ["00001", "00002", "00011", "00012", "00013", "00004", "00005"]}
  ],
  "tracks": [
    {"slot": "audio:eng:ac3:1", "keep": true, "lang": "eng", "default": true},
    {"slot": "audio:jpn:ac3:1", "keep": true, "lang": "jpn", "default": false},
    {"slot": "subtitle:eng:pgs:1", "keep": false}
  ]
}
```

A project file is shareable and its strings are interpolated into the generated
`build.sh` and into output filenames, so it is validated at load. `title` and
every `editions[].name` must be a non-empty string with **no control characters**
(a newline would close a `build.sh` comment and start a command) and **no `/`,
`\`, or `..` path component** (which would write outside the output directory).
`editions` must be a non-empty list, and every `tracks` entry must be an object
with a string `slot`. Any violation is a clean error naming the offending field,
not a traceback.

`editions[].clips` is a project-wide clip list (any order, any repeats, mixed
across playlists) - the same "any edition structure is supported" rule above
applies, it's just spelled as clip ids instead of a playlist reference. This
file is the GUI/CLI contract: anything an authoring frontend can build, it
builds by writing this and handing it to `--project` - the CLI has no hidden
authoring power a saved project can't express, and a saved project builds
headlessly with no GUI involved.

`tracks` is optional; omitting it keeps every stream (today's behavior).
When present, it's a project-wide selection over `slots`, not per-edition or
per-clip: `--audio-tracks`/`--subtitle-tracks` are per **input file**, and in
`flat`/`xin1` every appended clip must end with an identical track layout, so
a per-edition selection would produce broken appends by construction. If a
selected (`"keep": true`) slot is missing from a clip an edition actually
uses, that's **fatal** in `flat`/`xin1` (mkvmerge appends by matching track
order and type, so a missing track there silently mis-pairs the next track in
line - a real corruption risk, not just a cosmetic gap) and a **warning** in
`linked` (which never appends, so a missing track there just means one
segment plays without that stream).

**`--seed N`** - seeds `random` before generating EditionUIDs, so two runs
with the same seed produce byte-identical `build.sh`/`chapters.xml`/`tags.xml`.
Unset by default (EditionUIDs are random, per spec). This exists for testing
and for round-tripping argv output against `--project` output.

Known accepted divergences:
- **Project marks are a union across playlists.** With `--preserve-chapters`,
  an authored edition (built from a `--project` clip list) has no PlayItem
  indices to bind a mark to one specific occurrence, so each clip's marks are
  the union of that clip's marks across every playlist on the disc - not any
  one playlist's view. On `samples/make-sample.py`'s disc this is
  indistinguishable from the playlist-derived path, since every clip carries
  exactly one mark; on a real disc where two playlists mark the same shared
  clip differently, the authored edition gets both marks, not either
  playlist's alone. This also bounds `tests/test_roundtrip.py`: because the
  sample's marks are uniform, a divergence of exactly this kind would pass
  its byte-identical round-trip check silently.
- **Missing-clip errors no longer name the edition.** `gather_clips` used to
  report which edition referenced a missing clip; it now exits with just the
  path (`missing clip: <path>`). Accepted as a minor regression.

Assumptions / when to intervene (linked mode):
- Assumes each PlayItem uses the WHOLE clip (start 0 -> duration). True for real
  seamless-branching discs. If a playlist references only a sub-range, the script
  still writes a whole-clip atom but prints a `WARNING` naming that clip - fix its
  `ChapterTimeStart/End` by hand (the .mpls alone lacks the clip's first-PTS offset).
- Keep all `segNNNNN.mkv` beside `Fellowship.mkv`; mpv resolves the links by scanning
  siblings. Don't point a media server at this folder - it can't assemble editions.
- More editions? Pass more `"Name=playlist.mpls"` args - one ordered edition each.

### Any edition structure is supported (not just 1:1 swaps)

There's no "swap skeleton" assumption. Each edition is just *its own* playlist's clip
list, in *its own* order, so all of these work - including combinations:

- **Swapped segments** - theatrical `0003` replaced by extended `0011` at the same slot.
- **Purely additional segments** - extended has 13 where theatrical had 10; segments
  that never appear in the theatrical cut are picked up fine.
- **Reordered segments** - same clips in a different order, e.g. `0001 0002 0003`
  vs `0001 0003 0002`.
- **Repeated segments** - a clip referenced more than once, at any position.

In `flat` mode each edition is appended in its own play order; in `linked` mode the
script takes the **union** of unique clip ids (remuxed once), then each edition emits
ordered-chapter atoms in its own order. The only thing that matters is *which clip ids
a playlist references, in what order* - exactly what the `.mpls` provides. (The
whole-clip caveat above still applies to partial references; reordering/adding whole
clips is always safe.)

## Validate with a generated sample (no disc needed)

Commercial seamless-branching discs are copyrighted, so `samples/make-sample.py`
builds a **synthetic** decrypted BDMV instead - short numbered/coloured clips, each
with a distinct tone, and four playlists that exercise swap + addition + reorder +
angles + a track mismatch at once:

    Theatrical (00001.mpls): 1 2 3 4 5
    Extended   (00002.mpls): 1 2 11 4 12 5 13     # 3->11 swapped, 12 & 13 added
    Angled     (00003.mpls): 1 2 [3|21] 4 5       # ONE playlist, TWO angles at slot 3
    Mismatch   (00004.mpls): 1 31                 # 31 has eng audio only, no jpn

The sample also embeds a `PlayListMark` chapter 2 s into every segment, so
`--preserve-chapters` has real marks to read.

Audio is AC-3, not AAC: ffmpeg's `.m2ts` muxer writes AAC with PMT
`stream_type 0x06` ("private data"), which mkvmerge silently ignores, so every
build lost its audio without so much as a warning. AC-3 is BD-legal and gets
the correct stream type, so it survives the remux. Clip `00031` (referenced
only by a fourth playlist, `00004.mpls`, "Mismatch") deliberately carries only
an English track, with no Japanese counterpart - it exists to exercise the
track-selection mismatch guard (see the JSON contract section above) against
a real missing-slot case.

    python3 samples/make-sample.py ./sample        # needs ffmpeg
    ./mkv-editions.sh ./sample/BDMV ./out --title Sample \
        "Theatrical=00001.mpls" "Extended=00002.mpls"
    cd out && bash build.sh

Verified end-to-end with **ffmpeg 6.1 + mkvmerge v82 + mpv 0.37**:
- **flat** → Theatrical 20.0 s, Extended 30.1 s (genuinely different-length cuts). Plays anywhere.
- **linked** → husk + 8 segment files, 2 ordered editions, 12 `ChapterSegmentUID` links,
  each resolving to the matching segment's real `SegmentUID`; mpv assembles both cuts and a
  screenshot at t=10 s shows `SEG 00003` (theatrical) vs `SEG 00011` (extended).
- **xin1** → ONE 34.1 s file (8 unique clips stored once), 2 ordered editions; mpv reports
  20 s / 30 s per edition, shows their names, and the same t=10 s screenshots as linked.
- **angles** → `"Cut=00003.mpls"` auto-expands to 2 editions; at t=10 s angle 1 shows
  `SEG 00003`, angle 2 shows `SEG 00021` - in flat (two files) and xin1 (one 24.1 s file).
- **`--preserve-chapters`** → flat cuts get 6/8 chapters at the mark positions; linked and
  xin1 cuts interleave 14 visible disc chapters with 10 hidden segment joins (first chapter
  visible at 0).
- **`--qpfile`** → flat Extended seam list `96 192 312 408 528 624`, xin1 union seam list
  `96 192 288 384 480 600 720` = exact frame joins at 24 fps. Fed through **x264 0.164 and
  x265 3.5** (`--qpfile`), both accept the format and place IDR frames exactly at the seams,
  so re-encoded cuts stay seamless.

Note on the element name: the current Matroska spec renamed the *binary* element to
`ChapterSegmentUUID`, but MKVToolNix's chapter **XML** still uses `ChapterSegmentUID`
(confirmed round-tripping through mkvmerge v82) - which is exactly what the generator emits.

## Why this is still a hack: the chicken-and-egg problem

Editioned/branched MKVs remain a niche curiosity rather than a solved feature, and
it's not an accident - it's a self-reinforcing deadlock:

    no authoring tools  <-- no player support  <-- no media uses it  <-- no authoring tools

Each link starves the next:

- **Players don't implement it** because almost no one's library contains branched
  MKVs, so there's no demand to justify the engineering.
- **Nobody authors branched MKVs** because they won't play in the tools people
  actually use - so why produce them?
- **No automated authoring tool exists** for the same reason: a tool whose output
  chokes 95% of players has no audience.

### ffmpeg is the keystone

Ordered chapters and segment linking aren't missing from "some players" - they're
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

1. **ffmpeg implements ordered chapters in libavformat** - this unblocks the whole
   downstream ecosystem in one stroke, but faces near-zero demand pressure (the
   chicken-and-egg again).
2. **Enough people hand-author these** that demand becomes visible to player devs.

Until then the pragmatic answer stands: **mpv for the real branched experience,
flat duplicated files (`--mode flat`) for everything else.** This toolkit just makes
both cheap to produce - it can't vote ffmpeg a new feature.

## Credits

- **[Xin1Generator](https://code.google.com/archive/p/xin1generator)** (Sander, ~2011) -
  the original seamless-branching-to-Matroska tool. This project reads `.mpls` directly
  (it wrapped eac3to/xport) and targets flat + linked output rather than its append
  approach, but the chapter-preservation, qpfile, edition-naming and frame-exact-boundary
  ideas come from it.
- **[aobikari](https://codeberg.org/arch1t3cht/aobikari)** (arch1t3cht, 2026) - open-source
  seamless-branching remuxer built on libbluray, aimed at *angle*-branched discs; it produces
  a single combined m2ts (PES timestamps rewritten packet-by-packet) plus in-file ordered
  editions. The multi-angle support, xin1 mode, VC-1 append warning and out_time distrust
  follow its lead.
- **["101 things you never knew you could do with Matroska"](https://mod16.org/hurfdurf/?p=8)**
  (TheFluff, 2007) - the definitive explainer of editions, ordered chapters and segment
  linking. Concepts still current; its 2007 tooling/player advice is not.
- **[Matroska chapter spec](https://www.matroska.org/technical/chapters.html)** - the
  authoritative reference (note: binary element is now `ChapterSegmentUUID`; mkvmerge XML
  still uses `ChapterSegmentUID`).
