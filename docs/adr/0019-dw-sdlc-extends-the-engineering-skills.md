---
status: accepted
---

# dw-sdlc extends the engineering skills and replaces none

The engineering skills, `mattpocock/skills` here, plan, build and review the work: `wayfinder`,
`grilling`, `to-spec`, `to-tickets`, `implement`, `tdd`, `code-review`, `handoff`. dw-sdlc holds that
workflow where it is loose, and stays out of what it already does. It carries the guards on every
tool call, the Gate, the Review loop and the Ship script, the pull-request and Sweep skills, and the
session skills around a Brief, a Recap and a Lead. Today it carries no planner, implementer or `full`
reviewer of its own: a Brief starts with `/implement`, a `full` Review runs the command
`pr.reviewCommand` names, `/code-review` by default, and `/sdlc-delegate` reads the sub-issues
`/to-tickets` cuts. A skill that overlaps one of the engineering skills says what it adds beside it,
as the Brief beside `triage`'s agent brief and the Recap beside `handoff` do. Shipping its own copy of
those skills was the alternative: one install, no outside dependency, and a second planner and
reviewer to keep in step with the first.

## Consequences

A repository without the engineering skills runs every part but those three calls, and the README
lists them as recommended, never required. `sdlc-reviewer`, the `light` Review, is the Ship script's
own read inside the loop dw-sdlc owns, not a replacement for `code-review`. A part of its own that
takes over one of those roles comes with a decision record that replaces this one.
