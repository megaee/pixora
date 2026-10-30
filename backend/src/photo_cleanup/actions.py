"""File operations: move to trash, lossless rotate, shrink. All are logged by the caller."""

from __future__ import annotations

import os
import shutil
import struct
import sys

from PIL import Image, ImageOps

JPEG_EXTS = {".jpg", ".jpeg"}

# EXIF orientation value after one clockwise quarter turn, for each current value.
_CW = {1: 6, 6: 3, 3: 8, 8: 1, 2: 7, 7: 4, 4: 5, 5: 2}


def trash_dir(folder: str) -> tuple[str, str]:
    """Where deleted photos go: the macOS Trash if available, else <folder>/_to_delete."""
    if sys.platform == "darwin":
        t = os.path.expanduser("~/.Trash")
        if os.path.isdir(t):
            return t, "macOS Trash"
    return os.path.join(folder, "_to_delete"), "_to_delete folder"


def move_to_trash(path: str, folder: str) -> str:
    tdir, _ = trash_dir(folder)
    os.makedirs(tdir, exist_ok=True)
    base, ext = os.path.splitext(os.path.basename(path))
    dest = os.path.join(tdir, base + ext)
    n = 1
    while os.path.exists(dest):
        dest = os.path.join(tdir, f"{base} ({n}){ext}")
        n += 1
    shutil.move(path, dest)
    return dest


def rotated_orientation(current: int, quarter_turns_cw: int) -> int:
    value = current if current in _CW else 1
    for _ in range(quarter_turns_cw % 4):
        value = _CW[value]
    return value


def patch_jpeg_orientation(path: str, quarter_turns_cw: int) -> bool:
    """Rotate a JPEG losslessly by rewriting its EXIF orientation tag in place.

    Returns False if the file has no EXIF orientation tag (caller should re-encode).
    """
    with open(path, "r+b") as f:
        data = f.read(256 * 1024)
        if data[:2] != b"\xff\xd8":
            return False
        pos = 2
        while pos + 4 < len(data):
            if data[pos] != 0xFF:
                return False
            marker = data[pos + 1]
            seglen = struct.unpack(">H", data[pos + 2 : pos + 4])[0]
            if marker == 0xE1 and data[pos + 4 : pos + 10] == b"Exif\x00\x00":
                tiff = pos + 10
                endian = "<" if data[tiff : tiff + 2] == b"II" else ">"
                ifd = tiff + struct.unpack(endian + "I", data[tiff + 4 : tiff + 8])[0]
                count = struct.unpack(endian + "H", data[ifd : ifd + 2])[0]
                for k in range(count):
                    e = ifd + 2 + k * 12
                    tag, typ = struct.unpack(endian + "HH", data[e : e + 4])
                    if tag == 0x0112 and typ == 3:
                        cur = struct.unpack(endian + "H", data[e + 8 : e + 10])[0]
                        f.seek(e + 8)
                        f.write(
                            struct.pack(endian + "H", rotated_orientation(cur, quarter_turns_cw))
                        )
                        return True
                return False
            if marker in (0xDA, 0xD9):  # start of scan / end of image
                return False
            pos += 2 + seglen
    return False


def rotate_reencode(path: str, quarter_turns_cw: int) -> None:
    with Image.open(path) as src:
        fmt = src.format
        exif = src.getexif()
        im = ImageOps.exif_transpose(src)
    im = im.rotate(-90 * quarter_turns_cw, expand=True)
    exif[0x0112] = 1
    if fmt == "JPEG":
        im.save(path, "JPEG", quality=95, subsampling=0, exif=exif.tobytes())
    else:
        im.save(path, format=fmt)


def rotate(path: str, quarter_turns_cw: int) -> str:
    """Rotate clockwise by quarter turns. Returns how it was done."""
    turns = quarter_turns_cw % 4
    if not turns:
        return "unchanged"
    is_jpeg = os.path.splitext(path)[1].lower() in JPEG_EXTS
    if is_jpeg and patch_jpeg_orientation(path, turns):
        return "lossless (EXIF tag)"
    rotate_reencode(path, turns)
    return "re-saved"


def shrink(path: str, max_side: int, quality: int) -> None:
    """Downscale so the longest side is <= max_side and re-save. Overwrites the file."""
    with Image.open(path) as src:
        fmt = src.format
        exif = src.getexif()
        icc = src.info.get("icc_profile")
        im = ImageOps.exif_transpose(src)
    im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    exif[0x0112] = 1
    tmp = path + ".cleanup_tmp"
    if fmt in ("JPEG", None):
        im.convert("RGB").save(
            tmp, "JPEG", quality=quality, optimize=True, exif=exif.tobytes(), icc_profile=icc
        )
    else:
        im.save(tmp, format=fmt)
    os.replace(tmp, path)
