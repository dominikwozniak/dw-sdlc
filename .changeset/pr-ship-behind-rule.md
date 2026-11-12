---
"dw-sdlc": patch
---

`dw-sdlc pr ship` updates a branch from its base only when GitHub reports it `BEHIND`, under a rule that a branch be up to date. A branch only behind its base merges as it is, one CI run fewer, and the read makes no compare to judge it behind.
