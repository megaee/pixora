"""Image analysis: perceptual hashing, quality scoring and grouping of similar photos."""

from __future__ import annotations

import datetime as dt
import os
from dataclasses import dataclass, field

from PIL import Image, ImageFilter, ImageOps, ImageStat

try:  # optional HEIC support
    import pillow_heif  # type: ignore

    pillow_heif.register_heif_opener()
    HEIC_SUPPORTED = True
except Exception:  # pragma: no cover - depends on optional package
    HEIC_SUPPORTED = False

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
if HEIC_SUPPORTED:
    IMAGE_EXTS |= {".heic", ".heif"}

HASH_SIZE = 16  # 16x16 = 256-bit difference hash


def is_image_file(name: str) -> bool:
    return not name.startswith(".") and os.path.splitext(name)[1].lower() in IMAGE_EXTS


def load_small(path: str, size: int = 512) -> Image.Image:
    """Open an image upright (EXIF orientation applied) and downscale it quickly."""
    with Image.open(path) as im:
        if im.format == "JPEG":
            im.draft("RGB", (size * 2, size * 2))  # decode JPEG at reduced resolution
        im = ImageOps.exif_transpose(im).convert("RGB")
    im.thumbnail((size, size))
    return im


def dhash(img: Image.Image, size: int = HASH_SIZE) -> int:
    """Difference hash: compares each pixel with its right neighbour."""
    small = img.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    px = small.tobytes()
    bits = 0
    for r in range(size):
        row = px[r * (size + 1) : (r + 1) * (size + 1)]
        for c in range(size):
            bits = (bits << 1) | (1 if row[c] > row[c + 1] else 0)
    return bits


def rotation_hashes(img: Image.Image) -> list[int]:
    """Hashes of the image at 0/90/180/270 degrees, so rotated copies still match."""
    gray = img.convert("L")
    return [dhash(gray.rotate(a, expand=True)) for a in (0, 90, 180, 270)]


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def quality_scores(img: Image.Image) -> tuple[float, float]:
    """Return (sharpness, overall_score). Higher is better.

    sharpness = variance of an edge-detected image (blurry photos have weak edges);
    the score penalises clipped highlights/shadows and poor overall exposure.
    """
    gray = img.convert("L")
    sharp = ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES)).var[0]
    hist = gray.histogram()
    total = sum(hist) or 1
    clipped = (sum(hist[:5]) + sum(hist[251:])) / total
    mean = ImageStat.Stat(gray).mean[0]
    exposure_pen = abs(mean - 120) / 120
    score = sharp * (1 - min(clipped * 3, 0.6)) * (1 - min(exposure_pen * 0.5, 0.4))
    return round(sharp, 1), round(score, 1)


def photo_date(path: str) -> dt.datetime:
    """Capture time from EXIF, falling back to file modification time."""
    try:
        with Image.open(path) as im:
            ex = im.getexif()
            value = ex.get_ifd(0x8769).get(36867) or ex.get(36867) or ex.get(306)
        if value:
            return dt.datetime.strptime(str(value)[:19], "%Y:%m:%d %H:%M:%S")
    except Exception:
        pass
    return dt.datetime.fromtimestamp(os.path.getmtime(path))


@dataclass
class Photo:
    id: str  # file name, unique within a folder
    path: str
    size: int
    width: int
    height: int
    date: dt.datetime
    sharpness: float
    score: float
    hashes: list[int] = field(repr=False)

    @classmethod
    def analyse(cls, path: str) -> Photo:
        small = load_small(path)
        with Image.open(path) as im:
            w, h = im.size
            orientation = im.getexif().get(0x0112, 1)
        if orientation in (5, 6, 7, 8):  # stored sideways
            w, h = h, w
        sharp, score = quality_scores(small)
        return cls(
            id=os.path.basename(path),
            path=path,
            size=os.path.getsize(path),
            width=w,
            height=h,
            date=photo_date(path),
            sharpness=sharp,
            score=score,
            hashes=rotation_hashes(small),
        )

    def distance(self, other: Photo) -> int:
        """Smallest hash distance over all rotations of the other photo (0..256)."""
        return min(hamming(self.hashes[0], h) for h in other.hashes)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.id,
            "size": self.size,
            "width": self.width,
            "height": self.height,
            "date": self.date.isoformat(timespec="seconds"),
            "sharpness": self.sharpness,
            "score": self.score,
        }


def group_photos(
    photos: list[Photo], threshold: int = 22, time_window: int = 120
) -> list[list[Photo]]:
    """Group similar photos with union-find.

    Two photos are linked when their hash distance <= threshold, or when they were
    taken within ``time_window`` seconds and their distance <= threshold * 1.3
    (burst shots are allowed to differ a bit more).
    """
    parent = list(range(len(photos)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(photos)):
        for j in range(i + 1, len(photos)):
            d = photos[i].distance(photos[j])
            close = abs((photos[i].date - photos[j].date).total_seconds()) <= time_window
            if d <= threshold or (close and d <= threshold * 1.3):
                parent[find(i)] = find(j)

    buckets: dict[int, list[Photo]] = {}
    for i, p in enumerate(photos):
        buckets.setdefault(find(i), []).append(p)
    groups = [sorted(g, key=lambda p: p.date) for g in buckets.values()]
    groups.sort(key=lambda g: (-len(g), g[0].date))
    return groups
