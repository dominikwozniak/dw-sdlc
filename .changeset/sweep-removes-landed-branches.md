---
"dw-sdlc": minor
---

`dw-sdlc sweep [--dry-run] [--json]` deletes every Landed local branch, run from the main checkout. It fetches origin, reads the base as the guard does (`baseBranch` of the config, else the branch `origin/HEAD` names) and judges Landed by the guard's rule: the tip is on the base, or a base commit since the fork holds the tip's tree or the verbatim patch-id of its whole diff. It keeps the default branch, a protected branch and a branch any worktree has checked out, and names each kept branch with its reason; a branch whose work is on no commit of the base stays with the forced delete as the command for the dev to run. It never forces and never writes to a remote. One line an item, or one document with `--json` listing `removed` and `kept`; exit 0 when nothing is kept, 1 when something is, 2 when it cannot run, a linked worktree included.
