import json
import subprocess
import sys

from conftest import ROOT

GE = str(ROOT / "src" / "gen-editions.py")


def run_cli(args):
    return subprocess.run([sys.executable, GE] + args,
                          capture_output=True, text=True)


def write_proj(tmp_path, sample_bd, **kw):
    proj = {"version": 1, "bdmv": str(sample_bd), "title": "P",
            "mode": "xin1",
            "editions": [{"name": "Mixed",
                          "clips": ["00011", "00001", "00011"]}]}
    proj.update(kw)
    f = tmp_path / "t.mkvedproj"
    f.write_text(json.dumps(proj))
    return str(f)


def test_project_builds_authored_edition(sample_bd, tmp_path):
    pf = write_proj(tmp_path, sample_bd)
    out = tmp_path / "out"
    r = run_cli(["--project", pf, str(out)])
    assert r.returncode == 0, r.stderr
    script = (out / "build.sh").read_text()
    assert script.count("00011.m2ts") == 1     # xin1: unique clips only
    chapters = (out / "chapters.xml").read_text()
    assert "Mixed" in (out / "tags.xml").read_text()
    # edition timeline: 00011(5s) + 00001(4s) + 00011(5s) = 3 atoms
    assert chapters.count("<ChapterAtom>") == 3


def test_project_marks_from_disc(sample_bd, tmp_path):
    pf = write_proj(tmp_path, sample_bd, preserve_chapters=True)
    out = tmp_path / "out2"
    r = run_cli(["--project", pf, str(out)])
    assert r.returncode == 0, r.stderr
    # marks 2s into each occurrence: atoms split at 2, 7, 11 (s) on a 14s line
    x = (out / "chapters.xml").read_text()
    assert "00:00:07.000000000" in x


def test_project_rejects_bad_version(sample_bd, tmp_path):
    pf = write_proj(tmp_path, sample_bd, version=2)
    r = run_cli(["--project", pf, str(tmp_path / "o")])
    assert r.returncode != 0 and "version" in (r.stdout + r.stderr)
