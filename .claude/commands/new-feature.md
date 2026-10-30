---
description: Implement a feature end-to-end (backend + frontend + tests)
argument-hint: <what the feature should do>
---
Implement this feature in Photo Cleanup: $ARGUMENTS

1. Read CLAUDE.md (especially the safety rules) and the files you will touch.
2. Backend first: logic in analysis.py / actions.py / library.py, route in api.py, tests in backend/tests.
3. Frontend: update types.ts and api.ts if the API changed, then the UI components.
4. Run `make check` and fix failures.
5. Reply with a short summary of the change and how to try it (`make dev`).
