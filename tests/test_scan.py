import json
import subprocess
import sys

from conftest import ROOT

GE = str(ROOT / "src" / "gen-editions.py")


def run_cli(args):
    return subprocess.run([sys.executable, GE] + args,
                          capture_output=True, text=True)


def test_scan_json_fast(sample_bd):
    r = run_cli([str(sample_bd), "--scan-json", "--fast"])
    assert r.returncode == 0, r.stderr
    doc = json.loads(r.stdout)              # stdout is ONE clean JSON document
    pls = {p["file"]: p for p in doc["playlists"]}
    assert set(pls) == {"00001.mpls", "00002.mpls", "00003.mpls", "00004.mpls"}
    assert pls["00003.mpls"]["angles"] == 2
    assert [e["name"] for e in pls["00003.mpls"]["editions"]] == \
        ["00003", "00003 (Angle 2)"]
    assert pls["00003.mpls"]["editions"][1]["clips"][2] == "00021"
    c = doc["clips"]["00001"]
    assert c["marks_ns"] == [2_000_000_000] and c["exact"] is False
    assert c["frames"] is None
    assert [s["lang"] for s in c["streams"] if s["kind"] == "audio"] == \
        ["eng", "jpn"]
    jpn = next(s for s in doc["slots"] if s["id"] == "audio:jpn:ac3:1")
    assert jpn["missing_from"] == ["00031"]
    eng = next(s for s in doc["slots"] if s["id"] == "audio:eng:ac3:1")
    assert eng["missing_from"] == []
    prog = [json.loads(l) for l in r.stderr.splitlines()
            if l.startswith('{"type": "progress"') or l.startswith('{"type":"progress"')]
    assert len(prog) == len(doc["clips"])


def test_scan_full_is_exact(sample_bd):
    r = run_cli([str(sample_bd), "--scan-json"])
    doc = json.loads(r.stdout)
    assert doc["clips"]["00001"]["frames"] == 96
    assert doc["clips"]["00001"]["exact"] is True


# ---------------------------------------------------------------------------
# the BUILD path must also honour --fast and report progress: on a retail disc
# a silent, unskippable -count_frames pass is 20-60 minutes of no output
# ---------------------------------------------------------------------------
def progress_lines(stderr):
    return [json.loads(l) for l in stderr.splitlines()
            if l.startswith('{"type": "progress"')]


def test_build_emits_progress(sample_bd, tmp_path):
    r = run_cli([str(sample_bd), str(tmp_path / "o"), "--title", "S",
                 "--fast", "T=00001.mpls"])
    assert r.returncode == 0, r.stderr
    prog = progress_lines(r.stderr)
    assert [p["clip"] for p in prog] == ["0000%d" % n for n in range(1, 6)]
    assert prog[-1] == {"type": "progress", "clip": "00005", "done": 5,
                        "total": 5}


def test_project_build_emits_progress(sample_bd, tmp_path):
    pf = tmp_path / "p.mkvedproj"
    pf.write_text(json.dumps({
        "version": 1, "bdmv": str(sample_bd), "title": "S", "mode": "flat",
        "editions": [{"name": "T", "clips": ["00001", "00002"]}]}))
    r = run_cli(["--project", str(pf), str(tmp_path / "o"), "--fast"])
    assert r.returncode == 0, r.stderr
    assert len(progress_lines(r.stderr)) == 2


def test_build_fast_skips_frame_counting(sample_bd, tmp_path):
    """--fast on the build path yields frames=None, so --qpfile degrades to a
    comment instead of writing a bogus seam list."""
    out = tmp_path / "o"
    r = run_cli([str(sample_bd), str(out), "--title", "S", "--qpfile",
                 "--fast", "T=00001.mpls"])
    assert r.returncode == 0, r.stderr
    assert "frame counts unavailable" in (out / "build.sh").read_text()
    assert not (out / "S.T.qpfile.txt").exists()
    assert "SKIPPED" in r.stdout          # and stdout does not claim otherwise


def test_build_without_fast_still_writes_qpfile(sample_bd, tmp_path):
    out = tmp_path / "o"
    r = run_cli([str(sample_bd), str(out), "--title", "S", "--qpfile",
                 "T=00001.mpls"])
    assert r.returncode == 0, r.stderr
    assert (out / "S.T.qpfile.txt").read_text().startswith("96 I\n")
    assert "qpfile(s) written" in r.stdout


def test_scan_has_resolution_and_channels(sample_bd):
    r = run_cli([str(sample_bd), "--scan-json", "--fast"])
    assert r.returncode == 0, r.stderr
    doc = json.loads(r.stdout)
    c = doc["clips"]["00001"]
    assert c["width"] == 1280 and c["height"] == 720
    auds = [s for s in c["streams"] if s["kind"] == "audio"]
    assert auds and all(s["channels"] == 2 for s in auds)


def test_scan_has_disc_meta(sample_bd):
    doc = json.loads(run_cli([str(sample_bd), "--scan-json", "--fast"]).stdout)
    assert doc["disc"]["title"] == "Sample Disc"
    assert doc["disc"]["poster"] and doc["disc"]["poster"].endswith(".jpg")


def test_scan_disc_meta_absent(tmp_path, ge):
    # a BDMV with a PLAYLIST but no META -> nulls, no crash
    import os
    bd = tmp_path / "BDMV"
    (bd / "PLAYLIST").mkdir(parents=True)
    (bd / "STREAM").mkdir()
    assert ge.disc_meta(str(bd)) == {"title": None, "poster": None}
