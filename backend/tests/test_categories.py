import hashlib
import sys

import pytest
from fastapi.testclient import TestClient

from photo_cleanup import ai, library
from photo_cleanup import categories as cats
from photo_cleanup.analysis import load_small
from photo_cleanup.api import create_app
from photo_cleanup.library import AI_IMAGE_SIZE, Library


def scores(**named: float) -> list[float]:
    """Category scores in model order (+ background last); unnamed categories share the rest."""
    background = named.pop("background", 0.0)
    rest = (1 - sum(named.values()) - background) / (len(cats.CATEGORY_IDS) - len(named))
    return [named.get(c, rest) for c in cats.CATEGORY_IDS] + [background]


# What the fake model "sees" in each test photo (see conftest.photo_dir)
SEEN = {
    "a1.jpg": scores(travel=0.7, nature=0.2),
    "a2.jpg": scores(travel=0.7, nature=0.2),
    "a3.jpg": scores(travel=0.7, nature=0.2),
    "a_blurry.jpg": scores(travel=0.3, nature=0.28),  # no clear winner -> unclassified
    "other.jpg": scores(food=0.9),
}


def fingerprint(im) -> str:
    return hashlib.sha1(im.convert("RGB").resize((16, 16)).tobytes()).hexdigest()


class FakeModel:
    """Recognises the test photos by pixels (never by file name) and returns fixed scores."""

    models = ["fake/embedder", "fake/clip"]

    def __init__(self, photo_dir, on_batch=None):
        self.known = {
            fingerprint(load_small(str(photo_dir / n), AI_IMAGE_SIZE)): s for n, s in SEEN.items()
        }
        self.analysed = 0
        self.on_batch = on_batch

    def load(self):
        pass

    def analyse(self, images):
        self.analysed += len(images)
        if self.on_batch:
            self.on_batch(self)
        out = []
        for im in images:
            s = self.known.get(fingerprint(im), scores(background=0.9))
            top = max(range(len(s) - 1), key=lambda i: s[i])
            emb = [1.0 if i == top else 0.0 for i in range(len(s) - 1)]
            out.append(ai.Features(emb, 0.5, s))
        return out


@pytest.fixture
def model(photo_dir):
    return FakeModel(photo_dir)


def make_lib(photo_dir, model, monkeypatch) -> Library:
    monkeypatch.setattr(sys, "platform", "linux")  # never touch a real Trash in tests
    lib = Library(workers=2, analyzer_factory=lambda: model)
    lib.open(str(photo_dir), background=False)
    lib.wait()
    return lib


@pytest.fixture
def client(photo_dir, model, monkeypatch):
    lib = make_lib(photo_dir, model, monkeypatch)
    c = TestClient(create_app(lib))
    c.post("/api/ai")
    lib.wait()
    return c


def by_id(data):
    return {c["id"]: c for c in data["categories"]}


# ---------------------------------------------------------------- classification rules
def test_classify_confident_photo_gets_primary_and_secondary_labels():
    r = cats.classify(scores(travel=0.7, nature=0.2))
    assert r["category"] == "travel"
    assert r["confidence"] == 0.7
    assert [lab["id"] for lab in r["labels"]] == ["travel", "nature"]


def test_classify_ambiguous_photos_are_unclassified():
    unsure = cats.classify(scores(travel=0.3))
    assert (unsure["category"], unsure["labels"]) == (cats.OTHER, [])  # no weak guesses
    assert cats.classify(scores(travel=0.4, nature=0.36))["category"] == cats.OTHER  # no clear lead
    bg = cats.classify(scores(screenshots=0.3, background=0.6))  # "nothing in particular" wins
    assert bg["category"] == cats.OTHER
    assert bg["labels"] == []
    assert cats.classify(None)["category"] == cats.OTHER  # not analysed / unreadable


def test_classify_override_wins():
    r = cats.classify(scores(travel=0.9), override="food")
    assert (r["category"], r["overridden"], r["labels"][0]["id"]) == ("food", True, "food")


