---
"dw-sdlc": patch
---

The `sdlc-sessions` plugin adds `/sdlc-brief`, which turns an issue, a spec, a follow-up or an idea into a Brief, and `templates/brief.md`, the one Brief template its skills read. `/sdlc-recap` sends its `issue` and `worker` follow-ups out through that template. The `sdlc` plugin's `/sdlc-pr-ship` may be started by a Worker whose Brief tells it to; `pr.merge` still decides the merge. The package's code does not change.
