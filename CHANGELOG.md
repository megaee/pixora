# Changelog

All notable changes to Pixora. The format follows [Keep a Changelog](https://keepachangelog.com/)
and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0-beta.1] - 2026-10-30

First public release, published as a pre-release: the web edition's real folder pickers (Chrome /
Edge directory picker, folder upload in other browsers) still need hands-on testing across
browsers before 1.0.0.

### Added

- **Web edition** on GitHub Pages: runs entirely in the browser, no server and no uploads.
  Finds similar sets and the best shot with the same algorithm as the desktop app; Chrome and
  Edge can apply changes after asking for permission; other browsers can review read-only.
- **Content categories** (desktop app, optional AI add-on): 15 categories such as Travel & Vibes,
  Food & Cafés or Screenshots, scored locally with CLIP; multi-label with confidence; unsure
  photos go to *Other / Unclassified*; corrections are saved.
- **Similar sets** view: open a set, remove a photo, split or merge sets, search, filter by
  category, sort; edits are saved.
- Pixora branding, logo and favicon; editorial redesign with statistics, category cards and the
  photo pile with a sorting animation.
- Optional **AI mode** (DINOv2 grouping, CLIP-IQA best shot), **undo last apply**, folder picker
  with photo counts and recent folders, file/video counts.
- Cached AI analysis in `~/.pixora` (per file name, size and modification time), with progress,
  stop/resume and re-run.
- CI for backend and frontend, GitHub Pages deployment and tag-driven releases.

### Fixed

- Thumbnails drawn on top of dialogs; layout overflow on phones; a loading state that briefly
  claimed a folder had no photos.

### Known limitations

- Web edition: no AI categories, AI mode or shrinking (desktop app only); browsers have no Trash,
  so "delete" moves photos into a `_to_delete` sub-folder of the chosen folder; only the folder's
  own files are scanned (not sub-folders); HEIC and TIFF are skipped by browsers that cannot
  decode them.
- Categories are zero-shot CLIP ViT-B/32: reliable for clear subjects, weaker for close ones
  (Outfits vs Selfies, Friends vs Events); corrections are by hand.
