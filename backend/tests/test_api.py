import sys

import pytest
from fastapi.testclient import TestClient

from photo_cleanup.api import create_app
from photo_cleanup.library import Library


@pytest.fixture
def client(photo_dir, monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")  # never touch a real Trash in tests
    lib = Library(workers=2)
    lib.open(str(photo_dir), background=False)
    return TestClient(create_app(lib))


def test_health(client):
    assert client.get("/api/health").json()["ok"] is True


def test_library_state(client, photo_dir):
    s = client.get("/api/library").json()
    assert s["status"] == "ready"
    assert s["count"] == 5
    assert s["folder"] == str(photo_dir)


def test_open_missing_folder(client):
    assert client.post("/api/library", json={"folder": "/no/such/dir"}).status_code == 404


def test_groups_and_best(client):
    data = client.get("/api/groups", params={"threshold": 40}).json()
    first = data["groups"][0]
    assert len(first["photos"]) >= 3
    assert first["best"] != "a_blurry.jpg"
    assert first["ranked"][0] == first["best"]


def test_thumb(client):
    r = client.get("/api/photos/a1.jpg/thumb")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert client.get("/api/photos/nope.jpg/thumb").status_code == 404


def test_apply(client, photo_dir):
    r = client.post(
        "/api/apply",
        json={
            "actions": [
                {"id": "a_blurry.jpg", "delete": True},
                {"id": "a1.jpg", "rotate": 1, "shrink": True},
            ],
            "shrink": {"max_side": 512, "quality": 80},
        },
    )
    body = r.json()
    assert r.status_code == 200, body
    assert all(x["ok"] for x in body["results"])
    assert body["freed"] > 0
    assert not (photo_dir / "a_blurry.jpg").exists()
    assert (photo_dir / "_to_delete" / "a_blurry.jpg").exists()
    assert (photo_dir / "photo_cleanup_log.csv").exists()
    assert client.get("/api/library").json()["count"] == 4


def test_apply_validation(client):
    r = client.post("/api/apply", json={"actions": [{"id": "a1.jpg", "rotate": 7}]})
    assert r.status_code == 422
