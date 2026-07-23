import importlib.util
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="session")
def ge():
    return load("gen_editions", "src/gen-editions.py")


@pytest.fixture(scope="session")
def ms():
    return load("make_sample", "samples/make-sample.py")


@pytest.fixture(scope="session")
def sample_bd(ms, tmp_path_factory):
    out = tmp_path_factory.mktemp("sample")
    ms.main(str(out))
    return out / "BDMV"
