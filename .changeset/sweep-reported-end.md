---
"dw-sdlc": minor
---

The Sweep stops a Worker only once it has reported its end. `worker report` reads the first word of the Recap it delivers and, when it is `done`, `act`, `wait` or `park`, sets the label `dw-sdlc.verdict=<word>` on the Worker's own terminal; a first word that is no verdict sets none, and a refused label exits 1 with the Recap delivered. The Sweep reads that label with `hc get` and stops a Worker with a verdict of `done` or `park`. A Worker whose turn ended with no report, such as on a round of a grilling or at a wait, is kept like one at work, with its terminal and worktree, and the Sweep names it as "its end not reported".
