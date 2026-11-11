---
"dw-sdlc": minor
---

`dw-sdlc lead start --name <name> --prompt <first message>` starts the next session as a Lead in a herdr terminal of its own: `role=lead`, the caller's space, `--outlive-parent` and the main checkout, on `worker.command` without `--dangerously-skip-permissions` and without `--worktree`. It names the tab, reads the first message back without sending it twice, and refuses outside herdr and in a linked worktree.
