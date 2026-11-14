---
"dw-sdlc": patch
---

`pr ship` counts a check not yet started from the head's ready when it left draft after its commit, so CI queued right after the script marks a draft ready waits as `ci-pending` instead of parking as `ci-stuck`.
