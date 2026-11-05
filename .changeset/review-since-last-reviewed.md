---
"dw-sdlc": minor
---

`dw-sdlc pr ship` names the last commit of the pull request that carries a `dw-sdlc/review` success under `details.since`, so the Review after a push reads only the changes from it to the head. When the pull request's own changes since the base are the same at the head as at that commit, as after an `update-branch` merge, the script carries the status: it posts `dw-sdlc/review` as `mark-reviewed`, described as `carried from <sha>`, and parks with that command under `--dry-run`. A history that no longer holds a reviewed commit, after a rebase or a force push, names none, and the Review reads the whole diff since the base. Both reads go through `gh`, so they work under `-R` without a checkout.