# ---------------------------------------------------------------- categories from the model
def test_categories_need_ai(photo_dir, model, monkeypatch):
    lib = make_lib(photo_dir, model, monkeypatch)
    assert TestClient(create_app(lib)).get("/api/categories").status_code == 409


def test_categories_from_image_content(client):
    data = by_id(client.get("/api/categories").json())
    assert data["travel"]["photos"] == ["a1.jpg", "a2.jpg", "a3.jpg"]
    assert data["food"]["photos"] == ["other.jpg"]
    assert data["other"]["photos"] == ["a_blurry.jpg"]
    # multi-label: the travel photos are also listed under nature, as secondary entries
    assert set(data["nature"]["photos"]) == {"a1.jpg", "a2.jpg", "a3.jpg"}
    assert set(data["nature"]["secondary"]) == {"a1.jpg", "a2.jpg", "a3.jpg"}
    assert data["music"]["count"] == 0
    # photos in the similarity groups carry their category too
    photos = {p["id"]: p for g in client.get("/api/groups").json()["groups"] for p in g["photos"]}
    assert photos["other.jpg"]["category"] == "food"
    assert photos["a1.jpg"]["confidence"] == 0.7


def test_category_correction_persists(client, photo_dir, monkeypatch):
    r = client.put("/api/photos/a_blurry.jpg/category", json={"category": "nature"})
    assert r.status_code == 200
    assert "a_blurry.jpg" in by_id(client.get("/api/categories").json())["nature"]["photos"]
    # a fresh app (restart) remembers the correction and reuses the cached analysis
    model2 = FakeModel(photo_dir)
    lib2 = make_lib(photo_dir, model2, monkeypatch)
    lib2.enable_ai(background=False)
    assert model2.analysed == 0
    data = by_id(lib2.categories())
    assert "a_blurry.jpg" in data["nature"]["photos"]
    assert "a_blurry.jpg" not in data["other"]["photos"]
    # undo the correction
    lib2.set_category("a_blurry.jpg", None)
    assert "a_blurry.jpg" in by_id(lib2.categories())["other"]["photos"]


def test_changed_photo_is_reanalysed_after_restart(client, photo_dir, monkeypatch):
    from tests.conftest import make_scene, save_jpeg

    model2 = FakeModel(photo_dir)  # knows the photos as they were
    save_jpeg(make_scene(7), photo_dir / "a2.jpg")  # then the file changes on disk
    lib2 = make_lib(photo_dir, model2, monkeypatch)
    lib2.enable_ai(background=False)
    assert model2.analysed == 1  # only the changed photo
    # unknown content for the fake model -> background wins -> unclassified, not a guess
    assert "a2.jpg" in by_id(lib2.categories())["other"]["photos"]


def test_rerun_analyses_everything_again(client, model):
    before = model.analysed
    client.post("/api/ai/rerun")
    client.app.state.library.wait()
    assert model.analysed == before + 5
    assert client.get("/api/library").json()["ai"]["status"] == "ready"


def test_cancel_keeps_finished_work(photo_dir, monkeypatch):
    monkeypatch.setattr(library, "AI_BATCH", 1)
    holder = {}

    def cancel_after_two(m):
        if m.analysed == 2:
            holder["lib"].cancel_ai()

    model = FakeModel(photo_dir, on_batch=cancel_after_two)
    lib = make_lib(photo_dir, model, monkeypatch)
    holder["lib"] = lib
    lib.enable_ai(background=False)
    assert lib.ai_status == "cancelled"
    assert lib.ai_enabled is False
    assert len(lib.store.load_features(str(photo_dir))) == 2  # finished photos were saved
    model.on_batch = None
    lib.enable_ai(background=False)  # resume: only the remaining 3 are analysed
    assert lib.ai_status == "ready"
    assert model.analysed == 5


