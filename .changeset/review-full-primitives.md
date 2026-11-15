---
"dw-sdlc": minor
---

Add the `pr.reviewFull` key: a list of Primitive ids from the catalogue. Under `pr.review: auto`, a change to the code of a listed Primitive routes a `full` Review whatever its size. The dev's `--review` and a fixed `pr.review` still stand. The key fails closed to `full` when the catalogue is missing or lacks a listed id, the local layer adds ids and never removes one, and the `primitives` Check reports an id the catalogue lacks. No ids ship by default.
