# Adopt aobikari features into mkv-editions

Source: https://codeberg.org/arch1t3cht/aobikari (arch1t3cht, C++/libbluray, LGPL-2.1).
aobikari remuxes seamless-branching BDs where branching is done via **angles** in a
single playlist, producing one combined m2ts (PES timestamps rewritten) plus a
chapters.xml with one in-file ordered edition per angle - the "Xin1" architecture.

We adopt four things; we do NOT take libbluray, PES rewriting, or `--padding`.

## 1. Multi-angle MPLS parsing + auto-expand

- `parse_mpls` reads the `is_multi_angle` bit (byte 10, bit 4 of each PlayItem) and,
  when set, the angle table (count at byte 32, entries of 10 bytes from byte 34,
  clip id = first 5 bytes of each entry). Each item yields a clip list, one per
  angle (angle 1 = base clip).
- Editions auto-expand: `"Name=pl.mpls"` with an N-angle playlist becomes N
  editions - `Name`, `Name (Angle 2)`, ... Angle k uses each item's k-th clip,
  falling back to the base clip where an item has fewer angles (aobikari rule).
  PlayListMark chapters are shared across angles. A notice is printed on expand.
- Downstream code sees ordinary single-clip editions; no changes needed there.

## 2. out_time distrust (robustness fix)

aobikari: "we seemingly cannot rely on pi->out_time"; it uses the next PlayItem's
in_time instead. We only use MPLS spans for the linked-mode partial-clip warning,
so: the warning now fires only if NEITHER the out_time-based span NOR the
next-in_time-based span matches the measured clip duration (0.5 s tolerance).

## 3. VC-1 splice warning

mkvmerge append skips a frame per splice on VC-1 (V_MS/VFW stores DTS; decoder
delay compensates once per file, not per splice - mkvtoolnix#6194; this bug is
aobikari's reason to exist). We already ffprobe every clip: also collect
`codec_name`; if any clip is `vc1` and the mode appends (flat or xin1), warn and
suggest `--mode linked` (no appends).

## 4. New `--mode xin1`

Single output `<title>.mkv`: the union of unique clips (first-appearance order,
same union as linked) appended by ONE mkvmerge call; chapters.xml holds one
ordered `EditionEntry` per edition whose atoms are plain time ranges on the
appended file's own timeline (no ChapterSegmentUID). Atom times = clip's physical
cumulative offset + within-clip bounds, frame-exact. `--preserve-chapters`
(visible marks / hidden joins), edition names + tags.xml, and `--qpfile`
(physical-join seam list) all work as in the other modes. Trade-off (already in
README's table): servers see one skewed-runtime file; alternate cuts are mpv-only;
space = 1x + scenes, no sibling-file clutter.

## Supporting changes

- **Random EditionUIDs** (aobikari's UIDGenerator idea): random nonzero 64-bit,
  shared between chapters.xml and tags.xml. ChapterUIDs stay omitted (mkvmerge
  generates them). SegmentUIDs stay deterministic - they are load-bearing links.
- **Refactor for the third mode** (dedup, no behavior change): extract the
  clip-union, edition-atom/hidden-join piece splitting, chapters/tags XML
  scaffolding, and qpfile writer into shared helpers used by linked + xin1 (+ flat
  for qpfile); clipinfo becomes a namedtuple (frames, num, den, dur, codec).
- **Sample generator**: `write_mpls` writes the REAL full PlayItem layout (32-byte
  base incl. uo_mask/flags, angle block when a slot has >1 clip). New
  `00003.mpls` "Angled": slots `1 2 [3|11] 4 5` with angles 1/2, exercising
  auto-expand end-to-end. Existing playlists unchanged.
- **Docs**: README documents angles, xin1 mode (its table gains the shipped-mode
  marker), the VC-1 caveat, and credits aobikari; wrapper usage line adds xin1.

## Validation

Regenerate sample; build flat, linked, and xin1 from playlists 1+2, and each mode
from angled playlist 3 (expects auto-expand to 2 editions matching the
theatrical/extended-swap content at slot 3); verify with mkvmerge -J (editions,
chapter counts, durations) and mpv screenshots at a timestamp inside the swapped
slot; re-run --preserve-chapters and --qpfile checks as in README.
