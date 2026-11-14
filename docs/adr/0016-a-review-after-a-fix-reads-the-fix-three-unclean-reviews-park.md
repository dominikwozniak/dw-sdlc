---
status: accepted
---

# A Review after a fix reads the fix, and three unclean Reviews park the pull request

A Review that is not clean sent the agent back to the whole pull request from its base after each fix:
the Review command reads the whole diff afresh each time and always finds something, and
byarcadia-app/grateful-me-content#100, +1954/−229, ran 16 full Reviews in one day without one clean.
So a Review holds the merge only on a Finding: a concrete harm the pull request's own changes cause, a
miss against the spec, or a bug fix without its regression test. The agent declines the rest, smells,
naming and style rules among them, each with a line in the Recap; a harm the change neither makes nor
reaches goes to the Recap's follow-ups. A Review that is not clean is still pinned to the head it read:
`pr reviewed` posts `dw-sdlc/review` on it in state failure, "read, findings open". The Ship script
reads the changes since the last head any Review read, so the Review after a fix reads the fix alone,
at the depth `auto` routes on it (ADR 0013), and its prompt names the Findings that fix answers: it
checks each one is fixed and that the fix breaks nothing. When a merge of the base came after that head, the
script names in `details.paths` the files whose own change moved, routes on those alone, and the
Review reads only them, so the base's changes never pass for the fix. Three Reviews without a success between them
park the pull request for the dev. The park's command, the dev's to run, posts success as "accepted by
the dev, findings open"; the dev's `--review <depth>` buys one Review past the limit. A success starts
the count again. The rule holds at `full` and at `light` alike.

## Consequences

Only the first Review reads the whole pull request. A bug a fresh full read would find in code the
first one passed stays in: #100's tenth and eleventh Reviews found two. A pull request that merges
with a Finding open says so in its status. Four shapes were rejected. A full read after each fix has
no end. A closing full Review after the fix Reviews is the same loop one step later. The agent
posting success at the limit lets a Finding through unseen. The read head kept in the conversation
alone leaves the script routing the whole pull request `full`, which the agent may not lower, and a
new session starts over from the base.
