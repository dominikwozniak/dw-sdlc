---
"dw-sdlc": minor
---

`dw-sdlc recap [--json]` reads the facts a Recap rests on: the branch, uncommitted changes, unpushed commits or a missing upstream, the branch's pull request with the Action the Ship script's decision gives it, read and never performed, and whether the session sits in a linked worktree. It answers whether the session can be closed, with every reason: exit 0 yes, 1 no, 2 cannot run.

`dw-sdlc doctor` adds a `sessions` line for the `sdlc-sessions` plugin and the drift of its copy of the package. The state `dw-sdlc pr ship --verbose` shows under `facts` lists the pull request's `commits`.
