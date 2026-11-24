---
"dw-sdlc": minor
---

Add `dw-sdlc gate --mark`, which leaves a Gate mark when the Gate passes on a clean tree whose HEAD is the pushed head of its pull request: the commit status `dw-sdlc/gate`, or under footprint local a record in `.git/dw-sdlc/gates/<n>.json`. `pr ship` treats CI unavailable as GitHub running no job on the head: a GitHub Actions job that failed with no step run, as under a billing lock, a job that never started within the budget, or no check past the grace. With `gate.steps`, CI unavailable answers `act prove-locally`, and a Gate mark on the head stands in for that CI. Without them it parks `ci-unavailable` with the merge command for the dev.
