"""Project-file input validation: .mkvedproj strings are attacker-influenceable
and land in a generated SHELL SCRIPT and in output filenames."""
import json
import os
import shlex
import subprocess
import sys

import pytest

from conftest import ROOT

GE = str(ROOT / "src" / "gen-editions.py")


def run_cli(args):
    return subprocess.run([sys.executable, GE] + args,
                          capture_output=True, text=True)


def write_proj(tmp_path, sample_bd, name="t", **kw):
    proj = {"version": 1, "bdmv": str(sample_bd), "title": "P",
            "mode": "flat",
            "editions": [{"name": "E", "clips": ["00001"]}]}
    proj.update(kw)
    f = tmp_path / f"{name}.mkvedproj"
    f.write_text(json.dumps(proj))
    return str(f)


def ed(name):
    return [{"name": name, "clips": ["00001"]}]


# ---------------------------------------------------------------------------
# control characters: a newline in a name breaks out of a build.sh comment line.
# The marker is relative (no "/") so the name doubles as a usable filename.
# ---------------------------------------------------------------------------
INJECT = "Cut\ntouch PWNED\n#"


@pytest.mark.parametrize("bad", [INJECT, "a\rb", "a\tb", "a\x00b", "a\x1bb"])
def test_control_char_in_title_rejected(sample_bd, tmp_path, bad):
    pf = write_proj(tmp_path, sample_bd, title=bad)
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode != 0
    assert "title" in (r.stdout + r.stderr)


@pytest.mark.parametrize("bad", [INJECT, "a\rb", "a\tb", "a\x00b", "a\x1bb"])
def test_control_char_in_edition_name_rejected(sample_bd, tmp_path, bad):
    pf = write_proj(tmp_path, sample_bd, editions=ed(bad))
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode != 0
    out = r.stdout + r.stderr
    # "editions[0].name" (not just "name") rules out the unrelated "every
    # edition needs a name and clips" branch, which also contains "name".
    assert "editions[0].name" in out
    assert "control character" in out


def test_injected_project_never_reaches_build_sh(sample_bd, tmp_path):
    """End to end: the hostile project must be rejected, and no build.sh with a
    bare executable injected line may be produced."""
    out = tmp_path / "o"
    pf = write_proj(tmp_path, sample_bd, editions=ed(INJECT))
    r = run_cli(["--project", pf, str(out)])
    assert r.returncode != 0
    script = (out / "build.sh").read_text() if (out / "build.sh").exists() else ""
    assert "\ntouch PWNED" not in script


# ---------------------------------------------------------------------------
# belt and braces: a non-project caller reaching build_* directly must not be
# able to emit a bare command line through a comment interpolation
# ---------------------------------------------------------------------------
PAYLOAD = INJECT


def run_script(script, tmp_path):
    """Actually execute the generated build.sh with mkvmerge stubbed out and
    return its cwd. Definitive: a newline inside a shlex.quote'd filename is
    inert, one that escaped into a comment is a command."""
    d, sbin = tmp_path / "run", tmp_path / "bin"
    d.mkdir(); sbin.mkdir()
    stub = sbin / "mkvmerge"
    stub.write_text("#!/bin/sh\nexit 0\n")
    stub.chmod(0o755)
    (d / "build.sh").write_text(script)
    r = subprocess.run(["bash", "build.sh"], cwd=d, capture_output=True,
                       env=dict(os.environ, PATH=f"{sbin}:{os.environ['PATH']}"))
    # positive control: the script must actually run to completion, or a
    # "no PWNED" assertion downstream could pass for the wrong reason (the
    # script died before ever reaching the payload line).
    assert r.returncode == 0, r.stderr
    return d


def test_build_flat_comment_cannot_start_a_new_line(ge, tmp_path):
    ci = {"00001": ge.ClipInfo(96, 24, 1, 4_000_000_000, "h264")}
    script, _outs = ge.build_flat("/s", str(tmp_path), "T",
                                  [(PAYLOAD, [("00001", 0, 0)], [()])], ci,
                                  False, True)
    assert not (run_script(script, tmp_path) / "PWNED").exists(), script


def test_build_xin1_comment_cannot_start_a_new_line(ge, tmp_path):
    ci = {"00001": ge.ClipInfo(96, 24, 1, 4_000_000_000, "h264")}
    script, _fn = ge.build_xin1("/s", str(tmp_path), PAYLOAD,
                                [(PAYLOAD, [("00001", 0, 0)], [()])], ci,
                                False, True)
    assert not (run_script(script, tmp_path) / "PWNED").exists(), script


def test_build_linked_comment_cannot_start_a_new_line(ge, tmp_path):
    ci = {"00001": ge.ClipInfo(96, 24, 1, 4_000_000_000, "h264")}
    script, _w = ge.build_linked("/s", str(tmp_path), PAYLOAD,
                                 [(PAYLOAD, [("00001", 0, 0)], [()])], ci,
                                 False)
    assert not (run_script(script, tmp_path) / "PWNED").exists(), script


