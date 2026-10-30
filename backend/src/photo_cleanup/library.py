"""A photo library = one folder being reviewed. Handles scanning, caching and applying changes."""

from __future__ import annotations

import csv
import datetime as dt
import io
import os
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from . import actions
from .analysis import Photo, group_photos, is_image_file, load_small

LOG_NAME = "photo_cleanup_log.csv"


@dataclass
class Action:
    id: str
    delete: bool = False
    rotate: int = 0  # clockwise quarter turns
    shrink: bool = False


class Library:
    def __init__(self, workers: int | None = None) -> None:
        self.folder: str | None = None
        self.status = "idle"  # idle | scanning | ready | error
        self.progress = 0
        self.total = 0
        self.error: str | None = None
        self.photos: dict[str, Photo] = {}
        self._cache: dict[tuple[str, float, int], Photo] = {}
        self._images: OrderedDict[tuple[str, int, float], bytes] = OrderedDict()
        self._lock = threading.RLock()
        self._workers = workers or min(8, (os.cpu_count() or 2))
        self._scan_thread: threading.Thread | None = None

    # ------------------------------------------------------------------ scanning
    def open(self, folder: str, background: bool = True) -> None:
        folder = os.path.abspath(os.path.expanduser(folder))
        if not os.path.isdir(folder):
            raise FileNotFoundError(f"Not a folder: {folder}")
        with self._lock:
            if self.folder != folder:
                self._images.clear()
            self.folder = folder
            self.status = "scanning"
            self.error = None
        if background:
            self._scan_thread = threading.Thread(target=self._scan, daemon=True)
            self._scan_thread.start()
        else:
            self._scan()

    def wait(self, timeout: float | None = None) -> None:
        if self._scan_thread:
            self._scan_thread.join(timeout)

    def _analyse(self, path: str) -> Photo | None:
        try:
            st = os.stat(path)
            key = (path, st.st_mtime, st.st_size)
            if key not in self._cache:
                self._cache[key] = Photo.analyse(path)
            return self._cache[key]
        except Exception:
            return None
        finally:
            with self._lock:
                self.progress += 1

    def _scan(self) -> None:
        folder = self.folder
        assert folder
        try:
            names = sorted(n for n in os.listdir(folder) if is_image_file(n))
            paths = [
                os.path.join(folder, n) for n in names if os.path.isfile(os.path.join(folder, n))
            ]
            with self._lock:
                self.progress, self.total = 0, len(paths)
            with ThreadPoolExecutor(self._workers) as pool:
                results = list(pool.map(self._analyse, paths))
            with self._lock:
                if folder != self.folder:  # another folder was opened meanwhile
                    return
                self.photos = {p.id: p for p in results if p is not None}
                self.status = "ready"
        except Exception as e:  # pragma: no cover - defensive
            with self._lock:
                self.status, self.error = "error", str(e)

    # ------------------------------------------------------------------ queries
    def state(self) -> dict:
        trash_label = actions.trash_dir(self.folder)[1] if self.folder else None
        return {
            "folder": self.folder,
            "status": self.status,
            "progress": self.progress,
            "total": self.total,
            "error": self.error,
            "count": len(self.photos),
            "total_size": sum(p.size for p in self.photos.values()),
            "trash": trash_label,
        }

    def groups(self, threshold: int = 22, time_window: int = 120) -> list[dict]:
        photos = sorted(self.photos.values(), key=lambda p: p.date)
        out = []
        for g in group_photos(photos, threshold, time_window):
            ranked = sorted(g, key=lambda p: -p.score)
            out.append(
                {
                    "photos": [p.to_dict() for p in g],
                    "best": ranked[0].id,
                    "ranked": [p.id for p in ranked],
                }
            )
        return out

    def image(self, photo_id: str, size: int) -> bytes:
        p = self.photos.get(photo_id)
        if p is None or not os.path.exists(p.path):
            raise KeyError(photo_id)
        key = (p.path, size, os.path.getmtime(p.path))
        with self._lock:
            if key in self._images:
                self._images.move_to_end(key)
                return self._images[key]
        buf = io.BytesIO()
        load_small(p.path, size).save(buf, "JPEG", quality=85)
        data = buf.getvalue()
        if size <= 600:
            with self._lock:
                self._images[key] = data
                while len(self._images) > 2000:
                    self._images.popitem(last=False)
        return data

    # ------------------------------------------------------------------ changes
    def apply(self, items: list[Action], max_side: int = 3000, quality: int = 85) -> dict:
        if self.status != "ready" or not self.folder:
            raise RuntimeError("Library is not ready")
        log_path = os.path.join(self.folder, LOG_NAME)
        new_log = not os.path.exists(log_path)
        results: list[dict] = []
        freed = 0
        now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self._lock, open(log_path, "a", newline="") as lf:
            log = csv.writer(lf)
            if new_log:
                log.writerow(["time", "file", "action", "detail", "bytes_before", "bytes_after"])
            for a in items:
                p = self.photos.get(a.id)
                if p is None or not os.path.exists(p.path):
                    results.append({"id": a.id, "ok": False, "message": "missing, skipped"})
                    continue
                before = os.path.getsize(p.path)
                try:
                    if a.delete:
                        dest = actions.move_to_trash(p.path, self.folder)
                        freed += before
                        log.writerow([now, p.id, "delete", dest, before, 0])
                        results.append({"id": p.id, "ok": True, "message": "moved to trash"})
                        continue
                    msgs = []
                    if a.rotate % 4:
                        how = actions.rotate(p.path, a.rotate)
                        log.writerow(
                            [
                                now,
                                p.id,
                                "rotate",
                                f"{(a.rotate % 4) * 90} deg cw, {how}",
                                before,
                                os.path.getsize(p.path),
                            ]
                        )
                        msgs.append(f"rotated {(a.rotate % 4) * 90}° ({how})")
                    if a.shrink:
                        b2 = os.path.getsize(p.path)
                        actions.shrink(p.path, max_side, quality)
                        after = os.path.getsize(p.path)
                        freed += b2 - after
                        log.writerow(
                            [now, p.id, "shrink", f"max {max_side}px, q{quality}", b2, after]
                        )
                        msgs.append(f"shrunk {b2 / 1e6:.1f} MB → {after / 1e6:.1f} MB")
                    results.append(
                        {"id": p.id, "ok": True, "message": "; ".join(msgs) or "no change"}
                    )
                except Exception as e:
                    results.append({"id": p.id, "ok": False, "message": f"error: {e}"})
        self.open(self.folder, background=False)  # rescan (cached analysis makes this fast)
        return {"results": results, "freed": freed, "log": log_path}
