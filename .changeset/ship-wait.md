---
"dw-sdlc": minor
---

`pr ship --wait` waits inside the script. It polls every `recheckAfter` and prints nothing until it returns one document, the first answer that is not `wait`, so a wait costs one model turn. Its limit is the 40 min CI budget: a `ci-pending` wait past the budget answers `park ci-stuck`, and at its limit `--wait` answers `wait` again with the same step, the same call with `--wait --json`. When `DW_SDLC_NOW` is set, `--wait` does not sleep: each poll moves its own clock on by `recheckAfter`.
