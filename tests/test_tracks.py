import json
import subprocess
import sys

import pytest

from conftest import ROOT

GE = str(ROOT / "src" / "gen-editions.py")


def run_cli(args):
    return subprocess.run([sys.executable, GE] + args,
                          capture_output=True, text=True)


def proj(sample_bd, tmp_path, mode, clips, tracks):
    f = tmp_path / "t.mkvedproj"
    f.write_text(json.dumps({
        "version": 1, "bdmv": str(sample_bd), "title": "T", "mode": mode,
        "editions": [{"name": "E", "clips": clips}], "tracks": tracks}))
    return str(f)


ENG_ONLY = [{"slot": "audio:eng:ac3:1", "keep": True, "default": True},
            {"slot": "audio:jpn:ac3:1", "keep": False}]
WANT_JPN = [{"slot": "audio:jpn:ac3:1", "keep": True}]


def test_clip_track_opts_unit(ge, sample_bd):
    _i, _m, streams = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00001.mpls"))
    p = ge.probe_clip(str(sample_bd / "STREAM" / "00001.m2ts"), fast=True)
    opts = ge.clip_track_opts(streams[0], ENG_ONLY, p["tracks"])
    joined = " ".join(opts)
    assert "--audio-tracks" in joined and "--no-subtitles" in joined
    assert "--language" in joined and ":eng" in joined
    assert "--default-track-flag" in joined


def test_selection_lands_in_output(sample_bd, tmp_path):
    pf = proj(sample_bd, tmp_path, "flat", ["00001", "00002"], ENG_ONLY)
    out = tmp_path / "out"
    r = run_cli(["--project", pf, str(out)])
    assert r.returncode == 0, r.stderr
    subprocess.run(["bash", "build.sh"], cwd=out, check=True,
                   capture_output=True)
    mkv = next(out.glob("*.mkv"))
    j = json.loads(subprocess.check_output(["mkvmerge", "-J", str(mkv)]))
    auds = [t for t in j["tracks"] if t["type"] == "audio"]
    assert len(auds) == 1
    assert auds[0]["properties"]["language"] == "eng"
    assert auds[0]["properties"]["default_track"] is True


def test_mismatch_blocks_append_mode(sample_bd, tmp_path):
    pf = proj(sample_bd, tmp_path, "flat", ["00001", "00031"], WANT_JPN)
    r = run_cli(["--project", pf, str(tmp_path / "o1")])
    assert r.returncode != 0
    assert "00031" in (r.stdout + r.stderr)


def test_mismatch_only_warns_in_linked(sample_bd, tmp_path):
    pf = proj(sample_bd, tmp_path, "linked", ["00001", "00031"], WANT_JPN)
    r = run_cli(["--project", pf, str(tmp_path / "o2")])
    assert r.returncode == 0, r.stderr
    assert "00031" in r.stdout
