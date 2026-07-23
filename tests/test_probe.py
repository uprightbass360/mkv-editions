import json
import os


def test_probe_shape_and_pids(ge, sample_bd):
    p = ge.probe_clip(str(sample_bd / "STREAM" / "00001.m2ts"))
    assert p["codec"] == "h264" and p["frames"] == 96
    assert p["fps"] == [24, 1] and p["dur_ns"] == 4 * ge.NS
    auds = [t for t in p["tracks"] if t["type"] == "audio"]
    assert len(auds) == 2
    # mkvmerge reports the TS PID as properties.number - the STN join key
    assert sorted(t["pid"] for t in auds) == [0x1100, 0x1101]


def test_fast_skips_frame_count(ge, sample_bd):
    p = ge.probe_clip(str(sample_bd / "STREAM" / "00001.m2ts"), fast=True)
    assert p["frames"] is None and p["dur_ns"] > 0


def test_cache_hit_and_upgrade(ge, sample_bd, tmp_path, monkeypatch):
    clip = str(sample_bd / "STREAM" / "00002.m2ts")
    cd = str(tmp_path)
    fast = ge.probe_clip(clip, fast=True, cache_dir=cd)
    assert fast["frames"] is None
    full = ge.probe_clip(clip, cache_dir=cd)          # upgrades the entry
    assert full["frames"] == 96
    def boom(*a, **k):
        raise AssertionError("subprocess ran despite warm cache")
    monkeypatch.setattr(ge.subprocess, "check_output", boom)
    again = ge.probe_clip(clip, cache_dir=cd)         # served from cache
    assert again == full
    fast2 = ge.probe_clip(clip, fast=True, cache_dir=cd)  # full satisfies fast
    assert fast2["frames"] == 96


def test_cache_invalidated_by_mtime(ge, sample_bd, tmp_path):
    import os, shutil
    clip = tmp_path / "c.m2ts"
    shutil.copy(sample_bd / "STREAM" / "00003.m2ts", clip)
    cd = str(tmp_path / "cache")
    ge.probe_clip(str(clip), fast=True, cache_dir=cd)
    files = list((tmp_path / "cache").iterdir())
    assert len(files) == 1
    os.utime(clip, (1, 1))
    ge.probe_clip(str(clip), fast=True, cache_dir=cd)
    assert len(list((tmp_path / "cache").iterdir())) == 2  # new key, old orphaned


def test_cache_key_differs_across_discs(ge, sample_bd, tmp_path):
    """Two discs sharing one cache dir both have a 00001.m2ts. The key must not
    collide, or disc B is served disc A's probe."""
    import shutil
    a, b = tmp_path / "discA", tmp_path / "discB"
    a.mkdir(); b.mkdir()
    src = sample_bd / "STREAM" / "00001.m2ts"
    for d in (a, b):
        shutil.copy(src, d / "00001.m2ts")
    os.utime(b / "00001.m2ts", (1, 1))   # identical size; differing content is
    os.utime(a / "00001.m2ts", (1, 1))   # not required - same size+mtime is the collision
    assert ge.cache_key(str(a / "00001.m2ts")) != ge.cache_key(str(b / "00001.m2ts"))
    cd = str(tmp_path / "cache")
    ge.probe_clip(str(a / "00001.m2ts"), fast=True, cache_dir=cd)
    ge.probe_clip(str(b / "00001.m2ts"), fast=True, cache_dir=cd)
    assert len(os.listdir(cd)) == 2       # one entry each, no collision
    assert all("00001.m2ts" in f for f in os.listdir(cd))  # still readable


def test_corrupt_cache_entry_is_treated_as_miss(ge, sample_bd, tmp_path):
    clip = str(sample_bd / "STREAM" / "00001.m2ts")
    cd = str(tmp_path)
    os.makedirs(cd, exist_ok=True)
    cf = os.path.join(cd, ge.cache_key(clip))
    with open(cf, "w") as f:
        f.write('{"codec": "h264", "frames": tru')  # truncated mid-write
    got = ge.probe_clip(clip, cache_dir=cd)  # must re-probe, not raise
    assert got["frames"] == 96
    with open(cf) as f:
        json.load(f)  # cache entry was overwritten with valid JSON


def test_cache_write_leaves_no_temp_files(ge, sample_bd, tmp_path):
    clip = str(sample_bd / "STREAM" / "00001.m2ts")
    cd = str(tmp_path)
    ge.probe_clip(clip, cache_dir=cd)
    assert os.listdir(cd) == [ge.cache_key(clip)]
