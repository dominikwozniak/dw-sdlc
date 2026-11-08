---
"dw-sdlc": patch
---

`dw-sdlc` exits 2 with one line on stderr when a command throws what it has no answer for, such as a config path that is a directory or a `TMPDIR` it cannot write to. Exit 1 stays what a command answers once it reaches a verdict.
