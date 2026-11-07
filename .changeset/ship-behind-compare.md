---
"dw-sdlc": patch
---

`dw-sdlc pr ship` updates a branch behind its base whether or not GitHub reports `BEHIND`. It judges "behind" from the compare of the base with the head, so in a repository with no rule that a branch be up to date, a pull request no longer merges without CI on the tree the merge makes.
