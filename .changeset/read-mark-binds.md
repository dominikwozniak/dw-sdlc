---
"dw-sdlc": patch
---

`pr ship` keeps a read mark binding across a merge or a rebase. A read mark with only merges of the base after it, or one a rebase left on the same own changes as the head's, is named in `details.open` on the `review` answer. The Review then reads the whole pull request, with no `details.since` or `details.paths`, and no success carries over the mark. The three-Review count also reads the commits under each head a force push left behind, along its first parents, so a read mark with a fix pushed after it, then a rebase, still counts.
