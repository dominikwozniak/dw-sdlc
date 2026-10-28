---
"dw-sdlc": minor
---

`comment-budget` reads the JavaScript, TypeScript and shell (`.sh`) files under its `roots`, with one budget and one failure line for all three. A shell block is a run of `#` lines, each alone on its line. A `#` opens a comment only where it starts a word of code, so a quote, a `${…}`, an arithmetic `((…))`, a heredoc body and the shebang on line 1 hold none. A shell block over the budget fails the Gate, as a JavaScript one does.
