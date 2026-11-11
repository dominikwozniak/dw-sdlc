---
"dw-sdlc": patch
---

`pr ship` answers `done` with no `git push origin --delete <branch>` for a merged pull request from a fork: its head branch lives on the fork, not on `origin`.
