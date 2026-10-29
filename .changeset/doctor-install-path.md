---
"dw-sdlc": patch
---

`dw-sdlc doctor` names a snapshot install's path only when `claude plugin list --json` gives it as a string; any other value reads `installed at ?`, as an unknown version reads `?`.
