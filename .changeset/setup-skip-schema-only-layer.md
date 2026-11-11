---
"dw-sdlc": patch
---

`dw-sdlc setup` writes no local config layer that would hold only `$schema`, and prints `skipped` for it. A layer that exists stays as it is. A pin flag, an unset `packageManagers.node` in the committed config or `cswap` on PATH still gets the layer written.
