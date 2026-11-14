---
"dw-sdlc": patch
---

- A local layer that sets `guardrails.filteredOutput` to `allow` over a committed or default `deny` loosens it, so the layer is invalid as for every other guardrail; the resolved config shows `filteredOutput`, `deny` by default and in the strictest set.
