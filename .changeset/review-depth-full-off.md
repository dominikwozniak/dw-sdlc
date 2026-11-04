---
"dw-sdlc": minor
---

`pr.review` sets the Review depth of a head no one has reviewed, `full` or `off`, and `pr ship --review full|off` overrides it for one call. The `review` answer names the depth and its source under `details`; under `off` the Ship script posts the `dw-sdlc/review` success itself, its description saying why. A local layer may tighten `pr.review` and never loosen it, and an invalid layer runs `full`.
