---
"dw-sdlc": patch
---

`dw-sdlc pr ship` records an Action under `performed` as `ok` when the read after it shows the Action took effect, whatever gh's exit status, and keeps gh's `exit` and `stderr` beside `ok`.
