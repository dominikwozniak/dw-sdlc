---
"dw-sdlc": minor
---

`dw-sdlc pr ship` names the last commit of the pull request that carries a `dw-sdlc/review` success under `details.since`, so the Review after a push reads only the changes from it to the head. A success posted under `off` does not count.

A head that only merged the base in carries the status, as after `update-branch`. Every commit since the reviewed one must be a merge, and the pull request's own changes since the base must be the same at both. The script then posts `dw-sdlc/review` as `mark-reviewed`, described as `carried from <sha>`. Under `--dry-run` it parks with that command. The dev's `--review full` asks for a Review of the whole diff instead.

A history that no longer holds a reviewed commit, after a rebase or a force push, names none, and the Review reads the whole diff since the base. Both reads go through `gh`, so they work under `-R` without a checkout.
