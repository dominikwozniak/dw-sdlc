---
"dw-sdlc": patch
---

`dw-sdlc worker start`: when the fetch of origin's default branch fails, the remedy names `git remote set-head origin --auto`, which repairs an `origin/HEAD` that names a branch gone from the remote.
