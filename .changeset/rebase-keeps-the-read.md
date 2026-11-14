---
"dw-sdlc": patch
---

`pr ship` keeps a Review's read across a rebase. When the history holds no head a Review read, it takes the newest head a force push left behind that a Review read, from the pull request's timeline. A clean read whose own changes match the head's carries its success. Any other read becomes `details.since`, with `details.paths` naming the files whose own change moved. The read marks on left-behind heads count toward the three-Review limit.
