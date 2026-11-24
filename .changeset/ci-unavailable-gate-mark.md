---
"dw-sdlc": minor
---

Add `pr.ciUnavailable`, default `ci`, and `dw-sdlc gate --mark`. CI unavailable is a GitHub Actions job that failed with no step run, as GitHub leaves it under a billing lock. Under the default `ci` it fails as any check does, so nothing changes. Under `gate`, a head with such a job answers `act prove-locally` with `gate.steps`, or parks `ci-unavailable` with the merge command without them. A Gate mark on the head then stands in for the job. `gate --mark` leaves that mark when the Gate passes on a clean tree whose HEAD is the pushed head of its pull request: the commit status `dw-sdlc/gate`, or under footprint local a record in `.git/dw-sdlc/gates/<n>.json`.
