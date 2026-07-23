import pytest


def test_new_flags_parse(ge):
    a = ge.parse_args(["/bd", "--scan-json", "--fast", "--cache", "/c",
                       "--seed", "42"])
    assert a.scan and a.fast and a.cache == "/c" and a.seed == 42
    assert a.bdmv == "/bd" and a.out_dir is None


def test_project_parses(ge):
    a = ge.parse_args(["--project", "p.mkvedproj", "outdir", "--seed", "7"])
    assert a.project == "p.mkvedproj" and a.out_dir == "outdir"


def test_old_form_unchanged(ge):
    a = ge.parse_args(["bd", "out", "--mode", "xin1", "--title", "T",
                       "--preserve-chapters", "N=1.mpls"])
    assert (a.bdmv, a.out_dir, a.mode, a.title) == ("bd", "out", "xin1", "T")
    assert a.preserve and a.eds == [("N", "1.mpls")] and a.seed is None


def test_old_form_still_requires_editions(ge):
    with pytest.raises(SystemExit):
        ge.parse_args(["bd", "out"])
