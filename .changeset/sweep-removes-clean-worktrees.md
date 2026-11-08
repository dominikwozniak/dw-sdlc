---
"dw-sdlc": minor
---

`dw-sdlc sweep` also removes every linked worktree of the repository, wherever it lies, whose whole set passes: no modified or untracked file (ignored files aside), no paused rebase, merge, cherry-pick, revert or bisect, no lock, and its HEAD Landed, on a branch or detached. It removes the worktree without force, then deletes the branch it had checked out in the same run. A worktree it keeps is named with its reason: the files that hold it with the forced removal as the dev's command, the paused operation, the lock's reason, a HEAD that is not Landed, or git's own words when git refuses. The main checkout is never removed. `--dry-run` and `--json` cover worktrees; the exit code is 0 when only the default, the base or a protected branch is kept, and 1 when anything else is.
