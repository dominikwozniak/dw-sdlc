---
status: accepted
---

# The Ship script waits under --wait, and the skill runs it once in the background

A `wait` from the Ship script ends the turn, and something has to start the next call. ADR 0020 had the
skill wait itself, `gh pr checks <n> --watch --fail-fast` at `ci-pending` and `sleep <recheckAfter>` at
any other reason, and had a Worker hand the wait to the Lead. That put the wait outside the script's
limits, in the skill's own words, and left a Worker needing a Lead to wake it.

`pr ship --wait` waits inside the script. It polls every `recheckAfter` and prints nothing until it
returns one document, the first answer that is not `wait`. Its limit is the 40 min CI budget: a
`ci-pending` wait is one wake-up, and past the budget the answer is `park ci-stuck`. At its limit it
returns `wait` again, with the same step, the same call with `--wait --json`. The skill runs that call
once with the Bash tool's `run_in_background` and ends its turn, and a Worker from a Brief runs it too.
The dev's condition was tokens: a background run makes no model call, and each exit is one turn.

The script stays the only loop and holds every limit. When `DW_SDLC_NOW` is set, `--wait` does not
sleep: each poll moves its own clock on by `recheckAfter`, so a test reads the one document with no
new environment variable.

## Considered Options

- Keep the wait in the skill, as ADR 0020 has it. Rejected: `gh pr checks --watch` and `sleep` sit
  outside the script's budget and its limits, and a Worker cannot run them without a Lead.
- Poll with `/loop`. Rejected: no one starts it, and each recheck is a model turn.
- A foreground wait. Rejected: it blocks the session, the second loop #165 ruled out.

## Consequences

A wait costs one model turn however long CI runs, up to the budget. A session closed mid-wait loses
nothing: the next call reads the pull request afresh. Under `/loop`, when another skill calls the
skill, and on the dev's "don't wait for CI", the skill starts no wait and ends its turn on the
`reason` and `recheckAfter`. The skill's own words follow in their own change. This record supersedes
ADR 0020.
