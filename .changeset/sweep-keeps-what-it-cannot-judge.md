---
"dw-sdlc": patch
---

`sweep` reads each worktree again just before it removes it and keeps one whose HEAD, branch or lock changed since it was judged, or that holds a file or a paused operation by then, so a commit a Worker makes while it is stopped stays; a branch goes only while it points at the commit judged Landed.
`sweep` keeps a worktree whose removal outlives its time limit, now ten minutes, with the limit it hit, and goes on, so what it removed before and after is still reported; it no longer stops with exit 2 there.
`sweep` keeps a branch a rebase paused in a kept worktree works on, with that reason and no command, where it planned to delete a Landed one and named `git branch -D` for another, both of which git refuses.
