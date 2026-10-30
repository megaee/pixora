"""Local storage for Pixora: settings, per-folder edits and cached AI analysis.

Everything lives under ~/.pixora (override with the PIXORA_HOME environment variable), one
sub-folder per photo folder, keyed by a hash of the folder path. Nothing is written into the
photo folder itself and nothing leaves this computer.

Cached analysis is keyed by file name + size + modification time (nanoseconds): a photo that
changes on disk gets a new key, so stale results are never reused; entries for files that no
longer exist are dropped on the next save.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import os
import struct
from typing import Any

from .ai import FEATURES_VERSION, Features


def pixora_home() -> str:
    return os.environ.get("PIXORA_HOME") or os.path.expanduser("~/.pixora")


def file_key(path: str) -> str:
    """Stable identity of one version of a file (changes when the file is modified)."""
    st = os.stat(path)
    return f"{os.path.basename(path)}|{st.st_size}|{st.st_mtime_ns}"


def _pack(values: list[float]) -> str:
    """float16, base64: ~1.5 KB per DINOv2 embedding instead of ~15 KB of JSON numbers."""
    return base64.b64encode(struct.pack(f"<{len(values)}e", *values)).decode()


def _unpack(text: str) -> list[float]:
    raw = base64.b64decode(text)
    return list(struct.unpack(f"<{len(raw) // 2}e", raw))


def _write_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)  # atomic: a crash never leaves a half-written file


def _read_json(path: str, default: Any) -> Any:
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


class Store:
    def __init__(self, home: str | None = None) -> None:
        self.home = home or pixora_home()

    # ------------------------------------------------------------------ settings
    def settings(self) -> dict:
        return _read_json(os.path.join(self.home, "settings.json"), {})

    def update_settings(self, **values: Any) -> None:
        _write_json(os.path.join(self.home, "settings.json"), self.settings() | values)

    # ------------------------------------------------------------------ per folder
    def _dir(self, folder: str) -> str:
        digest = hashlib.sha1(os.path.abspath(folder).encode()).hexdigest()[:16]
        return os.path.join(self.home, "folders", digest)

    def load_edits(self, folder: str) -> dict:
        data = _read_json(os.path.join(self._dir(folder), "edits.json"), {})
        return {
            "manual_sets": [list(s) for s in data.get("manual_sets", []) if s],
            "category_overrides": dict(data.get("category_overrides", {})),
        }

    def save_edits(self, folder: str, edits: dict) -> None:
        _write_json(os.path.join(self._dir(folder), "edits.json"), {"folder": folder, **edits})

    def load_features(self, folder: str) -> dict[str, Features]:
        data = _read_json(os.path.join(self._dir(folder), "features.json"), {})
        if data.get("version") != FEATURES_VERSION:
            return {}  # produced by other models or prompts: recompute
        out = {}
        for key, v in data.get("items", {}).items():
            try:
                out[key] = Features(_unpack(v["e"]), float(v["q"]), list(v.get("c", [])))
            except (KeyError, ValueError, TypeError, struct.error):
                continue  # damaged entry: just analyse that photo again
        return out

    def save_features(self, folder: str, features: dict[str, Features]) -> None:
        items = {
            k: {"e": _pack(f.embedding), "q": f.quality, "c": f.categories}
            for k, f in features.items()
        }
        _write_json(
            os.path.join(self._dir(folder), "features.json"),
            {"version": FEATURES_VERSION, "folder": folder, "items": items},
        )

    def clear_features(self, folder: str) -> None:
        with contextlib.suppress(FileNotFoundError):
            os.remove(os.path.join(self._dir(folder), "features.json"))
