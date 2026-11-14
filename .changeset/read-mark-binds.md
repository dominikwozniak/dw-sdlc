---
"dw-sdlc": patch
---

`pr ship` keeps a read mark binding across a merge or a rebase. A read mark that a merge of the base or a rebase came after, with the own changes as it read them, is named in `details.open` on the `review` answer. The Review then reads the whole pull request, with no `details.since` or `details.paths`, and no success carries over the mark. The three-Review count also reads the commits under each head a force push left behind, along its first parents, so a read mark with a fix pushed after it, then a rebase, still counts.
