---
status: accepted
---

# A session that starts work hands it to a new Lead: `/sdlc-kickoff` and a Recap start one

A session that kicks work off does not care for it. `/sdlc-kickoff` writes the work's Brief and, on the
dev's "start", runs `dw-sdlc lead start` with `/sdlc-delegate` and the work. A new Lead in a herdr
terminal of its own starts the Worker and stays with it to the end, so the session that kicked the work
off can close. A Recap does the same on the dev's "go". It files each `worker` follow-up as an issue,
with a Brief as its body, and starts one Lead for all of them and the next session, the next session's
issue first. The skill is a kickoff, and the thing it writes is a Brief. A Brief is what a Worker
starts from, whoever writes it: delegate, a Recap or the kickoff, all from `templates/brief.md`.

The new Lead, and not the session that kicked the work off, cares for the work for two reasons. A
session that kicks work off is often near its end, with a full context, and as a Lead it would grow on.
It would also have to stay open until the Worker's pull request merged. A Lead in herdr is already how
the next session starts from a Recap, so the kickoff and the Recap share one path,
`templates/brief.md#the-new-lead`.

## Consequences

The kickoff has three ways out: `start`, a new Lead; `issue`, filed for later; `line`, the start line,
which is the way outside herdr and in a linked worktree, where `lead start` refuses. No way pastes a
Brief into a running Lead: a new Lead takes that role, and the dev pastes into a Lead by hand. Work with
nothing filed is filed before its Lead starts, so a Lead always reads its tickets as issues. One Worker
costs two sessions, the Lead and the Worker. The Lead routes each Worker by the template; a model or an
effort the dev names follows the tickets.

The skill keeps `disable-model-invocation`, since it starts sessions, and only the dev's word does that.
A Recap starts the Lead itself and calls no skill. The template's first line, the `/implement #<n>` a
Worker starts with, is the implement line, so that "kickoff" names only the skill.

Three shapes were rejected. Dropping the skill and leaving a Brief to delegate and the Recap would
leave the dev no way to kick off one piece of work on demand. Having this session start the Worker and
act as its Lead would keep a closing session open. One Lead for each follow-up would spend sessions on
what one Lead already answers for.
