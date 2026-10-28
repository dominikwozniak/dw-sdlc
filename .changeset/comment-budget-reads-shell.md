---
"dw-sdlc": minor
---

`comment-budget` reads the shell files (`.sh`) under its `roots` as well, with the same budget and the same failure line. A shell block is a run of `#` lines, each alone on its line; a `#` opens a comment only where it starts a word of code, so a quote, a `${…}`, an arithmetic `((…))`, a heredoc body and the shebang on line 1 hold none. A repository with a long `#` block under its `roots` fails the Gate from this release on.
