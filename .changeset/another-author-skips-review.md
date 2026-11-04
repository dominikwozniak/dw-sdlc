---
"dw-sdlc": minor
---

`dw-sdlc pr ship` never asks the agent to review a pull request another author opened, such as a Dependabot bump or a version pull request, since the dev merges it. Its conflicts, failing CI, open threads, draft and required approval each answer their own Action. Once none holds it back, it parks as `ready-to-merge` with the merge command, with or without a `dw-sdlc/review` success on its head. The viewer's own pull request answers `act review` until its head carries one.
