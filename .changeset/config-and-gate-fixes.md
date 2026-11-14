---
"dw-sdlc": patch
---

- A local layer that sets `guardrails.filteredOutput` to `allow` over a committed or default `deny` loosens it, so the layer is invalid as for every other guardrail; the resolved config shows `filteredOutput`, `deny` by default and in the strictest set.
- While a config layer is invalid and no valid layer sets a commit convention, pattern or trailer, `dw-sdlc config`, the session-start report and the doctor say the commit rules are off until the layer is fixed, beside the strictest defaults the guards run on.
- `dw-sdlc gate` runs each Step and run script in a process group of its own and passes SIGINT, SIGTERM and SIGHUP to that whole group, so no process a Step started outlives the Gate; a second signal kills the group as it ends the Gate.
- Every command that takes `--root` (`gate`, `check`, `primitives`, `config`, `doctor`, `setup` and `references setup`) stops with exit 2 when it names no directory, instead of judging the empty repository a typo leaves: `gate` read green there and `setup` wrote into it.
