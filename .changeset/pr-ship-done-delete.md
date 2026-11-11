---
"dw-sdlc": patch
---

`dw-sdlc pr ship` names `git push origin --delete <branch>` in `done` only while the head branch still stands on the remote; once GitHub has deleted it, `done` carries no command.
