---
status: accepted
---

# The Ship skill waits in the background, and the script bounds the wait

A `wait` from the Ship script ended the turn with the next `/sdlc-pr-ship` for the dev to type, or a
`/loop` to start. CI took a minute and a half at the median, the dev came back after three minutes to
an hour and a half, and no one started `/loop`. So when the dev invokes `/sdlc-pr-ship`, the skill
starts one background wait through the Bash tool's `run_in_background` and ends the turn: at
`ci-pending`, `gh pr checks <n> --watch --fail-fast`, which ends when CI does; at any other reason,
`sleep <recheckAfter>`. Its exit wakes the session, and the skill calls the script again. The script
stays the only loop and holds every limit, `ci-stuck` and `unverified` among them, so the wait carries
no counter or timeout of its own. Under `/loop`, from a Brief, or called by another skill, the skill
starts no wait and ends the turn on the `reason`, since the loop or the Lead already wakes it.

## Consequences

A dev-invoked run ends only at a `park`, a `done`, an exit 2, a refused guard or the reviewer's turn,
so its answer names no `Next:` for a `wait`. The session's background job holds no state the script
needs: a session closed mid-wait loses nothing, and the next `/sdlc-pr-ship` reads the pull request
afresh. A Worker waits the Lead's way until the Brief says otherwise. Two shapes were rejected. A
`sleep` in the foreground blocks the session and is the second loop #165 ruled out. A wait of
`recheckAfter` for CI too wakes the session every minute, up to forty turns on one run.
