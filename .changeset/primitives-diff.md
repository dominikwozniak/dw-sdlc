---
"dw-sdlc": minor
---

`dw-sdlc primitives --diff <base>` names the Primitives a change removes, adds or extends, as a markdown block for a pull request body or as `--json` with each Primitive's summary and docs. `dw-sdlc recap --json` carries the Primitives of the session's branch. The `primitives` Check fails an id that does not start with its group and a `.` or a `-`, and a `docs` entry that names a superseded or deprecated decision record.
