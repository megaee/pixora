"""A photo library = one folder being reviewed. Handles scanning, caching and applying changes."""

from __future__ import annotations

import csv
import datetime as dt
import io
import os
import shutil
import threading
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from . import actions, ai
from . import categories as cats
from .analysis import Photo, group_photos, is_image_file, is_video_file, load_small
from .store import Store, file_key

LOG_NAME = "photo_cleanup_log.csv"
LOG_HEADER = ["time", "file", "action", "detail", "bytes_before", "bytes_after"]
APPLY_ACTIONS = ("delete", "rotate", "shrink")
TIME_FORMAT = "%Y-%m-%d %H:%M:%S"
AI_BATCH = 16
AI_IMAGE_SIZE = 448


@dataclass
class Action:
    id: str
    delete: bool = False
    rotate: int = 0  # clockwise quarter turns
    shrink: bool = False


class Library:
    def __init__(
        self,
        workers: int | None = None,
        analyzer_factory: Callable[[], ai.Analyzer] | None = None,
        home: str | None = None,
    ) -> None:
        self.folder: str | None = None
        self.status = "idle"  # idle | scanning | ready | error
        self.progress = 0
        self.total = 0
        self.file_count = 0  # every visible file in the folder (photos, videos, anything else)
        self.video_count = 0
        self.error: str | None = None
        self.photos: dict[str, Photo] = {}
        self.skipped: list[str] = []  # image files that could not be read (corrupt/unsupported)
        self.store = Store(home)  # ~/.pixora: settings, per-folder edits, cached AI analysis
        self.edits: dict = {"manual_sets": [], "category_overrides": {}}
        self._cache: dict[tuple[str, float, int], Photo] = {}
        self._images: OrderedDict[tuple[str, int, float], bytes] = OrderedDict()
        self._lock = threading.RLock()
        self._workers = workers or min(8, (os.cpu_count() or 2))
        self._scan_thread: threading.Thread | None = None
        # optional AI mode: a second analysis phase, started by enable_ai()
        self.ai_available = analyzer_factory is not None or ai.available()
        self._analyzer_factory = analyzer_factory or ai.LocalModels
        self._analyzer: ai.Analyzer | None = None
        # remembered across restarts: once turned on, analysis runs for every folder opened
        self.ai_enabled = self.ai_available and bool(self.store.settings().get("ai_enabled"))
        self.ai_status = "off"  # off | loading | running | ready | cancelled | error
        self.ai_progress = 0
        self.ai_total = 0
        self.ai_error: str | None = None
        self.ai_unreadable: list[str] = []
        self.ai_features: dict[str, ai.Features] = {}
        # results for the open folder by file_key(); persisted in the store
        self._ai_cache: dict[str, ai.Features] = {}
        self._ai_lock = threading.Lock()  # one model run at a time
        self._ai_gen = 0  # bumps on every run; results of an outdated run are dropped
        self._ai_thread: threading.Thread | None = None

    # ------------------------------------------------------------------ scanning
    def open(self, folder: str, background: bool = True) -> None:
        folder = os.path.abspath(os.path.expanduser(folder))
        if not os.path.isdir(folder):
            raise FileNotFoundError(f"Not a folder: {folder}")
        with self._lock:
            if self.folder != folder:
                self._images.clear()
                self._ai_cache = self.store.load_features(folder)
                self.ai_features = {}
                self.ai_status = "off" if self.ai_status == "ready" else self.ai_status
                self.edits = self.store.load_edits(folder)
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
        if self._ai_thread:
            self._ai_thread.join(timeout)

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
            with os.scandir(folder) as it:
                files = sorted(e.name for e in it if not e.name.startswith(".") and e.is_file())
            paths = [os.path.join(folder, n) for n in files if is_image_file(n)]
            with self._lock:
                self.progress, self.total = 0, len(paths)
                self.file_count = len(files)
                self.video_count = sum(1 for n in files if is_video_file(n))
            with ThreadPoolExecutor(self._workers) as pool:
                results = list(pool.map(self._analyse, paths))
            with self._lock:
                if folder != self.folder:  # another folder was opened meanwhile
                    return
                self.photos = {p.id: p for p in results if p is not None}
                self.skipped = [
                    os.path.basename(p) for p, r in zip(paths, results, strict=True) if r is None
                ]
                self.status = "ready"
                if self.ai_enabled:  # keep AI results in step with the folder (cached = fast)
                    self._start_ai(background=True)
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
            "files": self.file_count,
            "videos": self.video_count,
            "trash": trash_label,
            "skipped": self.skipped[:20],
            "skipped_count": len(self.skipped),
            "ai": {
                "available": self.ai_available,
                "enabled": self.ai_enabled,
                "status": self.ai_status,
                "progress": self.ai_progress,
                "total": self.ai_total,
                "error": self.ai_error,
                "unreadable": self.ai_unreadable[:20],
                "models": list(getattr(self._analyzer or self._analyzer_factory, "models", [])),
                "default_similarity": ai.DEFAULT_SIMILARITY,
            },
        }

    def groups(
        self,
        threshold: int = 22,
        time_window: int = 120,
        mode: str = "classic",
        similarity: float = ai.DEFAULT_SIMILARITY,
    ) -> list[dict]:
        """Classic mode: perceptual hash + sharpness. AI mode: DINOv2 similarity + AI quality."""
        photos = sorted(self.photos.values(), key=lambda p: p.date)
        feats = self.ai_features if self.ai_status == "ready" else {}
        if mode == "ai":
            if self.ai_status != "ready":
                raise RuntimeError(f"AI analysis is {self.ai_status}")
            known = [p for p in photos if p.id in feats]
            grouped = ai.group_by_embedding(
                known, {p.id: feats[p.id].embedding for p in known}, similarity
            )
            grouped += [[p] for p in photos if p.id not in feats]  # unreadable for the model

            def rank(p: Photo) -> float:
                return -feats[p.id].quality if p.id in feats else 1.0
        else:
            grouped = group_photos(photos, threshold, time_window)

            def rank(p: Photo) -> float:
                return -p.score

        out = []
        for g, manual in self._apply_manual_sets(grouped):
            ranked = sorted(g, key=rank)
            out.append(
                {
                    "photos": [self._photo_dict(p, feats) for p in g],
                    "best": ranked[0].id,
                    "ranked": [p.id for p in ranked],
                    "manual": manual,
                    "cohesion": self._cohesion(g, mode, feats),
                }
            )
        return out

    def _apply_manual_sets(self, grouped: list[list[Photo]]) -> list[tuple[list[Photo], bool]]:
        """User edits (merge / split / exclude) are stored as fixed sets of photo ids. They take
        their photos out of the automatic groups, whatever the current strictness."""
        by_id = {p.id: p for g in grouped for p in g}
        manual = [[by_id[i] for i in s if i in by_id] for s in self.edits["manual_sets"]]
        manual = [sorted(m, key=lambda p: p.date) for m in manual if m]
        taken = {p.id for m in manual for p in m}
        auto = [[p for p in g if p.id not in taken] for g in grouped]
        result = [(m, True) for m in manual] + [(g, False) for g in auto if g]
        result.sort(key=lambda t: (-len(t[0]), t[0][0].date))
        return result

    @staticmethod
    def _cohesion(g: list[Photo], mode: str, feats: dict[str, ai.Features]) -> dict | None:
        """How alike the least similar pair in a set is (0..1): AI = cosine similarity of the
        embeddings, classic = 1 - perceptual-hash distance / 256."""
        if len(g) < 2:
            return None
        if mode == "ai" and all(p.id in feats for p in g):
            import numpy as np

            e = np.array([feats[p.id].embedding for p in g], dtype=np.float32)
            return {"kind": "ai", "value": round(float((e @ e.T).min()), 3)}
        worst = max(a.distance(b) for i, a in enumerate(g) for b in g[i + 1 :])
        return {"kind": "hash", "value": round(1 - worst / 256, 3)}

    def _classify(self, p: Photo) -> dict:
        override = self.edits["category_overrides"].get(p.id)
        if self.ai_status != "ready":
            return {
                "category": override,
                "confidence": None,
                "labels": [],
                "overridden": bool(override),
            }
        f = self.ai_features.get(p.id)
        return cats.classify(f.categories if f else None, override)

    def _photo_dict(self, p: Photo, feats: dict[str, ai.Features]) -> dict:
        f = feats.get(p.id)
        return {**p.to_dict(), "ai_quality": f.quality if f else None, **self._classify(p)}

    # ------------------------------------------------------------------ categories
    def categories(self) -> dict:
        """Photos per content category. A photo is listed under its primary category and under
        any secondary label; `secondary` says which entries are such extra labels."""
        if self.ai_status != "ready":
            raise RuntimeError(f"AI analysis is {self.ai_status}")
        ids = [*cats.CATEGORY_IDS, cats.OTHER]
        members: dict[str, list[tuple[int, float, str]]] = {c: [] for c in ids}
        for p in sorted(self.photos.values(), key=lambda p: p.date):
            info = self._classify(p)
            members[info["category"]].append((1, info["confidence"] or 0.0, p.id))
            for label in info["labels"]:
                if label["id"] != info["category"]:
                    members[label["id"]].append((0, label["score"], p.id))
        out = []
        for cid in ids:
            items = sorted(members[cid], key=lambda t: (-t[0], -t[1]))
            out.append(
                {
                    "id": cid,
                    "label": cats.LABELS[cid],
                    "count": len(items),
                    "photos": [t[2] for t in items],
                    "secondary": [t[2] for t in items if not t[0]],
                }
            )
        return {"categories": out}

    def set_category(self, photo_id: str, category: str | None) -> None:
        """Correct a photo's category (None = back to the model's choice). Persisted."""
        if photo_id not in self.photos:
            raise KeyError(photo_id)
        if category is not None and category not in cats.LABELS:
            raise ValueError(f"Unknown category: {category}")
        overrides = self.edits["category_overrides"]
        if category is None:
            overrides.pop(photo_id, None)
        else:
            overrides[photo_id] = category
        self._save_edits()

    # ------------------------------------------------------------------ set edits
    def _save_edits(self) -> None:
        assert self.folder
        self.store.save_edits(self.folder, self.edits)

    def _known(self, ids: list[str]) -> list[str]:
        return [i for i in dict.fromkeys(ids) if i in self.photos]

    def _add_manual_sets(self, new_sets: list[list[str]]) -> None:
        ids = {i for s in new_sets for i in s}
        kept = [[i for i in s if i not in ids] for s in self.edits["manual_sets"]]
        self.edits["manual_sets"] = [s for s in kept if s] + [s for s in new_sets if s]
        self._save_edits()

    def merge_sets(self, a: list[str], b: list[str]) -> None:
        ids = self._known(a + b)
        if len(ids) < 2:
            raise ValueError("Pick two sets to merge")
        self._add_manual_sets([ids])

    def split_set(self, ids: list[str], selected: list[str]) -> None:
        ids = self._known(ids)
        chosen = [i for i in self._known(selected) if i in ids]
        rest = [i for i in ids if i not in chosen]
        if not chosen or not rest:
            raise ValueError("Select some, but not all, photos of the set to split them off")
        self._add_manual_sets([chosen, rest])

    def exclude_from_set(self, photo_id: str) -> None:
        if photo_id not in self.photos:
            raise KeyError(photo_id)
        self._add_manual_sets([[photo_id]])

    def reset_sets(self) -> None:
        self.edits["manual_sets"] = []
        self._save_edits()

    # ------------------------------------------------------------------ AI mode
    def enable_ai(self, background: bool = True) -> None:
        if not self.ai_available:
            raise RuntimeError(ai.INSTALL_HINT)
        if self.status != "ready" or not self.folder:
            raise RuntimeError("Library is not ready")
        with self._lock:
            self.ai_enabled = True
            self.store.update_settings(ai_enabled=True)
            if self.ai_status in ("loading", "running", "ready"):
                return
            self._start_ai(background)

    def cancel_ai(self) -> None:
        """Stop the running analysis. Finished photos stay cached, so a later run resumes."""
        with self._lock:
            self.ai_enabled = False
            self.store.update_settings(ai_enabled=False)
            if self.ai_status in ("loading", "running"):
                self._ai_gen += 1  # the worker notices between batches and stops
                self.ai_status = "cancelled"

    def rerun_ai(self, background: bool = True) -> None:
        """Forget cached analysis for this folder and classify every photo again."""
        if not self.ai_available:
            raise RuntimeError(ai.INSTALL_HINT)
        if self.status != "ready" or not self.folder:
            raise RuntimeError("Library is not ready")
        with self._lock:
            self._ai_gen += 1
            self._ai_cache = {}
            self.store.clear_features(self.folder)
            self.ai_features, self.ai_status = {}, "off"
        self.enable_ai(background)

    def _start_ai(self, background: bool) -> None:
        with self._lock:
            self._ai_gen += 1
            gen, folder, photos = self._ai_gen, self.folder, list(self.photos.values())
            self.ai_status = "loading" if self._analyzer is None else "running"
            self.ai_progress, self.ai_total, self.ai_error = 0, len(photos), None
            self.ai_unreadable = []
        if background:
            self._ai_thread = threading.Thread(
                target=self._run_ai, args=(gen, folder, photos), daemon=True
            )
            self._ai_thread.start()
        else:
            self._run_ai(gen, folder, photos)

    def _save_ai_cache(self, folder: str, cache: dict, keys: dict[str, str]) -> None:
        """Persist results for the current files only (drops entries of changed/deleted files)."""
        current = set(keys.values())
        self.store.save_features(folder, {k: f for k, f in cache.items() if k in current})

    def _load_for_ai(self, p: Photo):
        try:
            return load_small(p.path, AI_IMAGE_SIZE)
        except Exception:
            return None

    def _run_ai(self, gen: int, folder: str | None, photos: list[Photo]) -> None:
        assert folder
        cache = self._ai_cache  # this folder's cache, even if another folder is opened meanwhile
        keys: dict[str, str] = {}  # photo id -> file_key, for this version of each file
        try:
            with self._ai_lock:
                if self._analyzer is None:  # first use: may download the models
                    analyzer = self._analyzer_factory()
                    analyzer.load()
                    self._analyzer = analyzer
                with self._lock:
                    if gen == self._ai_gen:
                        self.ai_status = "running"
                feats: dict[str, ai.Features] = {}
                todo: list[Photo] = []
                for p in photos:
                    try:
                        keys[p.id] = file_key(p.path)
                    except OSError:
                        continue  # deleted meanwhile
                    if keys[p.id] in cache:
                        feats[p.id] = cache[keys[p.id]]
                    else:
                        todo.append(p)
                with self._lock:
                    self.ai_progress = len(feats)
                for n, i in enumerate(range(0, len(todo), AI_BATCH)):
                    if gen != self._ai_gen:  # cancelled or replaced: keep what is finished
                        self._save_ai_cache(folder, cache, keys)
                        return
                    batch = todo[i : i + AI_BATCH]
                    with ThreadPoolExecutor(self._workers) as pool:
                        images = list(pool.map(self._load_for_ai, batch))
                    ok = [(p, im) for p, im in zip(batch, images, strict=True) if im is not None]
                    if ok:
                        results = self._analyzer.analyse([im for _, im in ok])
                        for (p, _), f in zip(ok, results, strict=True):
                            cache[keys[p.id]] = f
                            feats[p.id] = f
                    with self._lock:
                        self.ai_progress += len(batch)
                        self.ai_unreadable += [
                            p.id for p, im in zip(batch, images, strict=True) if im is None
                        ]
                    if n % 8 == 7:  # large folders: persist progress every 128 photos
                        self._save_ai_cache(folder, cache, keys)
                self._save_ai_cache(folder, cache, keys)
            with self._lock:
                if gen == self._ai_gen and folder == self.folder:
                    self.ai_features = feats
                    self.ai_status = "ready"
        except Exception as e:
            with self._lock:
                if gen == self._ai_gen:
                    self.ai_status, self.ai_error = "error", f"{type(e).__name__}: {e}"

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
        now = dt.datetime.now().strftime(TIME_FORMAT)
        with self._lock, open(log_path, "a", newline="") as lf:
            log = csv.writer(lf)
            if new_log:
                log.writerow(LOG_HEADER)
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

    # ------------------------------------------------------------------ undo
    def _log_rows(self) -> list[dict]:
        assert self.folder
        path = os.path.join(self.folder, LOG_NAME)
        if not os.path.exists(path):
            return []
        with open(path, newline="") as f:
            return list(csv.DictReader(f))

    def _last_batch(self) -> tuple[str | None, list[dict]]:
        """Rows of the most recent apply that hasn't been undone yet (batch = same timestamp).

        Undo rows have action "undo <x>" and detail "batch <time>; ...", so undoing again
        steps one batch further back.
        """
        rows = self._log_rows()
        undone = {
            r["detail"][6:].split(";")[0]
            for r in rows
            if r["action"].startswith("undo ") and r["detail"].startswith("batch ")
        }
        batch = next(
            (
                r["time"]
                for r in reversed(rows)
                if r["action"] in APPLY_ACTIONS and r["time"] not in undone
            ),
            None,
        )
        return batch, [r for r in rows if r["time"] == batch and r["action"] in APPLY_ACTIONS]

    def _undo_check(self, row: dict) -> str | None:
        """Why this logged change can't be undone, or None if it can."""
        assert self.folder
        name = row["file"]
        if os.path.basename(name) != name:
            return "invalid file name in log"
        path = os.path.join(self.folder, name)
        if row["action"] == "shrink":
            return "shrink can't be undone (the original was overwritten)"
        if row["action"] == "delete":
            dest = row["detail"]
            if os.path.dirname(dest) != actions.trash_dir(self.folder)[0]:
                return "log points outside the trash"
            if not os.path.exists(dest):
                return "no longer in the trash"
            if os.path.exists(path):
                return "a file with this name already exists"
            return None
        if not os.path.exists(path):
            return "file is missing"
        return None

    @staticmethod
    def _rotate_turns(row: dict) -> int:
        return int(row["detail"].split()[0]) // 90  # detail: "90 deg cw, lossless (EXIF tag)"

    def undo_plan(self) -> dict:
        """What undo would do, without changing anything."""
        if self.status != "ready" or not self.folder:
            raise RuntimeError("Library is not ready")
        batch, rows = self._last_batch()
        items = []
        for r in reversed(rows):
            reason = self._undo_check(r)
            if reason:
                msg = reason
            elif r["action"] == "delete":
                msg = "move back from the trash"
            else:
                msg = f"rotate back {self._rotate_turns(r) * 90}° counter-clockwise"
            items.append(
                {"id": r["file"], "action": r["action"], "ok": reason is None, "message": msg}
            )
        return {"batch": batch, "items": items}

    def undo(self) -> dict:
        """Reverse the most recent not-yet-undone apply, as far as possible, and log it."""
        if self.status != "ready" or not self.folder:
            raise RuntimeError("Library is not ready")
        log_path = os.path.join(self.folder, LOG_NAME)
        now = dt.datetime.now().strftime(TIME_FORMAT)
        results: list[dict] = []
        with self._lock:
            batch, rows = self._last_batch()
            if batch is None:
                raise RuntimeError("Nothing to undo")
            with open(log_path, "a", newline="") as lf:
                log = csv.writer(lf)
                for r in reversed(rows):  # newest first, e.g. shrink before rotate of one file
                    path = os.path.join(self.folder, r["file"])
                    ok, msg = False, self._undo_check(r)
                    if msg is None:
                        try:
                            if r["action"] == "delete":
                                shutil.move(r["detail"], path)
                                msg = "moved back from the trash"
                            else:
                                how = actions.rotate(path, 4 - self._rotate_turns(r))
                                msg = f"rotated back ({how})"
                            ok = True
                        except Exception as e:
                            msg = f"error: {e}"
                    size = os.path.getsize(path) if os.path.exists(path) else 0
                    log.writerow(
                        [now, r["file"], f"undo {r['action']}", f"batch {batch}; {msg}", "", size]
                    )
                    results.append({"id": r["file"], "ok": ok, "message": msg})
        self.open(self.folder, background=False)
        return {"batch": batch, "results": results, "log": log_path}
