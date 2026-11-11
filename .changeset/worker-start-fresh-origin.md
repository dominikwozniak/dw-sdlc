---
"dw-sdlc": patch
---

`dw-sdlc worker start` fetches origin's default branch before it starts the Worker, so the Worker's worktree begins from origin's tip, not from the ref the clone last fetched. A failed fetch starts no Worker and exits 2.
