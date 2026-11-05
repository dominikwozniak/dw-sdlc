---
"dw-sdlc": minor
---

`pr.review` and `pr ship --review` take `light`, between `full` and `off`: the `review` answer carries `depth: light`, and the plugin's `sdlc-pr-ship` meets it with one `sdlc-reviewer` subagent at medium effort over the diff, the files it touches and the Agent map. Strictest first: full, light, off; a local `light` tightens `off` and loosens `full`.
