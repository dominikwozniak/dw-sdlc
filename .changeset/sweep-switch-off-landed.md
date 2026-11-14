---
"dw-sdlc": minor
---

`dw-sdlc sweep` names `git switch <base> && git pull --rebase` for a Landed branch the main checkout has checked out, when its tree is clean and nothing is paused there, so the next Sweep can remove the branch. A linked worktree's branch keeps no command.
