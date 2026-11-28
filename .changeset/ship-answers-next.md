---
"dw-sdlc": minor
---

Every answer of `pr ship --json` carries `next`, the ordered steps the agent follows without guessing the next command, and each blocker carries its own `next`, so one push answers every blocker. A step is `{ by, run }`, an exact command, or `{ by, do }`, one line of judgement carried out on `details`; `by` says whether the agent or the dev takes it, and the agent prints the dev's and never runs them. `command` is gone from the answer: the dev's command is a `by: "dev"` step, and a park with nothing for the dev to run has an empty `next`. Each thread under `details.threads` at `address-review` carries a `resolve` and a `reply` command, `<text>` the reply's only blank. At `wait`, `next` is the same call with `--wait --json`. The plain line is the label and the reason, the recheck, then each step in order, marked agent or dev. Exit 2 keeps `{ error, remedy, performed }` and has no `next`.
