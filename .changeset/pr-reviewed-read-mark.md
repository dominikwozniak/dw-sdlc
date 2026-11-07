---
"dw-sdlc": minor
---

`dw-sdlc pr reviewed --findings` posts `dw-sdlc/review` in state failure, described "read, findings open", on the head a Review read when it left a Finding open: the read mark. `dw-sdlc pr ship` takes the last commit before the head with a review success not under off or a read mark as `details.since`, and routes `pr.review: auto` on the changes from it, so the Review after a fix reads the fix alone. Only a success carries over a head that only merged the base in; a read mark never does. The state `--verbose` adds under `facts` names that commit `lastRead`.
