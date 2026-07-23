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
