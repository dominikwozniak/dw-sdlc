---
"dw-sdlc": patch
---

`dw-sdlc pr ship`: a reviewed draft of the viewer is marked ready even when no check has reported on its head. A draft starts no run, so the head waited on a check that never came and parked as unverified; a pull request that is not a draft keeps the rule.
