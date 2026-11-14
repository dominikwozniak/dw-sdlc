---
"dw-sdlc": patch
---

- A local layer that sets `guardrails.filteredOutput` to `allow` over a committed or default `deny` loosens it, so the layer is invalid as for every other guardrail; the resolved config shows `filteredOutput`, `deny` by default and in the strictest set.
- While a config layer is invalid and no valid layer sets a commit convention, pattern or trailer, `dw-sdlc config`, the session-start report and the doctor say the commit rules are off until the layer is fixed, beside the strictest defaults the guards run on.
