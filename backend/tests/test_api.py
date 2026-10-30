import datetime as dt
import sys

import pytest
from fastapi.testclient import TestClient

from photo_cleanup import library
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


def test_folder_file_and_video_counts(client, photo_dir):
    (photo_dir / "GOPR0001.MP4").write_bytes(b"video")
    (photo_dir / "clip.mov").write_bytes(b"video")
    (photo_dir / ".DS_Store").write_bytes(b"hidden")
    (photo_dir / "sub").mkdir()
    client.post("/api/library", json={"folder": str(photo_dir)})
    client.app.state.library.wait()
    s = client.get("/api/library").json()
    assert s["count"] == 5  # photos
    assert s["videos"] == 2
    assert s["files"] == 8  # 5 photos + notes.txt + 2 videos; hidden files and folders don't count


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


def test_undo_nothing_yet(client):
    assert client.get("/api/undo").json() == {"batch": None, "items": []}
    assert client.post("/api/undo").status_code == 409


def test_undo_delete_and_rotate(client, photo_dir):
    original = (photo_dir / "a3.jpg").read_bytes()
    client.post(
        "/api/apply",
        json={"actions": [{"id": "a_blurry.jpg", "delete": True}, {"id": "a3.jpg", "rotate": 1}]},
    )
    plan = client.get("/api/undo").json()
    assert plan["batch"]
    assert {i["id"]: i["ok"] for i in plan["items"]} == {"a_blurry.jpg": True, "a3.jpg": True}
    assert (photo_dir / "_to_delete" / "a_blurry.jpg").exists()  # preview changed nothing

    body = client.post("/api/undo").json()
    assert all(r["ok"] for r in body["results"]), body
    assert (photo_dir / "a_blurry.jpg").exists()
    assert not (photo_dir / "_to_delete" / "a_blurry.jpg").exists()
    assert (photo_dir / "a3.jpg").read_bytes() == original  # EXIF-tag rotate reversed exactly
    assert client.get("/api/library").json()["count"] == 5
    # already undone -> nothing left
    assert client.get("/api/undo").json()["batch"] is None


def test_undo_steps_back_one_batch_at_a_time(client, photo_dir, monkeypatch):
    times = iter(["2026-01-01 10:00:00", "2026-01-01 10:05:00", "2026-01-01 10:06:00"])

    class FakeDT(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return dt.datetime.strptime(next(times), "%Y-%m-%d %H:%M:%S")

    monkeypatch.setattr(library.dt, "datetime", FakeDT)
    client.post("/api/apply", json={"actions": [{"id": "a2.jpg", "delete": True}]})
    client.post("/api/apply", json={"actions": [{"id": "other.jpg", "delete": True}]})
    assert client.post("/api/undo").json()["batch"] == "2026-01-01 10:05:00"
    assert (photo_dir / "other.jpg").exists()
    assert not (photo_dir / "a2.jpg").exists()
    assert client.get("/api/undo").json()["batch"] == "2026-01-01 10:00:00"


def test_undo_shrink_is_reported_not_faked(client, photo_dir):
    client.post("/api/apply", json={"actions": [{"id": "a1.jpg", "shrink": True}]})
    item = client.get("/api/undo").json()["items"][0]
    assert item["ok"] is False and "can't be undone" in item["message"]
    body = client.post("/api/undo").json()
    assert body["results"][0]["ok"] is False
    assert client.get("/api/undo").json()["batch"] is None  # batch is marked as handled


def test_undo_refuses_when_name_is_taken(client, photo_dir):
    client.post("/api/apply", json={"actions": [{"id": "other.jpg", "delete": True}]})
    (photo_dir / "other.jpg").write_bytes(b"new file with the same name")
    body = client.post("/api/undo").json()
    assert body["results"][0]["ok"] is False
    assert (photo_dir / "other.jpg").read_bytes() == b"new file with the same name"
    assert (photo_dir / "_to_delete" / "other.jpg").exists()


def test_undo_ignores_tampered_log(client, photo_dir, tmp_path_factory):
    outside = tmp_path_factory.mktemp("elsewhere") / "secret.jpg"
    outside.write_bytes(b"not yours")
    log = photo_dir / "photo_cleanup_log.csv"
    log.write_text(
        "time,file,action,detail,bytes_before,bytes_after\n"
        f"2026-01-01 10:00:00,stolen.jpg,delete,{outside},9,0\n"
        f"2026-01-01 10:00:00,../escape.jpg,delete,{photo_dir / '_to_delete' / 'x.jpg'},9,0\n"
    )
    body = client.post("/api/undo").json()
    assert not any(r["ok"] for r in body["results"])
    assert outside.exists()
    assert not (photo_dir / "stolen.jpg").exists()


def test_dirs_lists_subfolders_with_photo_counts(client, photo_dir):
    (photo_dir / "trip").mkdir()
    (photo_dir / ".hidden").mkdir()
    data = client.get("/api/dirs", params={"path": str(photo_dir)}).json()
    assert data["path"] == str(photo_dir)
    assert data["photos"] == 5
    assert data["parent"] == str(photo_dir.parent)
    assert [d["name"] for d in data["dirs"]] == ["trip"]
    assert data["dirs"][0]["photos"] == 0
    assert data["places"][0]["name"] == "Home"


def test_dirs_missing_folder(client):
    assert client.get("/api/dirs", params={"path": "/no/such/dir"}).status_code == 404
