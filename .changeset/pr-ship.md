---
"dw-sdlc": minor
---

`dw-sdlc pr ship [<n>] [-R owner/name] [--merge] [--dry-run] [--json] [--verbose]`, the Ship script, reads one pull request through `gh`, decides the Action it needs next and performs its own: it updates a branch behind its base, marks a draft ready and squash merges a ready pull request with `--match-head-commit`. It answers the first Action that is not its own as one line, or one document with `--json`, and exits 0 done, 10 the agent's turn, 20 wait, 30 the dev's turn, 2 when it cannot run. `pr.merge` in `.ai/agentic.config.json` says who merges: the script under `auto`, the dev under `ask`, the default, and the script for one call under `--merge`; a local layer may tighten it and never loosen it. `dw-sdlc pr reviewed <n> --head <sha>` pins a clean review to the head it read as the commit status `dw-sdlc/review` in state `success`, and posts nothing once a push moved the head.
