---
"dw-sdlc": patch
---

`dw-sdlc references setup` writes the Router's block in the shape oxfmt leaves it in: a blank line after the start marker and before the end marker, each `when` trimmed, and each column padded to its widest cell, the delimiter row's dashes included. A cell's width counts two columns for an emoji or an East Asian wide character and one for any other grapheme, which matches oxfmt on Latin text, CJK, Hangul and emoji. A Gate that runs oxfmt passes on the Router the setup writes after such a `when` changes. A `when` in a script with combining signs, such as Devanagari, or holding a rarer wide character, still gets its table padded again by the formatter.
