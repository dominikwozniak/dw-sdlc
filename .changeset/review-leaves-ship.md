---
"dw-sdlc": minor
---

The Review leaves `pr ship`. Under `pr.merge: auto` the script merges a head on green CI or a Gate mark, with no open review thread and no change request, on the viewer's own pull request; it waits for nothing else, and a stale `dw-sdlc/review` status on the head changes nothing. `pr reviewed`, `pr ship --review`, the `pr.review`, `pr.reviewFull` and `pr.reviewCommand` keys, the review limit, the read mark and the `review`, `mark-reviewed` and `review-limit` Actions are removed; a layer that still sets a `pr.review*` key turns invalid, so strip it before updating. Under footprint `local` the git dir keeps only Gate marks, `.git/dw-sdlc/gates/<n>.json`; `.git/dw-sdlc/reviews/` is no longer read.
