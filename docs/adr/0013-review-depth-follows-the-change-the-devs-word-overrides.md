---
status: accepted
---

# A Review's depth follows the change, and the dev's word overrides it

Under `pr.merge: auto` the Review is the one reading a change gets before the Ship script merges it,
and a full Review, two subagents that each explore the repository, costs much the same on an
eleven-line dependency bump as on a feature: Foundation #113, +11/−6, took 36 subagent turns. So the
`review` Action carries a Review depth. `full` runs the repository's review command, which
`pr.reviewCommand` names and the local layer may change; `light` runs one `sdlc-reviewer` subagent at
medium effort over the diff and the files it touches; `off` has the script post `dw-sdlc/review`
itself, its description naming why. `pr.review` sets a depth or `auto`, strictest first full, auto,
light, off; the local layer only tightens it and an invalid layer runs `full`. Under `auto` built-in
rules route the depth from the changes: lockfiles alone are off, a file under `.github/workflows/` or
more than 100 changed lines outside lockfiles is full, the rest light. After a push the depth is
routed on the changes since the last reviewed head, an empty delta carries that head's status, and a
clean Review earlier in the same conversation pins the head without a second one. The dev's word in
the conversation, passed as `--review <depth>`, overrides the config for that call either way. The
agent may raise a depth `auto` routed, never lower it, and never raises one the dev or the config set.
Another author's pull request parks for the dev before any Review. The permission mode never sets
the depth.

## Consequences

A pull request can merge under `auto` with no one reading it, when the dev says `off` or the rules
route `off`; the commit status says which. Small pushes each routed `light` can add up to a pull
request no full Review read whole. The agent judging the depth alone, a per-repository off switch
with no middle depth, and the permission mode as the switch are the rejected shapes: the first is
not repeatable, the second spends a full Review on a bump, and no documented way lets a command read
the mode, which says what the agent may do unasked, not how much a change matters. A change that
breaks `main` after a `light` or `off` Review is the signal to reopen the rules.
