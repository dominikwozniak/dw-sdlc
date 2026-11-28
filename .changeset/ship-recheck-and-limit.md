---
"dw-sdlc": minor
---

`pr ship` waits on CI about as long as CI takes in the repository: a `ci-pending` wait's `recheckAfter` is the median time CI took on the heads of the 10 newest merged pull requests, less the time since the first start on this head, between 60 and 600 s, and 60 s when no merged head shows a run. At the review limit, a fix since the last read mark that changes a test file gets one `light` Review, `details.source` `limit`, once the Gate is green on the head, by CI or a Gate mark; the script waits while CI runs and parks only when that Review leaves a Finding open or the Gate can no longer turn green.
