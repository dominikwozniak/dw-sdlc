---
"dw-sdlc": minor
---

`dw-sdlc sweep` removes a worktree locked by a Claude Code session whose process is gone. Claude Code's lock reason is `claude session <name> (pid <N> start <time>)`; the lock is stale when no process N runs or N started at another time, as a reused pid does. The Sweep lifts it just before it removes the worktree, only when the rest of the set passes, and puts it back if git then refuses the removal. A lifted lock is an item of kind `lock` in `removed`, before its worktree; `--dry-run` lifts nothing and says it would. A live lock keeps the worktree, named by its pid. A lock with any other reason keeps it, with the reason and `git worktree unlock` as the dev's command.
