import json
import os
import re
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
EVIL_LANG = "en; touch /tmp/pwned x"
EVIL_LANG_SEL = [{"slot": "audio:eng:ac3:1", "keep": True, "lang": EVIL_LANG}]


def test_clip_track_opts_unit(ge, sample_bd):
    _i, _m, streams = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00001.mpls"))
    p = ge.probe_clip(str(sample_bd / "STREAM" / "00001.m2ts"), fast=True)
    opts, unresolved = ge.clip_track_opts(streams[0], ENG_ONLY, p["tracks"])
    joined = " ".join(opts)
    assert "--audio-tracks" in joined and "--no-subtitles" in joined
    assert "--language" in joined and ":eng" in joined
    assert "--default-track-flag" in joined
    assert unresolved == []


def test_clip_track_opts_reports_unresolvable_slot(ge, sample_bd):
    """STN promises a jpn track; the actual file has only one audio track, so
    neither the PID join nor the order fallback can resolve it."""
    _i, _m, rich = ge.parse_mpls(str(sample_bd / "PLAYLIST" / "00001.mpls"))
    p = ge.probe_clip(str(sample_bd / "STREAM" / "00031.m2ts"), fast=True)
    opts, unresolved = ge.clip_track_opts(rich[0], WANT_JPN, p["tracks"])
    assert unresolved == ["audio:jpn:ac3:1"]


def mismatch_bdmv(ms, sample_bd, tmp_path):
    """BDMV whose PLAYLIST claims 00031 has 2 audio streams (it has 1). The
    STN layout guard passes; the probe/STN disagreement only shows up in
    clip_track_opts."""
    bdmv = tmp_path / "BDMV"
    (bdmv).mkdir(parents=True)
    os.symlink(str(sample_bd / "STREAM"), str(bdmv / "STREAM"))
    pl = bdmv / "PLAYLIST"
    pl.mkdir()
    ms.write_mpls(str(pl / "00001.mpls"), ["00001", "00031"],
                  {"00001": 4, "00031": 4},
                  {"00001": ("eng", "jpn"), "00031": ("eng", "jpn")})
    return bdmv


@pytest.mark.parametrize("mode", ["flat", "xin1"])
def test_unresolvable_slot_is_fatal_in_append_modes(ge, ms, sample_bd,
                                                    tmp_path, mode):
    bdmv = mismatch_bdmv(ms, sample_bd, tmp_path)
    pf = proj(bdmv, tmp_path, mode, ["00001", "00031"], WANT_JPN)
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode != 0, r.stdout
    both = r.stdout + r.stderr
    assert "00031" in both and "audio:jpn:ac3:1" in both
    assert "Traceback" not in r.stderr


def test_unresolvable_slot_only_warns_in_linked(ge, ms, sample_bd, tmp_path):
    bdmv = mismatch_bdmv(ms, sample_bd, tmp_path)
    pf = proj(bdmv, tmp_path, "linked", ["00001", "00031"], WANT_JPN)
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode == 0, r.stdout + r.stderr
    assert "00031" in r.stdout


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


def test_lang_override_is_shell_quoted(sample_bd, tmp_path):
    """A project-supplied lang override with shell metacharacters must land in
    build.sh as a single quoted token, not spliced in raw (would let it break
    out of the mkvmerge command)."""
    pf = proj(sample_bd, tmp_path, "flat", ["00001"], EVIL_LANG_SEL)
    out = tmp_path / "out"
    r = run_cli(["--project", pf, str(out)])
    assert r.returncode == 0, r.stderr
    script = (out / "build.sh").read_text()
    # the whole "tid:lang" token must be wrapped in a single-quoted shell word
    assert re.search(r"--language '[^']*" + re.escape(EVIL_LANG) + r"'", script)
    # must never appear unquoted right after --language (would splice into build.sh)
    assert not re.search(r"--language \d+:" + re.escape(EVIL_LANG), script)
