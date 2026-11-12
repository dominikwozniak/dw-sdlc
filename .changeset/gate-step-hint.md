---
"dw-sdlc": minor
---

A Step of `gate.steps` is a command string or `{ "command": "…", "hint": "…" }`, and a `gate.checks.run` entry takes a `hint` beside `name` and `command`. When the Step or script fails, the Gate prints `hint: <text>` under its failure line. The Gate's `--json` carries `hint` on every Step and Check report, `null` where there is none.
