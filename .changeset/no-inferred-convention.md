---
"dw-sdlc": minor
---

Inference no longer names a commit convention. A repository whose config sets neither `commit.convention` nor `commit.pattern` resolves with no pattern, so its commit subjects go unchecked, and `dw-sdlc doctor` reports `commit unchecked`.
