---
"dw-sdlc": minor
---

Add the `footprint` key, `github` by default or `local`, which any layer may set. Under `local` the Ship script, `pr reviewed` and `recap` post and read no `dw-sdlc/review` status: the Review state of pull request `<n>` is `.git/dw-sdlc/reviews/<n>.json` under the common git dir, a map of head to `clean`, `findings`, `off` or `accepted`, and every decision is the one the statuses would give. `pr reviewed --off` records a head no one read, the command `pr ship --dry-run` names for it under `local`. The doctor's `config` line names the footprint.
