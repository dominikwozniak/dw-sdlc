---
"dw-sdlc": patch
---

`dw-sdlc pr ship` no longer merges a pull request with more checks or review threads than its one read holds. A failure past the first 50 checks, or an open thread past the first 100, showed in no row of the decision; the pull request now parks as `partial-read` with the merge command for the dev.