def test_build_linked_segment_filename_quoted(ge, tmp_path):
    """seg{c}.mkv (line ~826) must be quoted the same way the master output
    line already is. load_project never validates editions[].clips, so a
    clip id that is int()-parseable (uid_for needs that) but not a bare
    shell token - e.g. a leading space - must not land in build.sh unquoted."""
    clip = " 2"
    ci = {"1": ge.ClipInfo(96, 24, 1, 4_000_000_000, "h264"),
          clip: ge.ClipInfo(96, 24, 1, 4_000_000_000, "h264")}
    script, _w = ge.build_linked("/s", str(tmp_path), "T",
                                 [("E", [("1", 0, 0), (clip, 0, 0)],
                                   [(), ()])], ci, False)
    assert shlex.quote(f"seg{clip}.mkv") in script
    assert f"-o seg{clip}.mkv " not in script


# ---------------------------------------------------------------------------
# path traversal: title/name become chapters.xml and qpfile filenames
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("bad", ["..", "../../etc/x", "a/b", "a\\b"])
def test_traversal_in_title_rejected(sample_bd, tmp_path, bad):
    pf = write_proj(tmp_path, sample_bd, title=bad)
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode != 0
    assert "title" in (r.stdout + r.stderr)


@pytest.mark.parametrize("bad", ["..", "../../etc/x", "a/b", "a\\b"])
def test_traversal_in_edition_name_rejected(sample_bd, tmp_path, bad):
    pf = write_proj(tmp_path, sample_bd, editions=ed(bad))
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode != 0
    out = r.stdout + r.stderr
    # "editions[0].name" (not just "name") rules out the unrelated "every
    # edition needs a name and clips" branch, which also contains "name".
    assert "editions[0].name" in out
    assert "path separator" in out or "path component" in out


def test_traversal_writes_nothing_outside_out_dir(sample_bd, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    pf = write_proj(tmp_path, sample_bd, title="../P",
                    preserve_chapters=True)
    r = run_cli(["--project", pf, str(out)])
    assert r.returncode != 0
    # "../P.E.chapters.xml" relative to out_dir would land here
    assert not list(tmp_path.glob("*.chapters.xml"))


def test_argv_title_traversal_writes_nothing_outside_out_dir(sample_bd, tmp_path):
    """A GUI shelling out with a user-supplied title has no project file to
    validate - the argv --title path must reject '..' the same way."""
    out = tmp_path / "out"
    out.mkdir()
    r = run_cli([str(sample_bd), str(out), "--title", "../ESCAPED",
                "--preserve-chapters", "--fast", "T=00001.mpls"])
    assert r.returncode != 0
    # "../ESCAPED.T.chapters.xml" relative to out_dir would land here
    assert not list(tmp_path.glob("*.chapters.xml"))


# ---------------------------------------------------------------------------
# structural validation
# ---------------------------------------------------------------------------
def test_track_entry_without_slot_rejected(sample_bd, tmp_path):
    pf = write_proj(tmp_path, sample_bd, tracks=[{"keep": True}])
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode != 0
    assert "slot" in (r.stdout + r.stderr)
    assert "KeyError" not in (r.stdout + r.stderr)
    assert "Traceback" not in r.stderr


def test_track_entry_non_dict_rejected(sample_bd, tmp_path):
    pf = write_proj(tmp_path, sample_bd, tracks=["audio:eng:ac3:1"])
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode != 0
    assert "slot" in (r.stdout + r.stderr)
    assert "Traceback" not in r.stderr


def test_track_slot_not_a_string_rejected(sample_bd, tmp_path):
    pf = write_proj(tmp_path, sample_bd, tracks=[{"slot": 7, "keep": True}])
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode != 0
    assert "slot" in (r.stdout + r.stderr)


def test_empty_editions_rejected(sample_bd, tmp_path):
    pf = write_proj(tmp_path, sample_bd, editions=[])
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode != 0
    assert "editions" in (r.stdout + r.stderr)
    assert "Traceback" not in r.stderr


def test_ordinary_names_still_accepted(sample_bd, tmp_path):
    """Validation must not reject the punctuation real edition names carry."""
    pf = write_proj(tmp_path, sample_bd, title="Blade Runner 2049 (2017)",
                    editions=ed("Director's Cut - 4K [HDR]"))
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode == 0, r.stdout + r.stderr


# ---------------------------------------------------------------------------
# missing BDMV/PLAYLIST
# ---------------------------------------------------------------------------
def test_missing_playlist_dir_clean_error(tmp_path):
    root = tmp_path / "disc"          # disc root, not .../BDMV - a real slip
    (root / "BDMV" / "PLAYLIST").mkdir(parents=True)
    r = run_cli([str(root), "--scan-json"])
    assert r.returncode != 0
    assert "PLAYLIST" in (r.stdout + r.stderr)
    assert "Traceback" not in r.stderr
    assert "FileNotFoundError" not in r.stderr


def test_missing_playlist_dir_unit(ge, tmp_path):
    with pytest.raises(SystemExit) as e:
        ge.sweep_playlists(str(tmp_path / "nope" / "BDMV"))
    assert "PLAYLIST" in str(e.value)
