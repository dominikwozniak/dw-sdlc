---
name: sdlc-recap
description: Tell the dev where this session stands, in one fixed shape, with whether it can be closed. Carrying this work on in a fresh session goes with /handoff. Invoke it only when the dev types /sdlc-recap, or when a Brief tells this session, as a Worker, to end with a Recap. A question in the dev's words, such as "co dalej?", "where are we?" or "can I close this?", gets a plain answer and never this skill.
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

Under the table, one line from `primitives` of the document, which names the Primitives the session's
branch changed, the guards, hooks, scripts, config keys and skills the repository's catalogue lists, one `<class> <id>` each as the document prints them, such as
`Primitives: extends gate.runner, adds gate.cache`. The ids and classes stay as printed. Write no line
when `primitives` is empty, as it is on the default branch and in a repository with no catalogue.

**Decisions without you.** Each choice the session made alone that the dev might have made differently,
one line each, with why. A routine call no one would question does not belong here.

**Questions.** Numbered, each with your recommended answer, so that the dev can reply in one line:
`1. Keep the old flag? Recommend: drop it, nothing reads it.`

**Waiting on.** What waits on whom: the dev, CI, a reviewer, another session. Each Worker the document
lists under `workers` is one, named with its status.

Then the close line: `close.line` from the document, translated into the conversation's language and
nothing added. Its reasons are facts; do not argue with them or soften them.

**Follow-ups.** Numbered across "This session" and "A new session", so that "2" names one. Each carries
one recommended disposition, the lightest that closes it:

- `now`: do it here. The default when it fits this session, since small things filed are small things lost.
- `issue`: file it, with a short description here and a Brief as its body.
- `worker`: a session of its own, with a short description here, filed with a Brief as its body and
  handed to a new Lead when it goes out.
- `drop`: not worth doing, and say why.

In the main checkout, when `worktree.linked` is false, read a dry run of the Sweep too, the command that
removes landed branches, clean worktrees, stale locks and finished Workers' terminals, and add the follow-up
below. In a linked worktree, list none: the Sweep refuses there, so a Worker never offers it.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" sweep --dry-run --json
```

Exit 0 and exit 1 both print a document, and its `removed` is what a Sweep would remove. It fetches
origin and changes nothing else. When `removed` is empty, list no follow-up. Otherwise list one, in "This
session", with the disposition `now`: a Sweep, `/sdlc-sweep`, counting the items of `removed` by `kind`,
such as "removes 3 branches, 2 worktrees and 1 terminal", a kind with none left out; a `lock` item is
lifted with its worktree and adds nothing to the count. A Worker's terminal a Sweep would stop is what the close
line's `workers` reason waits on: say that "go" clears it unless the Sweep keeps the worktree. On exit 2, list none and say in one line that
the Sweep could not be read, with its reason.

End this section with one line telling the dev that "go" carries out every recommendation, and that
"go, but 2 issue" changes one. When a follow-up is `worker`, add that "go" files it and starts one new
Lead for every `worker` follow-up and the next session, which carries them to the end. Outside herdr,
where `workers` is null, or in a linked worktree, say instead that "go" hands them its start line.

**Next session.** Write it only when `close.verdict` is `yes`, or your verdict is `done` or `park`, and
`next` in the document lists a candidate. Leave it out of a Recap a Brief asked for: a Worker's Lead names
what comes next. `next` holds the startable issues, the sub-issues of the issue this session's pull
request closes first. Pick one, since only you know the topic this session worked on, and write three
lines:

- the issue, linked, with its title;
- why it comes next, in one line;
- the start line: `/sdlc-delegate #<n>` in a new Lead session named `lead-<n>-<slug>`, the slug a word or
  two of its title, the whole name 1-32 of `a-z`, `0-9`, `-` and `_`.

End it with one line telling the dev that "go" starts that Lead in a herdr terminal of its own, and that
"go, but #<m>" starts another of `next` instead. Outside herdr, where `workers` is null, or in a linked
worktree, say instead that "go" hands them the start line, since the command refuses there.

## Then stop

The Recap changes nothing. Do not commit, push, file an issue or start anything in the same turn: the
dev has not seen it yet. Their "go" carries out every recommended disposition in order, with any change
they named; a question they did not answer stays open. A command the document names, such as deleting a
branch, stays theirs to run. The Sweep follow-up is the exception: "go" on it runs `/sdlc-sweep`, which
runs the Sweep and reports it.

The new Lead is the other: "go" starts it last, after every follow-up, as the new Lead in
`${CLAUDE_PLUGIN_ROOT}/templates/brief.md` says, and one Lead takes every ticket: the next session's
issue first, then the issue each `worker` follow-up was filed as. With neither, start none. Never start it
without the dev's go, and "go, but #<m>" puts #<m> in the next session's place, named the same way. Run,
from the repository, `#<m> ...` the follow-ups' issues:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" lead start --name lead-<n>-<slug> --prompt "/sdlc-delegate #<n> #<m> ..." --json
```

The Lead routes each Worker by the template. A model or an effort the dev names for one follow-up, as "go,
but 1 on fable", goes to a Lead of its own, `/sdlc-delegate #<m> fable`, named after `#<m>`.

An `issue` or a `worker` follow-up goes out as a Brief, written by the rules of the template, so that a
session started from either has one shape. Each is filed with the Brief as its body, the way the template
says for an issue, and a `worker` goes on to the new Lead. Where this session cannot start a Lead, a
`worker` goes back to the dev as the template's start line, unfiled. The config the template asks for
comes from `node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" config`.

When a Brief tells you to deliver the Recap to a Lead, follow the Brief after writing it.
