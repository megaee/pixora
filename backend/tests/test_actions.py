import sys

from PIL import Image, ImageOps

from photo_cleanup import actions
from tests.conftest import make_scene, save_jpeg


def test_rotated_orientation_cycle():
    assert actions.rotated_orientation(1, 1) == 6
    assert actions.rotated_orientation(1, 2) == 3
    assert actions.rotated_orientation(1, 3) == 8
    assert actions.rotated_orientation(6, 4) == 6
    assert actions.rotated_orientation(0, 1) == 6  # invalid value treated as 1


def test_lossless_rotate_keeps_bytes_except_tag(tmp_path):
    p = tmp_path / "x.jpg"
    save_jpeg(make_scene(3), p, orientation=1)
    before = p.read_bytes()
    assert actions.rotate(str(p), 1) == "lossless (EXIF tag)"
    after = p.read_bytes()
    assert len(before) == len(after)
    assert sum(a != b for a, b in zip(before, after, strict=True)) <= 2
    with Image.open(p) as im:
        assert im.getexif()[0x0112] == 6
        assert ImageOps.exif_transpose(im).size == (600, 800)


def test_rotate_without_exif_reencodes(tmp_path):
    p = tmp_path / "x.png"
    make_scene(3).save(p)
    assert actions.rotate(str(p), 1) == "re-saved"
    with Image.open(p) as im:
        assert im.size == (600, 800)


def test_shrink(tmp_path):
    p = tmp_path / "big.jpg"
    save_jpeg(make_scene(4, size=(4000, 3000)), p, orientation=6)
    before = p.stat().st_size
    actions.shrink(str(p), 1000, 80)
    with Image.open(p) as im:
        assert max(im.size) == 1000
        assert im.size == (750, 1000)  # orientation baked in
        assert im.getexif().get(0x0112) == 1
    assert p.stat().st_size < before


def test_move_to_trash_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    p = tmp_path / "x.jpg"
    save_jpeg(make_scene(5), p)
    dest = actions.move_to_trash(str(p), str(tmp_path))
    assert not p.exists()
    assert dest.endswith("_to_delete/x.jpg")
    # name clash gets a suffix
    save_jpeg(make_scene(5), p)
    dest2 = actions.move_to_trash(str(p), str(tmp_path))
    assert dest2.endswith("x (1).jpg")
