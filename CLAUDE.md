# Pixora (repo: photo-cleanup) — guide for Claude Code

Local web app that sorts photos into content categories and similar sets, suggests the best one
to keep, and lets the user review keep/delete/rotate/shrink decisions before anything on disk
changes. Two editions share one React UI:

- **Desktop app**: FastAPI backend (`backend/`), full features incl. optional local AI.
- **Web edition** (`npm run build:web`, GitHub Pages): no server; `frontend/src/web/engine.ts`
  implements the same API in the browser (File System Access API on Chrome/Edge, read-only
  folder upload elsewhere). No AI categories or shrink there. `isWeb` in `api.ts` switches.

Releases: bump the version in `backend/pyproject.toml`, `backend/src/photo_cleanup/__init__.py`,
`frontend/package.json`; add a CHANGELOG section; push a `vX.Y.Z` tag (see README).

## Layout

```
backend/                     Python package `photo_cleanup` (FastAPI)
  src/photo_cleanup/
    analysis.py              perceptual hash (rotation-invariant dHash), sharpness/exposure score, grouping
    actions.py               file ops: move_to_trash, lossless JPEG rotate (EXIF tag patch), shrink
    library.py               Library = one opened folder: background scan, caches, apply() / undo() + CSV log
    ai.py                    OPTIONAL AI mode: DINOv2 embeddings + CLIP-IQA quality, complete-linkage
                             grouping. torch/transformers are imported lazily, only inside this file
    categories.py            content categories: prompts, thresholds, classify() (multi-label)
    store.py                 ~/.pixora (PIXORA_HOME): settings, per-folder edits, cached features
    browse.py                read-only folder listing for the folder picker (names + photo counts)
    api.py                   FastAPI routes under /api; serves the built UI from static/
    cli.py                   `photo-cleanup [FOLDER]` entry point (uvicorn + opens browser)
    static/                  BUILD OUTPUT of frontend (git-ignored) — never edit by hand
  tests/                     pytest; conftest.py makes synthetic photos in tmp dirs
frontend/                    React 19 + Vite + TypeScript
  src/App.tsx                page state: library status polling, groups, decisions, toolbar
  src/decisions.ts           pure logic: autoSelect (best N per group), summarise, describe
  src/sets.ts                groups → "sets" (Set 1…, Unique shots) shown as cards and review sections
  src/pile.ts                seeded layout of the round photo heap (tile size scales with photo count);
                             set cards animate their thumbnails in from the heap (Web Animations API)
  src/components/            AppHeader, FileStatistics, PhotoCategorySection/Card (set cards, click =
                             filter the review), UnsortedPhotoPile, PhotoThumbnail, ReviewToolbar,
                             PhotoCard, GroupSection, Lightbox (keyboard: ←/→, D, R, Esc), ApplyModal,
                             UndoModal, FolderPicker (recent folders via src/recent.ts, localStorage)
  src/api.ts, src/types.ts   typed API client — keep in sync with backend/api.py
```

## Commands

- `make setup-ai` — optional AI extra (torch, transformers); `make test-ai` runs the real models
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
| GET | /api/dirs?path= | sub-folders + photo counts, shortcut places (home, Pictures…, /Volumes) |
| GET | /api/groups?threshold=22&time_window=120 | 409 until ready; each group has `best` and `ranked` ids |
| GET | /api/groups?mode=ai&similarity=0.95 | AI grouping/ranking; 409 until `library.ai.status=="ready"` |
| POST | /api/ai | enable AI analysis (similarity, quality, categories); remembered in settings |
| POST | /api/ai/cancel, /api/ai/rerun | stop (finished photos stay cached) / forget cache and redo |
| GET | /api/categories | per category: photo ids (primary first) and which are extra labels; 409 until AI ready |
| PUT | /api/photos/{id}/category | `{category}` user correction, `null` = automatic; persisted |
| POST | /api/sets/merge, split, exclude, reset | set edits stored as fixed photo-id sets; persisted |
| GET | /api/photos/{id}/thumb, /preview | JPEG, EXIF orientation applied; id = file name |
| POST | /api/apply | `{actions:[{id,delete,rotate(0-3 cw),shrink}], shrink:{max_side,quality}}` |
| GET/POST | /api/undo | preview / reverse the newest not-yet-undone apply batch from the CSV log (deletes and rotations; shrink can't be undone) |

## Rules — safety first (this app touches people's real photos)

- Nothing may change on disk except through `Library.apply()` after the user confirms in ApplyModal.
- Delete = **move** to macOS `~/.Trash` (or `<folder>/_to_delete` elsewhere). Never `os.remove` photos.
- Rotation of JPEGs must stay lossless (patch EXIF orientation); re-encode only as a fallback.
- Every applied change is appended to `photo_cleanup_log.csv` in the photo folder.
- Tests must never touch real user folders or the real Trash: use `tmp_path` and
  `monkeypatch.setattr(sys, "platform", "linux")`.
- Classification and set edits never touch photo files. Pixora's own data lives only in the
  store (`~/.pixora` or `PIXORA_HOME`); tests get a temp home from an autouse fixture.
- Categories: never invent labels. Unsure photos are `other` with no labels; only CLIP scores or
  user corrections put a photo in a category.
- AI mode must stay optional: the app, tests and CI must work without torch/transformers
  (tests use a fake analyzer; real models only under `PHOTO_CLEANUP_AI_TESTS=1`).
- Web edition: open folders read-only; ask for write access only on Apply/Undo; "delete" =
  verified copy into `_to_delete/` then remove. The CSP (`vite.config.ts`) blocks network uploads.
- Server binds to 127.0.0.1 only. Photo ids are file names looked up in the scanned set — never
  build file paths from request input.

## Conventions

- Python ≥ 3.10, ruff (line length 100), type hints, small pure functions in analysis/actions.
- Frontend: function components + hooks, no UI library, plain CSS in `index.css` with CSS variables
  (light + dark). Look: warm blush palette, system serif italics for accents (no web fonts:
  the app must work offline), thin borders, shadows only on the photo pile. Prettier: no semicolons, single quotes, width 100.
- Changing an API shape → update `backend/api.py`, `frontend/src/types.ts`, `frontend/src/api.ts`,
  and add/adjust a test in `backend/tests/test_api.py`.

## Ideas / backlog

- AI mode: closed-eyes / face checks (MediaPipe) for people photos; persist AI features to disk.
- Subfolder recursion.
- Video duplicates; exact-duplicate detection by file hash across folders.
