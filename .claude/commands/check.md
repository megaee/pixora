---
description: Run all checks (lint, type-check, tests, build) and fix any failures
---
Run `make check`. If anything fails, fix the root cause (don't silence lint rules or skip tests),
then run `make check` again until it passes. Summarise what you changed.
