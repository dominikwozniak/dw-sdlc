---
"dw-sdlc": patch
---

`dw-sdlc references setup` writes the Router's block as oxfmt leaves it: a blank line after the start marker and before the end marker, and each column padded to its widest cell, the delimiter row's dashes included. A cell's width counts the columns oxfmt draws: two for an emoji or an East Asian wide character, one for any other grapheme. A Gate that runs oxfmt passes on the Router the setup writes after a `when` changes.
