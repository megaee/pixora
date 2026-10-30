"""Read-only folder browsing for the folder picker: lists sub-folder names and photo counts only."""

from __future__ import annotations

import os

from .analysis import is_image_file

MAX_DIRS = 500


def count_photos(path: str) -> int | None:
    """Number of photos directly inside `path`, or None if it can't be read."""
    try:
        with os.scandir(path) as it:
            return sum(1 for e in it if is_image_file(e.name) and e.is_file())
    except OSError:
        return None


def places() -> list[dict]:
    """Shortcuts: home, common photo folders, and mounted drives / SD cards (macOS /Volumes)."""
    home = os.path.expanduser("~")
    out = [{"name": "Home", "path": home}]
    for sub in ("Pictures", "Desktop", "Downloads", "Documents"):
        p = os.path.join(home, sub)
        if os.path.isdir(p):
            out.append({"name": sub, "path": p})
    try:
        with os.scandir("/Volumes") as it:
            for e in sorted(it, key=lambda e: e.name.lower()):
                # skip the boot disk alias ("Macintosh HD" -> /)
                if e.is_dir() and not e.name.startswith(".") and os.path.realpath(e.path) != "/":
                    out.append({"name": e.name, "path": e.path})
    except OSError:
        pass
    return out


def list_dir(path: str | None) -> dict:
    """Sub-folders of `path` (default: home) with their photo counts."""
    path = os.path.abspath(os.path.expanduser(path or "~"))
    if not os.path.isdir(path):
        raise FileNotFoundError(f"Not a folder: {path}")
    try:
        with os.scandir(path) as it:
            entries = sorted(
                (e for e in it if not e.name.startswith(".") and e.is_dir()),
                key=lambda e: e.name.lower(),
            )
    except PermissionError as e:
        raise PermissionError(f"No permission to read {path}") from e
    dirs = [
        {"name": e.name, "path": e.path, "photos": count_photos(e.path)} for e in entries[:MAX_DIRS]
    ]
    parent = os.path.dirname(path)
    return {
        "path": path,
        "parent": parent if parent != path else None,
        "photos": count_photos(path),
        "dirs": dirs,
        "truncated": len(entries) > MAX_DIRS,
        "places": places(),
    }
