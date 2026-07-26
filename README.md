# mkv-editions

Rebuild a Blu-ray's alternate cuts (Theatrical / Extended / Special Edition, and
multi-angle discs) into editioned MKVs from the shared on-disc segments - either
as one self-contained file per cut, or with the shared video stored just once.
Use it two ways: a Python CLI, or a desktop workbench.

![The mkv-editions desktop workbench: a scanned Blu-ray with three auto-detected editions, the clip library, and the playlist panel](docs/images/main-view.png)

## Requirements

On your `PATH`:

- **python3**, **mkvmerge** + **mkvextract** (MKVToolNix), **ffprobe** (FFmpeg), **bash** - the scan/build engine. `mkvextract` also backs the in-app chapter viewer; it ships with MKVToolNix alongside `mkvmerge`.
- **Node.js + npm** - only for the desktop app.
- **7z or unzip** - only if you open a disc as a ZIP in the app.

You also need a **decrypted BDMV**: rip the disc with MakeMKV in Backup mode to
get a `BDMV/` folder (containing `PLAYLIST/` and `STREAM/`).

## Quick start - CLI

```bash
# flat (default): one self-contained, plays-anywhere file per cut
./mkv-editions.sh --install-deps /path/to/BDMV ./out --title "Fellowship" \
    "Theatrical Cut=00001.mpls" "Extended Cut=00002.mpls"
cd out && bash build.sh
```

`--install-deps` checks/installs mkvmerge, ffprobe, and python3. Identify the
`.mpls` playlist names from MakeMKV's title info or bdinfo. Pass more
`"Name=NNNNN.mpls"` pairs for more editions.

## Quick start - desktop app

```bash
./run-app.sh          # build the app, then open the workbench window
./run-app.sh dev      # hot-reload dev mode (Ctrl-C stops it)
```

Open a ripped-disc folder (or a ZIP of one, or a mounted ISO), pick the cuts,
and Build. The first launch installs the app's dependencies automatically. The
app runs from source; there is no packaged installer yet.

## Modes

Choose with `--mode` on the CLI, or in the app's build settings:

| Mode | Output | Plays in | Disk space |
|---|---|---|---|
| `flat` (default) | one file per cut | everything (Plex / Jellyfin / Emby / mpv / VLC) | N x (shared video duplicated) |
| `linked` | a small master + shared `seg*.mkv` files | mpv only | 1 x + unique scenes |
| `xin1` | one file with the editions inside it | mpv only | 1 x + unique scenes |

Rule of thumb: **flat** for media servers, **linked** or **xin1** for a
space-efficient mpv library. Ordered chapters and segment linking work only in
mpv, because ffmpeg - which Plex, Jellyfin, Emby, and VLC all demux through -
does not implement them.

## Full documentation

The complete reference lives in
**[docs/editioned-mkv-reference.md](docs/editioned-mkv-reference.md)**: the
ordered-chapters + segment-linking technique end to end, every CLI option
(`--preserve-chapters`, `--qpfile`, multi-angle expansion, ...), the
`--scan-json` / `.mkvedproj` JSON contract for frontends, the synthetic-sample
validation (no disc needed), and the player-support background behind the mode
table above.

## Credits

Builds on [Xin1Generator][x1] (Sander), [aobikari][ao] (arch1t3cht), TheFluff's
["101 things you never knew you could do with Matroska"][tf], and the
[Matroska chapter spec][mk]. See the reference doc for what each contributed.

A big thank you to **[mihawk90](https://github.com/mihawk90)** for the testing,
feedback, and real-disc help that shaped this project.

[x1]: https://code.google.com/archive/p/xin1generator
[ao]: https://codeberg.org/arch1t3cht/aobikari
[tf]: https://mod16.org/hurfdurf/?p=8
[mk]: https://www.matroska.org/technical/chapters.html
