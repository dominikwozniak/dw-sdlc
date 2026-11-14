---
"dw-sdlc": patch
---

`pr ship` counts a check not yet started from the head's ready when it left draft after its commit, so CI queued right after the script marks a draft ready waits as `ci-pending` instead of parking as `ci-stuck`.

`pr ship` never posts `off: lockfiles only` over an open Finding: under `pr.review: auto` a push that changes only lockfiles after a read mark gets a `light` Review, and three Reviews with Findings open park as `review-limit` at every depth, `pr.review: off` included; only the dev's `--review off` posts past the limit.

`pr ship` reads the head's `dw-sdlc/review` status by its name when the pull request has more checks than the first 50 it reads, so a reviewed head whose status the rollup lists past them no longer asks for a Review again.