def test_ai_setting_is_remembered(client, photo_dir, monkeypatch):
    lib2 = make_lib(photo_dir, FakeModel(photo_dir), monkeypatch)
    assert lib2.ai_enabled is True
    assert lib2.ai_status == "ready"  # started by itself after the scan


# ---------------------------------------------------------------- set edits
def groups_of(client, **params):
    data = client.get("/api/groups", params={"threshold": 0, "time_window": 0, **params}).json()
    return [sorted(p["id"] for p in g["photos"]) for g in data["groups"]], data["groups"]


def test_merge_split_exclude_reset_and_persist(client, photo_dir, monkeypatch):
    names, _ = groups_of(client)
    assert ["a_blurry.jpg", "other.jpg"] not in names

    assert client.post(
        "/api/sets/merge", json={"a": ["a_blurry.jpg"], "b": ["other.jpg"]}
    ).is_success
    names, raw = groups_of(client)
    assert ["a_blurry.jpg", "other.jpg"] in names
    merged = next(g for g in raw if len(g["photos"]) == 2 and g["manual"])
    assert merged["cohesion"]["kind"] == "hash"

    r = client.post(
        "/api/sets/split", json={"ids": ["a_blurry.jpg", "other.jpg"], "selected": ["other.jpg"]}
    )
    assert r.is_success
    names, _ = groups_of(client)
    assert ["other.jpg"] in names and ["a_blurry.jpg"] in names

    # a merge survives a restart (edits are stored per folder)
    client.post("/api/sets/merge", json={"a": ["a1.jpg"], "b": ["other.jpg"]})
    lib2 = make_lib(photo_dir, FakeModel(photo_dir), monkeypatch)
    assert any(
        sorted(p.id for p in g) == ["a1.jpg", "other.jpg"] and manual
        for g, manual in lib2._apply_manual_sets([[p] for p in lib2.photos.values()])
    )

    assert client.post("/api/sets/exclude", json={"id": "a1.jpg"}).is_success
    names, _ = groups_of(client)
    assert ["a1.jpg"] in names

    assert client.post("/api/sets/reset").is_success
    assert client.app.state.library.edits["manual_sets"] == []


def test_ai_groups_report_similarity(client):
    data = client.get("/api/groups", params={"mode": "ai", "similarity": 0.9}).json()
    travel = next(g for g in data["groups"] if "a1.jpg" in [p["id"] for p in g["photos"]])
    assert travel["cohesion"] == {"kind": "ai", "value": 1.0}


def test_edit_errors(client):
    assert client.post("/api/sets/merge", json={"a": ["nope.jpg"], "b": []}).status_code == 400
    r = client.post("/api/sets/split", json={"ids": ["a1.jpg", "a2.jpg"], "selected": []})
    assert r.status_code == 400
    assert client.post("/api/sets/exclude", json={"id": "nope.jpg"}).status_code == 404
    r = client.put("/api/photos/a1.jpg/category", json={"category": "not-a-category"})
    assert r.status_code == 400
    assert client.put("/api/photos/nope.jpg/category", json={"category": "food"}).status_code == 404


# ---------------------------------------------------------------- robustness
def test_corrupt_and_unsupported_files_are_reported_not_fatal(photo_dir, model, monkeypatch):
    (photo_dir / "broken.jpg").write_bytes(b"this is not a jpeg")
    lib = make_lib(photo_dir, model, monkeypatch)
    state = lib.state()
    assert state["status"] == "ready"
    assert state["skipped"] == ["broken.jpg"]
    assert state["count"] == 5


def test_edits_and_cache_live_outside_the_photo_folder(client, photo_dir, pixora_home):
    client.put("/api/photos/a1.jpg/category", json={"category": "nature"})
    assert sorted(p.name for p in photo_dir.iterdir()) == sorted(
        ["a1.jpg", "a2.jpg", "a3.jpg", "a_blurry.jpg", "other.jpg", "notes.txt"]
    )
    stored = {p.name for p in pixora_home.rglob("*.json")}
    assert {"edits.json", "features.json", "settings.json"} <= stored
