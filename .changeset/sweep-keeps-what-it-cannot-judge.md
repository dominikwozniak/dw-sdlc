---
"dw-sdlc": patch
---

`sweep` reads each worktree again just before it removes it and keeps one whose HEAD, branch or lock changed since it was judged, or that holds a file or a paused operation by then, so a commit a Worker makes while it is stopped stays; a branch goes only while it points at the commit judged Landed.
