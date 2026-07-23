def test_parse_mpls_returns_streams(ge, sample_bd):
    items, marks, streams = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00001.mpls"))
    assert len(streams) == len(items) == 5
    st = streams[0]
    assert [s["kind"] for s in st] == ["video", "audio", "audio"]
    assert st[0]["codec"] == "h264" and st[0]["pid"] == 0x1011
    assert [(s["lang"], s["pid"]) for s in st[1:]] == [
        ("eng", 0x1100), ("jpn", 0x1101)]


def test_stn_survives_angle_block(ge, sample_bd):
    items, _m, streams = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00003.mpls"))
    assert len(items[2][0]) == 2          # the 2-angle slot
    assert [s["kind"] for s in streams[2]] == ["video", "audio", "audio"]


def test_mismatch_clip_has_one_audio(ge, sample_bd):
    _i, _m, streams = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00004.mpls"))
    assert len([s for s in streams[1] if s["kind"] == "audio"]) == 1
