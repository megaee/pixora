# 📷 Photo Cleanup

A local web app that finds **similar photos** in a folder, suggests the **best one to keep**,
and lets you **review every change** (delete, rotate, shrink) before anything happens.

- Groups near-duplicates and burst shots with a perceptual hash that works even when a photo is rotated
- Picks the sharpest, best-exposed photo in each group (★ best)
- Delete moves photos to the **macOS Trash**, so they can be recovered (other OS: `_to_delete/` folder)
- Lossless rotation for JPEGs (only the EXIF orientation tag changes)
- Optional shrink (e.g. 5.8 MB → 1.5 MB at 3000 px, quality 85)
- Every change is logged to `photo_cleanup_log.csv` inside the photo folder
- Runs only on your machine (`127.0.0.1`); no photos are uploaded anywhere

## Requirements

- **Python 3.10+** — macOS ships 3.9, so install a newer one: `brew install python@3.12`
- **Node.js 20+** (only for building/developing the UI): `brew install node`

## Quick start

```bash
make setup                                   # one-time: venv + dependencies
make start FOLDER=~/Pictures/trip            # builds the UI and opens http://127.0.0.1:8000
```

If `python3 --version` shows 3.9, run setup with a newer Python: `make setup PY=python3.12`

Then in the browser:

1. Paste a folder path and click **Open folder** (or pass `FOLDER=` as above).
2. Adjust **Similarity** to make groups looser or stricter.
3. Use **Best 1 / Best 2 / Keep all**, or toggle photos yourself. Click a photo for a large view
   (keys: ← → to move, **D** to delete or keep, **R** to rotate, **Esc** to close).
4. **Apply changes…** shows the full list, and nothing happens until you confirm.

iPhone HEIC photos: `backend/.venv/bin/pip install -e "backend[heic]"`

## Development

```bash
make dev FOLDER=~/Pictures/trip   # API on :8000 with reload + UI on http://localhost:5173 with hot reload
make test                         # pytest
make lint                         # ruff, eslint, tsc, prettier
make check                        # everything CI runs
```

Project structure, API and coding rules are in [CLAUDE.md](CLAUDE.md).

## Working on it with Claude Code

```bash
cd photo-cleanup
claude
```

Claude Code reads `CLAUDE.md` automatically. Project slash commands:

- `/check` runs all checks and fixes failures
- `/new-feature <description>` implements a feature end-to-end with tests
- `/try-folder <path>` builds the app and starts it on a folder for manual testing

## Push to GitHub

```bash
gh repo create photo-cleanup --private --source . --push
```

GitHub Actions (`.github/workflows/ci.yml`) then runs lint, tests (Ubuntu + macOS, Python 3.10/3.12)
and the UI build on every push and PR.
