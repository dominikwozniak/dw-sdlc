---
"dw-sdlc": minor
---

`dw-sdlc pr ship` counts the read marks on the pull request's last 100 commits after the last review success of any kind, and at 3 or more with no success on the head answers `park review-limit`, actor `dev`, in the place of `act review`, under `--dry-run` too and at `full` and `light` alike. Its command is `dw-sdlc pr reviewed <n> -R <owner/name> --head <head> --accept`. The dev's `--review <depth>` answers `act review` past the limit, for that call only. `dw-sdlc pr reviewed --accept` posts `dw-sdlc/review` in state success, described "accepted by the dev, findings open"; with `--findings` it exits 2. The state `--verbose` adds under `facts` carries the count as `marks`.
