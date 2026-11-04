---
"dw-sdlc": minor
---

`dw-sdlc gate --cache` skips the run when the working tree, the resolved Gate and the version of dw-sdlc match the last green run in that checkout, so a pre-push hook that runs the Gate costs nothing on an unchanged tree. The tree is hashed with `git write-tree` over a copy of the index, untracked files in and ignored files out, and the real index is never touched. The stamp lives in the checkout's own git dir, so each worktree keeps its own, and holds the hash taken before the run, so a Gate that changes the tree runs again. A tree it cannot hash runs the whole Gate. A skipped run prints `gate: green — skipped, the tree matches the last green run`, or under `--json` a green document with `cached: true`. The cache is off without the flag and does not combine with `--update-baseline`.
