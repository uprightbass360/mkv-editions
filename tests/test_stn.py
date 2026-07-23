import struct


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


# ---------------------------------------------------------------------------
# parse_stn tolerance: real discs carry menu/junk playlists with malformed
# or truncated STN tables. parse_stn must degrade gracefully, never raise.
# ---------------------------------------------------------------------------
def test_parse_stn_declared_length_past_buffer_end(ge):
    # length field claims 0xFFFF bytes follow, but the buffer only has 4
    # more bytes total. Must clamp and bail out without raising.
    it = struct.pack(">H", 0xFFFF) + b"\x00" * 4
    out = ge.parse_stn(it, 0)
    assert isinstance(out, list)
    assert out == []


def test_parse_stn_count_claims_more_entries_than_present(ge):
    # n_v says 2 video entries but only one full entry is actually present.
    counts = bytes([2, 0, 0]) + b"\x00" * 9           # n_v=2, n_a=0, n_pg=0
    entry = (bytes([9, 1]) + struct.pack(">H", 0x1011) + b"\x00" * 6
              + bytes([5, 0x1B, 0x00]) + b"\x00" * 3)  # one full video entry
    body = b"\x00\x00" + counts + entry + b"\x00"      # no 2nd entry, junk tail
    it = struct.pack(">H", len(body)) + body
    out = ge.parse_stn(it, 0)
    assert isinstance(out, list)
    assert len(out) == 1
    assert out[0]["kind"] == "video"


def test_parse_stn_unknown_coding_type_is_other(ge):
    counts = bytes([1, 0, 0]) + b"\x00" * 9            # n_v=1, n_a=0, n_pg=0
    entry = (bytes([9, 1]) + struct.pack(">H", 0x1011) + b"\x00" * 6
              + bytes([5, 0xFE, 0x00]) + b"\x00" * 3)   # unmapped coding type
    body = b"\x00\x00" + counts + entry
    it = struct.pack(">H", len(body)) + body
    out = ge.parse_stn(it, 0)
    assert isinstance(out, list)
    assert len(out) == 1
    assert out[0]["kind"] == "other"
    assert out[0]["codec"] == "0xfe"


def test_parse_stn_offset_at_or_past_buffer_end(ge):
    it = b"\x00" * 10
    assert ge.parse_stn(it, 10) == []   # offset exactly at end
    assert ge.parse_stn(it, 20) == []   # offset past end


# ---------------------------------------------------------------------------
# sweep_playlists STN precedence: 00000.mpls is typically the FirstPlay/menu
# playlist and often carries a restricted stream list for a clip the feature
# playlist uses in full. The richest list must win, not the lowest-numbered.
# ---------------------------------------------------------------------------
def _two_playlist_bdmv(ms, tmp_path, poor_first):
    """BDMV/PLAYLIST with two playlists naming clip 00001: one lists 1 audio,
    the other 2. poor_first puts the restricted one in 00000.mpls."""
    pl = tmp_path / "BDMV" / "PLAYLIST"
    pl.mkdir(parents=True)
    durs = {"00001": 4}
    poor, rich = ("00000.mpls", "00001.mpls") if poor_first else \
                 ("00001.mpls", "00000.mpls")
    ms.write_mpls(str(pl / poor), ["00001"], durs, {"00001": ("eng",)})
    ms.write_mpls(str(pl / rich), ["00001"], durs, {"00001": ("eng", "jpn")})
    return str(tmp_path / "BDMV")


def test_sweep_prefers_richest_stn(ge, ms, tmp_path):
    bdmv = _two_playlist_bdmv(ms, tmp_path, poor_first=True)
    _pls, _cm, cstreams, _w = ge.sweep_playlists(bdmv)
    auds = [s for s in cstreams["00001"] if s["kind"] == "audio"]
    assert [s["lang"] for s in auds] == ["eng", "jpn"]


def test_sweep_richest_stn_wins_either_order(ge, ms, tmp_path):
    bdmv = _two_playlist_bdmv(ms, tmp_path, poor_first=False)
    _pls, _cm, cstreams, _w = ge.sweep_playlists(bdmv)
    auds = [s for s in cstreams["00001"] if s["kind"] == "audio"]
    assert [s["lang"] for s in auds] == ["eng", "jpn"]


def test_sweep_tie_keeps_first_seen(ge, ms, tmp_path):
    pl = tmp_path / "BDMV" / "PLAYLIST"
    pl.mkdir(parents=True)
    ms.write_mpls(str(pl / "00000.mpls"), ["00001"], {"00001": 4},
                  {"00001": ("eng",)})
    ms.write_mpls(str(pl / "00009.mpls"), ["00001"], {"00001": 4},
                  {"00001": ("fra",)})
    _pls, _cm, cstreams, _w = ge.sweep_playlists(str(tmp_path / "BDMV"))
    auds = [s for s in cstreams["00001"] if s["kind"] == "audio"]
    assert [s["lang"] for s in auds] == ["eng"]
