---
"dw-sdlc": patch
---

`dw-sdlc recap` counts a remote out of reach as holding nothing, so it exits with the close verdict instead of 2, and that remote can turn the verdict to no and never to yes.
