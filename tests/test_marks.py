def synth_clipinfo(ge, items):
    return {c: ge.ClipInfo(None, 24, 1, 4 * ge.NS, "h264")
            for c, _i, _o in items}


def test_marks_are_positional(ge, sample_bd):
    _n, items, im = ge.load_editions(str(sample_bd), [("T", "00001.mpls")])[0]
    assert im == [(2 * ge.NS,)] * 5        # mark 2s into every sample clip
    pos = ge.edition_mark_positions(items, im, synth_clipinfo(ge, items))
    assert pos == [2 * ge.NS, 6 * ge.NS, 10 * ge.NS, 14 * ge.NS, 18 * ge.NS]


def test_repeated_clip_does_not_inherit_marks(ge):
    # A clip appearing twice must NOT gain the other occurrence's chapters:
    # that would invent a chapter the disc author never wrote.
    items = [("A", 0, 0), ("B", 0, 0), ("A", 0, 0)]
    im = [(2 * ge.NS,), (), ()]            # disc marks only the FIRST A
    ci = {c: ge.ClipInfo(None, 24, 1, 4 * ge.NS, "h264") for c in "AB"}
    assert ge.edition_mark_positions(items, im, ci) == [2 * ge.NS]


def test_marks_travel_when_resequenced(ge, sample_bd):
    # The authored path attaches a clip's marks to every occurrence, via
    # clip_marks_from - that is what lets marks survive re-sequencing.
    _n, items, _im = ge.load_editions(str(sample_bd), [("T", "00001.mpls")])[0]
    raw_items, marks, _s = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00001.mpls"))
    cm = ge.clip_marks_from(raw_items, marks)
    assert cm["00001"] == (2 * ge.NS,)
    resq = [items[2], items[0]]            # authored order: clip 3 then clip 1
    im = [cm.get(c, ()) for c, _i, _o in resq]
    pos = ge.edition_mark_positions(resq, im, synth_clipinfo(ge, items))
    assert pos == [2 * ge.NS, 6 * ge.NS]   # mark follows each clip


def test_editions_xml_no_marks_stays_whole_clip(ge):
    # marks_by_item returns one EMPTY tuple per item for a mark-free playlist,
    # so item_marks here is [(), ()] - truthy as a list, but any(marks) is
    # False. That must route editions_xml to positions=None (whole-clip
    # atoms), NOT positions=[] (split-shape: first atom visible, the rest
    # hidden joins with no ChapterDisplay). Pins the `any(marks)` guard.
    items = [("A", 0, 0), ("B", 0, 0)]
    item_marks = [(), ()]
    ci = {c: ge.ClipInfo(None, 24, 1, 4 * ge.NS, "h264") for c in "AB"}
    atom_fn = lambda clip, start, end, hidden, label: ge.atom_xml(start, end, hidden, label)
    xml, _tags = ge.editions_xml([("T", items, item_marks)], ci, True, atom_fn)
    assert xml.count("<ChapterAtom>") == 2
    assert xml.count("<ChapterFlagHidden>1</ChapterFlagHidden>") == 0
    assert "T 01" in xml and "T 02" in xml


def test_angle_marks_attach_to_all_angle_clips(ge, sample_bd):
    raw_items, marks, _s = ge.parse_mpls(
        str(sample_bd / "PLAYLIST" / "00003.mpls"))
    cm = ge.clip_marks_from(raw_items, marks)
    assert cm["00021"] == (2 * ge.NS,)     # angle-2 clip gets the item's mark
