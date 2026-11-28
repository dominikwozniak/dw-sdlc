---
"dw-sdlc": minor
---

`pr ship` finishes the Landed branch at `done`. In the main checkout `next` is one agent step, `git switch <base> && git pull --rebase && git branch -D <branch>`, holding only what the state allows: no `git switch` when the checkout is on another branch, no `-D` when the branch is not local or its tip is not the merged head, and then a `do` step says the branch stays and why. While the head ref still stands on the remote, `git push origin --delete <branch>` follows as the dev's step; a fork's branch is named nowhere. In a linked worktree the one step is the dev's `/sdlc-sweep`. A call that names the pull request with `-R` reads no checkout and answers as before. The script never passes `--delete-branch`.
