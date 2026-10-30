"""Pixora's FastAPI application: JSON API under /api, built React app served from / ."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, ai, browse
from .analysis import HEIC_SUPPORTED
from .library import Action, Library

STATIC_DIR = Path(__file__).parent / "static"


class OpenFolder(BaseModel):
    folder: str


class ActionIn(BaseModel):
    id: str
    delete: bool = False
    rotate: int = Field(0, ge=0, le=3)
    shrink: bool = False


class ShrinkOptions(BaseModel):
    max_side: int = Field(3000, ge=512, le=10000)
    quality: int = Field(85, ge=40, le=100)


class ApplyIn(BaseModel):
    actions: list[ActionIn]
    shrink: ShrinkOptions = ShrinkOptions()


class CategoryIn(BaseModel):
    category: str | None  # None = back to the model's choice


class MergeIn(BaseModel):
    a: list[str]
    b: list[str]


class SplitIn(BaseModel):
    ids: list[str]
    selected: list[str]


class ExcludeIn(BaseModel):
    id: str


def create_app(library: Library | None = None, folder: str | None = None) -> FastAPI:
    lib = library or Library()
    app = FastAPI(title="Pixora", version=__version__)
    app.state.library = lib

    # Vite dev server runs on :5173 and proxies /api, but allow direct calls too.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    start_folder = folder or os.environ.get("PHOTO_CLEANUP_FOLDER")
    if start_folder:
        lib.open(start_folder)

    @app.get("/api/health")
    def health() -> dict:
        return {
            "ok": True,
            "name": "Pixora",
            "version": __version__,
            "heic": HEIC_SUPPORTED,
            "ai": lib.ai_available,
        }

    @app.get("/api/library")
    def get_library() -> dict:
        return lib.state()

    @app.post("/api/library")
    def open_library(body: OpenFolder) -> dict:
        try:
            lib.open(body.folder)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e)) from e
        return lib.state()

    @app.get("/api/dirs")
    def list_dirs(path: str | None = None) -> dict:
        try:
            return browse.list_dir(path)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e)) from e
        except PermissionError as e:
            raise HTTPException(403, str(e)) from e

    @app.get("/api/groups")
    def get_groups(
        threshold: int = Query(22, ge=0, le=256),
        time_window: int = Query(120, ge=0, le=86400),
        mode: Literal["classic", "ai"] = "classic",
        similarity: float = Query(ai.DEFAULT_SIMILARITY, ge=0.5, le=1.0),
    ) -> dict:
        if lib.status != "ready":
            raise HTTPException(409, f"Library is {lib.status}")
        try:
            groups = lib.groups(threshold, time_window, mode=mode, similarity=similarity)
        except RuntimeError as e:
            raise HTTPException(409, str(e)) from e
        return {"threshold": threshold, "mode": mode, "similarity": similarity, "groups": groups}

    def _do(fn, *args) -> dict:
        """Run a library change and map its errors to HTTP status codes."""
        try:
            fn(*args)
        except KeyError as e:
            raise HTTPException(404, "Photo not found") from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        except RuntimeError as e:
            raise HTTPException(409, str(e)) from e
        return lib.state()

    @app.post("/api/ai")
    def enable_ai() -> dict:
        """Turn on AI analysis (similarity, quality, categories); remembered across restarts."""
        return _do(lib.enable_ai)

    @app.post("/api/ai/cancel")
    def cancel_ai() -> dict:
        return _do(lib.cancel_ai)

    @app.post("/api/ai/rerun")
    def rerun_ai() -> dict:
        """Drop cached analysis for this folder and classify every photo again."""
        return _do(lib.rerun_ai)

    @app.get("/api/categories")
    def get_categories() -> dict:
        if lib.status != "ready":
            raise HTTPException(409, f"Library is {lib.status}")
        try:
            return lib.categories()
        except RuntimeError as e:
            raise HTTPException(409, str(e)) from e

    @app.put("/api/photos/{photo_id}/category")
    def set_category(photo_id: str, body: CategoryIn) -> dict:
        return _do(lib.set_category, photo_id, body.category)

    @app.post("/api/sets/merge")
    def merge_sets(body: MergeIn) -> dict:
        return _do(lib.merge_sets, body.a, body.b)

    @app.post("/api/sets/split")
    def split_set(body: SplitIn) -> dict:
        return _do(lib.split_set, body.ids, body.selected)

    @app.post("/api/sets/exclude")
    def exclude_from_set(body: ExcludeIn) -> dict:
        return _do(lib.exclude_from_set, body.id)

    @app.post("/api/sets/reset")
    def reset_sets() -> dict:
        return _do(lib.reset_sets)

    def _image(photo_id: str, size: int) -> Response:
        try:
            data = lib.image(photo_id, size)
        except KeyError as e:
            raise HTTPException(404, "Photo not found") from e
        return Response(data, media_type="image/jpeg", headers={"Cache-Control": "no-cache"})

    @app.get("/api/photos/{photo_id}/thumb")
    def thumb(photo_id: str) -> Response:
        return _image(photo_id, 420)

    @app.get("/api/photos/{photo_id}/preview")
    def preview(photo_id: str) -> Response:
        return _image(photo_id, 1800)

    @app.post("/api/apply")
    def apply(body: ApplyIn) -> dict:
        try:
            return lib.apply(
                [Action(**a.model_dump()) for a in body.actions],
                max_side=body.shrink.max_side,
                quality=body.shrink.quality,
            )
        except RuntimeError as e:
            raise HTTPException(409, str(e)) from e

    @app.get("/api/undo")
    def get_undo() -> dict:
        try:
            return lib.undo_plan()
        except RuntimeError as e:
            raise HTTPException(409, str(e)) from e

    @app.post("/api/undo")
    def undo() -> dict:
        try:
            return lib.undo()
        except RuntimeError as e:
            raise HTTPException(409, str(e)) from e

    if (STATIC_DIR / "index.html").exists():
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="ui")

    return app
