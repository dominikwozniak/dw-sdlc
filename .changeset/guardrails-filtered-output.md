---
"dw-sdlc": minor
---

The config schema takes `guardrails.filteredOutput`, `"deny"` (the default) or `"allow"`. `deny` refuses a check command whose output a pipe feeds to `head`, `tail`, `grep`, `sed`, `awk`, `less` or `more`; `allow` turns that guard off.
