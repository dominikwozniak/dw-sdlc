---
"dw-sdlc": patch
---

`pr ship` counts a check not yet started from the head's ready when it left draft after its commit, so CI queued right after the script marks a draft ready waits as `ci-pending` instead of parking as `ci-stuck`.

`pr ship` never posts `off: lockfiles only` over an open Finding: under `pr.review: auto` a push that changes only lockfiles after a read mark gets a `light` Review, and three Reviews with Findings open park as `review-limit` at every depth, `pr.review: off` included; only the dev's `--review off` posts past the limit.

`pr ship` reads the head's `dw-sdlc/review` status by its name when the pull request has more checks than the first 50 it reads, so a reviewed head whose status the rollup lists past them no longer asks for a Review again.

`pr ship` with no number finds the checkout's pull request through the one lookup `recap` uses, so a `gh pr view` failure other than no pull request reads `gh pr view failed: …` with the network remedy, not as a pull request to name.

`pr ship` counts the read marks on heads an amend left behind after the last success toward the three-Review limit, so a fix amended and force-pushed after each Review with a Finding open parks as `review-limit` at the third, as after a rebase, instead of asking for a Review again.

`pr ship` names the ready beside the commit when it parks a head no check reported on as `unverified`, since the grace counts from the later of the two.

`pr ship --help` names the three-Review limit: `review-limit` parks at every depth, `pr.review: off` included, and only the dev's `--review off` posts past it.
