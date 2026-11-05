---
status: proposed
---

# The session helpers ship as a third plugin, `sdlc-sessions`, that depends on `sdlc`

This marketplace publishes `sdlc-sessions@dw-sdlc` beside `sdlc`. It carries the skills the dev starts
to run sessions: `sdlc-recap` answers "where do we stand" with a Recap, `sdlc-brief` turns an issue, a
spec, a follow-up or an idea into a Brief, and `sdlc-delegate` has a Lead hand Briefs to Workers in
herdr terminals and gather their Recaps. What needs no judgement lives in the `dw-sdlc` package, as
the Ship script does for a pull request (ADR 0008): `dw-sdlc recap` reads the facts a Recap and its
close verdict rest on, and `dw-sdlc worker start`, `ls` and `report` start a Worker, list a Lead's
Workers and deliver a Worker's Recap, retrying while the Lead is blocked. The config's `worker` key
names the command a Worker starts with, its model and its effort; the command belongs to one machine
and sits in the local layer. The helpers are not `sdlc`: that plugin keeps every tool call safe on
every machine, while these are work the dev starts, and `sdlc-delegate` needs herdr's `hc`, which a
machine that wants only the guards has no reason to install. They are not `sdlc-loop` (ADR 0012)
either: the Loop moves one Change to merged, and the helpers run the sessions that do it.
`sdlc-sessions` lists `sdlc` under `dependencies`, so a Worker that starts with permission prompts
bypassed still runs behind the guards.

## Consequences

Delegation runs only in a herdr terminal; the Recap and the Brief run anywhere. `sdlc-doctor` stays the
one doctor and reports `sdlc-sessions`, its copy of the package and `hc`. A roadmap page or another
artifact helper joins only when it helps run a session. The rejected shapes are a fourth skill in
`sdlc`, which ties herdr to the guards, a personal skills directory, which has no package, tests or
config behind it, and delegation written as prose alone: the dev's own Leads lost reports for hours
behind an open question, and their Workers started on the wrong account, when the launch and the
report lived in a prompt.
