import json
import subprocess
import sys

from conftest import ROOT

GE = str(ROOT / "src" / "gen-editions.py")


def run_cli(args):
    return subprocess.run([sys.executable, GE] + args,
                          capture_output=True, text=True)


def test_roundtrip_byte_identical(sample_bd, tmp_path):
    outa, outp = tmp_path / "argv", tmp_path / "proj"
    r = run_cli([str(sample_bd), str(outa), "--mode", "xin1", "--title",
                 "Sample", "--preserve-chapters", "--qpfile", "--seed", "42",
                 "Theatrical=00001.mpls", "Extended=00002.mpls"])
    assert r.returncode == 0, r.stderr

    scan = json.loads(run_cli([str(sample_bd), "--scan-json",
                               "--fast"]).stdout)
    pls = {p["file"]: p for p in scan["playlists"]}
    proj = {"version": 1, "bdmv": str(sample_bd), "title": "Sample",
            "mode": "xin1", "preserve_chapters": True, "qpfile": True,
            "editions": [
                {"name": "Theatrical",
                 "clips": pls["00001.mpls"]["editions"][0]["clips"]},
                {"name": "Extended",
                 "clips": pls["00002.mpls"]["editions"][0]["clips"]}]}
    pf = tmp_path / "rt.mkvedproj"
    pf.write_text(json.dumps(proj))
    r = run_cli(["--project", str(pf), str(outp), "--seed", "42"])
    assert r.returncode == 0, r.stderr

    for fn in ("build.sh", "chapters.xml", "tags.xml", "Sample.qpfile.txt"):
        assert (outa / fn).read_bytes() == (outp / fn).read_bytes(), fn


def test_roundtrip_flat_build_sh(sample_bd, tmp_path):
    outa, outp = tmp_path / "fa", tmp_path / "fp"
    run_cli([str(sample_bd), str(outa), "--mode", "flat", "--title", "S",
             "--seed", "1", "T=00001.mpls"])
    scan = json.loads(run_cli([str(sample_bd), "--scan-json",
                               "--fast"]).stdout)
    clips = next(p for p in scan["playlists"]
                 if p["file"] == "00001.mpls")["editions"][0]["clips"]
    pf = tmp_path / "f.mkvedproj"
    pf.write_text(json.dumps({"version": 1, "bdmv": str(sample_bd),
                              "title": "S", "mode": "flat",
                              "editions": [{"name": "T", "clips": clips}]}))
    run_cli(["--project", str(pf), str(outp), "--seed", "1"])
    assert (outa / "build.sh").read_bytes() == (outp / "build.sh").read_bytes()
