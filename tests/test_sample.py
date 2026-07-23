import json
import subprocess


def mkvmerge_json(path):
    return json.loads(subprocess.check_output(["mkvmerge", "-J", str(path)]))


def test_mkvmerge_sees_audio_in_every_clip(sample_bd):
    # AAC in ffmpeg's m2ts mode gets PMT stream_type 0x06 and mkvmerge drops
    # it silently; AC-3 must yield visible audio tracks.
    for f in sorted((sample_bd / "STREAM").glob("*.m2ts")):
        kinds = [t["type"] for t in mkvmerge_json(f)["tracks"]]
        want_audio = 1 if f.stem == "00031" else 2
        assert kinds.count("video") == 1, f.name
        assert kinds.count("audio") == want_audio, f.name


def test_audio_is_ac3(sample_bd):
    out = subprocess.check_output(
        ["ffprobe", "-v", "0", "-select_streams", "a", "-show_entries",
         "stream=codec_name", "-of", "csv=p=0",
         str(sample_bd / "STREAM" / "00001.m2ts")]).decode()
    assert set(out.split()) == {"ac3"}


def test_mismatch_playlist_exists(sample_bd):
    assert (sample_bd / "PLAYLIST" / "00004.mpls").exists()
    assert (sample_bd / "STREAM" / "00031.m2ts").exists()
