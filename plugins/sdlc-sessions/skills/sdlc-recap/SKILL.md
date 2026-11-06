---
name: sdlc-recap
description: Tell the dev where this session stands, in one fixed shape, with whether it can be closed. Invoke it only when the dev types /sdlc-recap, or when a Brief tells this session, as a Worker, to end with a Recap. A question in the dev's words, such as "co dalej?", "where are we?" or "can I close this?", gets a plain answer and never this skill.
---

# sdlc-recap

A Recap is for a dev who did not follow this session. They read it instead of asking five questions,
so it stays short, fixed in shape and true.

## Read the facts first

From the repository, run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" recap --json
```

Exit 0 means the session can be closed, 1 that it cannot. Both print a document. Exit 2 means it cannot
run: say what it printed in one line, and write the rest of the Recap without a close line, saying the
state of the tree and the pull request is unverified.

Check every "merged" or "green" you write live with `gh`, for each pull request the session touched,
not only the current branch's: `gh pr view <n> --json state,mergedAt,statusCheckRollup`. Your memory of
a pull request is older than the pull request. Word what you could not check as unchecked, and that
includes the branch's pull request when `askedGh` is false.

## The shape

Write it in the language of the conversation. The words `done`, `act`, `wait` and `park` stay as they
are, and so does the `gh` output you quote.

Write a section only when it has content, in this order. A quiet session gives a short Recap, so a
section or a subheading with nothing under it, or one saying "none", is noise: leave it out. Each section
below opens with its heading, translated; the close line stands alone, with no heading.

The first line is the verdict: one Action word and one sentence, with no heading above it.

- `done`: the session's work is finished and nothing is left to do.
- `act`: the next Action is this session's to take.
- `wait`: something outside the session is running, and the session resumes on it.
- `park`: it stops here until the dev answers or does something.

When the session has a pull request, its `status` under `pullRequest` tells you the verdict for that
work. A merged pull request with open questions is still `park`: the verdict is about the session.

**What happened.** A table of outcomes, one row each, with the link to its pull request or issue. Say
what changed for the dev, never the tool calls or the files: links carry the detail.

| outcome                           | link |
| --------------------------------- | ---- |
| `dw-sdlc recap` answers the close | #222 |

**Decisions without you.** Each choice the session made alone that the dev might have made differently,
one line each, with why. A routine call no one would question does not belong here.

**Questions.** Numbered, each with your recommended answer, so that the dev can reply in one line:
`1. Keep the old flag? Recommend: drop it, nothing reads it.`

**Waiting on.** What waits on whom: the dev, CI, a reviewer, another session.

Then the close line: `close.line` from the document, translated into the conversation's language and
nothing added. Its reasons are facts; do not argue with them or soften them.

**Follow-ups.** Numbered across "This session" and "A new session", so that "2" names one. Each carries
one recommended disposition, the lightest that closes it:

- `now`: do it here. The default when it fits this session, since small things filed are small things lost.
- `issue`: file it, with a short description.
- `worker`: a session of its own, with a short description.
- `drop`: not worth doing, and say why.

End this section with one line telling the dev that "go" carries out every recommendation, and that
"go, but 2 issue" changes one. When a follow-up is `worker`, add that "go" hands it to them as its
description, for them to start.

## Then stop

The Recap changes nothing. Do not commit, push, file an issue or start anything in the same turn: the
dev has not seen it yet. Their "go" carries out every recommended disposition in order, with any change
they named; a question they did not answer stays open. This skill starts no session, so a `worker` goes
back to the dev as its description, for them to start. A command the document names, such as deleting a
branch, stays theirs to run.

When a Brief tells you to deliver the Recap to a Lead, follow the Brief after writing it.
