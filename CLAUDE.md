# Photo Cleanup — guide for Claude Code

Local web app that finds similar photos in a folder, suggests the best one to keep, and lets the
user review keep/delete/rotate/shrink decisions before anything on disk changes.

## Layout

```
backend/                     Python package `photo_cleanup` (FastAPI)
  src/photo_cleanup/
    analysis.py              perceptual hash (rotation-invariant dHash), sharpness/exposure score, grouping
    actions.py               file ops: move_to_trash, lossless JPEG rotate (EXIF tag patch), shrink
    library.py               Library = one opened folder: background scan, caches, apply() + CSV log
    api.py                   FastAPI routes under /api; serves the built UI from static/
    cli.py                   `photo-cleanup [FOLDER]` entry point (uvicorn + opens browser)
    static/                  BUILD OUTPUT of frontend (git-ignored) — never edit by hand
  tests/                     pytest; conftest.py makes synthetic photos in tmp dirs
frontend/                    React 19 + Vite + TypeScript
  src/App.tsx                page state: library status polling, groups, decisions, toolbar
  src/decisions.ts           pure logic: autoSelect (best N per group), summarise, describe
  src/components/            PhotoCard, GroupSection, Lightbox (keyboard: ←/→, D, R, Esc), ApplyModal
  src/api.ts, src/types.ts   typed API client — keep in sync with backend/api.py
```

## Commands

- `make setup` — venv in `backend/.venv` + `pip install -e backend[dev]` + `npm ci`
- `make dev` — backend :8000 (reload) + Vite :5173 (proxies /api). Optional `FOLDER=...`
- `make test` — pytest · `make lint` — ruff + eslint + tsc + prettier · `make format`
- `make check` — lint + test + build (same as CI). **Run this before saying a change is done.**
- `make start FOLDER=~/Pictures/x` — production-style run on :8000

## API

| Method | Path | Notes |
|---|---|---|
| GET | /api/health | version, heic support |
| GET/POST | /api/library | state / open `{folder}` (starts background scan; poll GET while `status=="scanning"`) |
| GET | /api/groups?threshold=22&time_window=120 | 409 until ready; each group has `best` and `ranked` ids |
| GET | /api/photos/{id}/thumb, /preview | JPEG, EXIF orientation applied; id = file name |
| POST | /api/apply | `{actions:[{id,delete,rotate(0-3 cw),shrink}], shrink:{max_side,quality}}` |

## Rules — safety first (this app touches people's real photos)

- Nothing may change on disk except through `Library.apply()` after the user confirms in ApplyModal.
- Delete = **move** to macOS `~/.Trash` (or `<folder>/_to_delete` elsewhere). Never `os.remove` photos.
- Rotation of JPEGs must stay lossless (patch EXIF orientation); re-encode only as a fallback.
- Every applied change is appended to `photo_cleanup_log.csv` in the photo folder.
- Tests must never touch real user folders or the real Trash: use `tmp_path` and
  `monkeypatch.setattr(sys, "platform", "linux")`.
- Server binds to 127.0.0.1 only. Photo ids are file names looked up in the scanned set — never
  build file paths from request input.

## Conventions

- Python ≥ 3.10, ruff (line length 100), type hints, small pure functions in analysis/actions.
- Frontend: function components + hooks, no UI library, plain CSS in `index.css` with CSS variables
  (light + dark). Prettier: no semicolons, single quotes, width 100.
- Changing an API shape → update `backend/api.py`, `frontend/src/types.ts`, `frontend/src/api.ts`,
  and add/adjust a test in `backend/tests/test_api.py`.

## Ideas / backlog

- Optional CLIP embeddings for content-level similarity (heavier dependency; keep optional).
- Undo last apply from the CSV log; folder browser instead of pasting a path; subfolder recursion.
- Video duplicates; exact-duplicate detection by file hash across folders.
