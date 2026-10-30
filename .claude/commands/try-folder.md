---
description: Build the UI and start the app on a folder for manual testing
argument-hint: <photo folder path>
---
Run `make build`, then start the app in the background with
`backend/.venv/bin/photo-cleanup --no-browser $ARGUMENTS` and tell me to open http://127.0.0.1:8000.
Do NOT press Apply or call POST /api/apply yourself — applying changes is the user's decision.
