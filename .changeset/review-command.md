---
"dw-sdlc": minor
---

`pr.reviewCommand` in `.ai/agentic.config.json` names the slash command a `full` Review runs, `/code-review` by default. It is a non-empty string with no strictness order, so the local layer sets it freely, to `/pr-review-toolkit:review-pr code errors` for instance. While a layer is invalid it keeps what the valid layers name. `dw-sdlc pr ship` carries it as `details.reviewCommand` on a `full` `act review` answer.
