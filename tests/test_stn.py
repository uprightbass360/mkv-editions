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
