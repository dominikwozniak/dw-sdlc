---
"dw-sdlc": patch
---

`pr ship` keeps the Review of a fix to the pull request's own changes when the base was merged in after the head a Review read: `details.paths` names the files whose own change moved, and `pr.review: auto` routes the depth on those files alone, so a merge of the base no longer routes a small fix to `full`.
