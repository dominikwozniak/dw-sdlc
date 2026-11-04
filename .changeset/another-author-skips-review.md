---
"dw-sdlc": minor
---

`dw-sdlc pr ship` never asks the agent to review a pull request another author opened, such as a Dependabot bump or a version pull request, since the dev merges it. Every other row of the decision holds for it, conflicts and failing CI first. Once nothing holds it back, it parks as `ready-to-merge` with the merge command, with or without a `dw-sdlc/review` success on its head. The viewer's own pull request answers `act review` until its head carries one.

The script marks only the viewer's own draft ready. Another author's draft parks for the dev as `awaiting-author`, with no command: marking it ready is the author's.
