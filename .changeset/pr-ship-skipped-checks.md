---
"dw-sdlc": patch
---

`dw-sdlc pr ship` waits for the run a draft's `ready` starts: a ready head whose every check was skipped is unverified, and parks for the dev when no run comes within the grace.
