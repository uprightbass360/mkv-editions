def synth_clipinfo(ge, items):
    return {c: ge.ClipInfo(None, 24, 1, 4 * ge.NS, "h264")
            for c, _i, _o in items}


def test_marks_rekeyed_per_clip(ge, sample_bd):
    eds = ge.load_editions(str(sample_bd), [("T", "00001.mpls")])
    _n, items, cm = eds[0]
    assert cm["00001"] == (2 * ge.NS,)     # mark 2s into every sample clip
    pos = ge.edition_mark_positions(items, cm, synth_clipinfo(ge, items))
    assert pos == [2 * ge.NS, 6 * ge.NS, 10 * ge.NS, 14 * ge.NS, 18 * ge.NS]


def test_marks_travel_when_resequenced(ge, sample_bd):
    _n, items, cm = ge.load_editions(str(sample_bd), [("T", "00001.mpls")])[0]
    resq = [items[2], items[0]]            # authored order: clip 3 then clip 1
    pos = ge.edition_mark_positions(resq, cm, synth_clipinfo(ge, items))
    assert pos == [2 * ge.NS, 6 * ge.NS]   # mark follows each clip


def test_angle_marks_attach_to_all_angle_clips(ge, sample_bd):
    eds = ge.load_editions(str(sample_bd), [("A", "00003.mpls")])
    assert len(eds) == 2
    _n, _items, cm = eds[1]                # Angle 2 edition
    assert cm["00021"] == (2 * ge.NS,)
