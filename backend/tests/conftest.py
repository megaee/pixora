import random

import pytest
from PIL import Image, ImageDraw


def make_scene(seed: int, size=(800, 600)) -> Image.Image:
    """A random 'scene' of coloured shapes. Same seed = same scene."""
    rnd = random.Random(seed)
    im = Image.new("RGB", size, (rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(0, 255)))
    d = ImageDraw.Draw(im)
    for _ in range(25):
        x0, y0 = rnd.randint(0, size[0]), rnd.randint(0, size[1])
        x1, y1 = x0 + rnd.randint(40, 300), y0 + rnd.randint(40, 300)
        color = (rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(0, 255))
        (d.ellipse if rnd.random() < 0.5 else d.rectangle)([x0, y0, x1, y1], fill=color)
    return im


def save_jpeg(im: Image.Image, path, orientation: int | None = None) -> None:
    exif = Image.Exif()
    exif[306] = "2024:09:22 09:40:29"
    if orientation:
        exif[0x0112] = orientation
    im.save(path, "JPEG", quality=92, exif=exif.tobytes())


@pytest.fixture
def photo_dir(tmp_path):
    """3 near-duplicates of scene A (one stored rotated), a blurry copy, an unrelated photo."""
    from PIL import ImageFilter

    a = make_scene(1)
    save_jpeg(a, tmp_path / "a1.jpg")
    save_jpeg(a.rotate(2, fillcolor="white"), tmp_path / "a2.jpg")
    # stored sideways with orientation=6 -> displays upright like a1
    save_jpeg(a.rotate(90, expand=True), tmp_path / "a3.jpg", orientation=6)
    save_jpeg(a.filter(ImageFilter.GaussianBlur(4)), tmp_path / "a_blurry.jpg")
    save_jpeg(make_scene(99), tmp_path / "other.jpg")
    (tmp_path / "notes.txt").write_text("not an image")
    return tmp_path
