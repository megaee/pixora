import datetime as dt
import math
import os
import sys

import pytest
from fastapi.testclient import TestClient
from PIL import ImageFilter, ImageStat

from photo_cleanup import ai
from photo_cleanup.analysis import Photo
from photo_cleanup.api import create_app
from photo_cleanup.library import Library


class FakeAnalyzer:
    """Stands in for DINOv2 + CLIP: embedding = 8x8 grayscale thumbnail, quality = edges."""

    models = ["fake/embedder", "fake/quality"]

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.analysed = 0

    def load(self) -> None:
        if self.fail:
            raise OSError("model download failed")

    def analyse(self, images):
        out = []
        for im in images:
            px = list(im.convert("L").resize((8, 8)).tobytes())
            mean = sum(px) / len(px)
            v = [x - mean for x in px]
            norm = math.sqrt(sum(x * x for x in v)) or 1.0
            edges = ImageStat.Stat(im.convert("L").filter(ImageFilter.FIND_EDGES)).var[0]
            out.append(ai.Features([x / norm for x in v], edges / (edges + 500)))
        self.analysed += len(images)
        return out


@pytest.fixture
def fake():
    return FakeAnalyzer()


@pytest.fixture
def lib(photo_dir, monkeypatch, fake):
    monkeypatch.setattr(sys, "platform", "linux")  # never touch a real Trash in tests
    library = Library(workers=2, analyzer_factory=lambda: fake)
    library.open(str(photo_dir), background=False)
    return library


@pytest.fixture
def client(lib):
    return TestClient(create_app(lib))


def _photo(name: str) -> Photo:
    return Photo(name, f"/x/{name}", 1, 1, 1, dt.datetime(2024, 1, 1), 0, 0, [0])


def test_complete_linkage_does_not_chain():
    # A~B and B~C are 0.99 similar, but A~C only 0.96: they must not end up in one group
    vec = {
        n: [math.cos(math.radians(a)), math.sin(math.radians(a))]
        for n, a in (("a", 0), ("b", 8), ("c", 16))
    }
    photos = [_photo(n) for n in "abc"]
    groups = ai.group_by_embedding(photos, vec, 0.97)
    names = sorted(sorted(p.id for p in g) for g in groups)
    assert ["a", "c"] not in names and ["a", "b", "c"] not in names
    assert len(ai.group_by_embedding(photos, vec, 0.95)) == 1


def test_group_by_embedding_small_inputs():
    assert ai.group_by_embedding([], {}, 0.9) == []
    assert [[p.id for p in g] for g in ai.group_by_embedding([_photo("a")], {}, 0.9)] == [["a"]]


def test_ai_groups_need_ai_enabled(client):
    assert client.get("/api/groups", params={"mode": "ai"}).status_code == 409
    assert client.get("/api/library").json()["ai"]["status"] == "off"


def test_ai_mode_groups_and_ranks(client, lib):
    state = client.post("/api/ai").json()
    assert state["ai"]["enabled"] is True
    lib.wait()
    ai_state = client.get("/api/library").json()["ai"]
    assert ai_state["status"] == "ready", ai_state
    assert ai_state["progress"] == ai_state["total"] == 5
    assert ai_state["models"] == FakeAnalyzer.models

    data = client.get("/api/groups", params={"mode": "ai", "similarity": 0.8}).json()
    assert data["mode"] == "ai"
    by_name = {p["id"]: g for g in data["groups"] for p in g["photos"]}
    assert by_name["a1.jpg"] is by_name["a3.jpg"]  # same picture, one stored rotated
    assert by_name["other.jpg"] is not by_name["a1.jpg"]
    assert all(p["ai_quality"] is not None for g in data["groups"] for p in g["photos"])
    group = by_name["a1.jpg"]
    if "a_blurry.jpg" in group["ranked"]:
        assert group["ranked"][-1] == "a_blurry.jpg"  # blurry ranks last by quality

    # classic mode still works and now also reports the AI quality
    classic = client.get("/api/groups").json()["groups"]
    assert classic[0]["photos"][0]["ai_quality"] is not None


def test_ai_results_are_cached_across_rescans(client, lib, fake):
    client.post("/api/ai")
    lib.wait()
    assert fake.analysed == 5
    client.post("/api/apply", json={"actions": [{"id": "other.jpg", "delete": True}]})
    lib.wait()
    assert client.get("/api/library").json()["ai"]["status"] == "ready"
    assert fake.analysed == 5  # nothing re-analysed
    ids = {p["id"] for g in client.get("/api/groups?mode=ai").json()["groups"] for p in g["photos"]}
    assert ids == {"a1.jpg", "a2.jpg", "a3.jpg", "a_blurry.jpg"}


def test_changed_photo_is_reanalysed(client, lib, fake, photo_dir):
    client.post("/api/ai")
    lib.wait()
    client.post("/api/apply", json={"actions": [{"id": "a1.jpg", "rotate": 2}]})
    lib.wait()
    assert fake.analysed == 6
    assert os.path.exists(photo_dir / "a1.jpg")


def test_model_failure_is_reported(photo_dir):
    library = Library(workers=2, analyzer_factory=lambda: FakeAnalyzer(fail=True))
    library.open(str(photo_dir), background=False)
    library.enable_ai(background=False)
    state = library.state()["ai"]
    assert state["status"] == "error"
    assert "model download failed" in state["error"]


def test_ai_not_installed(photo_dir, monkeypatch):
    monkeypatch.setattr(ai, "available", lambda: False)
    library = Library(workers=2)
    library.open(str(photo_dir), background=False)
    c = TestClient(create_app(library))
    assert c.get("/api/library").json()["ai"]["available"] is False
    r = c.post("/api/ai")
    assert r.status_code == 409
    assert "make setup-ai" in r.json()["detail"]


@pytest.mark.skipif(
    not os.environ.get("PHOTO_CLEANUP_AI_TESTS"),
    reason="set PHOTO_CLEANUP_AI_TESTS=1 (real models)",
)
def test_real_models(photo_dir):
    pytest.importorskip("torch")
    library = Library(workers=2)
    library.open(str(photo_dir), background=False)
    library.enable_ai(background=False)
    assert library.ai_status == "ready", library.ai_error
    groups = library.groups(mode="ai", similarity=0.9)
    by_name = {p["id"]: g for g in groups for p in g["photos"]}
    assert by_name["a1.jpg"] is by_name["a3.jpg"]
    assert by_name["other.jpg"] is not by_name["a1.jpg"]
