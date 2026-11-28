---
"dw-sdlc": minor
---

`pr ship --without-ci` carries the dev's word "merge without CI" for one call. A Gate mark on the head stands in for CI, whatever CI says; without one the answer is `act prove-locally` with `dw-sdlc gate --mark` as its step, CI unavailable included, with `gate.steps` or without. It moves aside the CI rows only, `fix-ci`, `unverified`, `ci-pending`, `ci-stuck` and `ci-limit`: conflicts, threads, changes requested, a required approval, a draft and another author's pull request block under it too. It does not imply `--merge`. Every merge it runs or names for the dev is `gh pr merge <n> --admin --squash --match-head-commit <head>`, and a merge GitHub refuses parks `ready-to-merge` with that command as the dev's step. Without `--without-ci` no merge carries `--admin`.
