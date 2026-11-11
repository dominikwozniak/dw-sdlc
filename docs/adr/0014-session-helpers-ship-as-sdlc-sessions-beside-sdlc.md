---
status: proposed
---

# The session helpers ship as their own plugin, `sdlc-sessions`, that depends on `sdlc`

This marketplace publishes `sdlc-sessions@dw-sdlc` beside `sdlc`. It carries the skills the dev starts
to run sessions. `sdlc-recap` answers "where do we stand" with a Recap. `sdlc-brief` turns an issue, a
spec, a follow-up or an idea into a Brief. `sdlc-delegate` has a Lead hand Briefs to Workers and gather
their Recaps; the Workers run in terminals of herdr, the terminal manager the dev runs sessions in,
through its CLI `hc`. What needs no judgement lives in the `dw-sdlc` package, which the plugin links to
as `sdlc` does (ADR 0008), the way the Ship script decides a pull request's Action. `dw-sdlc recap`
reads the facts a Recap rests on and whether the session can be closed. `dw-sdlc worker start`, `ls`
and `report` start a Worker, list a Lead's Workers and deliver a Worker's Recap, retrying while the
Lead is blocked. `dw-sdlc lead start` starts the session after this one as a Lead in the main checkout,
on the same command, and `worker/launch.ts` holds the start it and `worker start` share. The config's `worker` key names the command a Worker starts with, its model and its
effort. The command belongs to one machine, so `sdlc-setup` writes it into the local layer. Like
`pr.reviewCommand`, the key has no strictness order (ADR 0003): the guards keep a Worker safe, not its
command. The helpers are not part of `sdlc`. That plugin keeps every tool call safe on every machine;
these are work the dev starts, and `sdlc-delegate` needs `hc`, which a machine that wants only the
guards has no reason to install. They are not the Loop of ADR 0012 either: the Loop moves one change
to merged, and the helpers run the sessions that do it. `sdlc-sessions` lists `sdlc` under
`dependencies`, so a Worker that starts with permission prompts bypassed still runs behind the guards.

## Consequences

Delegation runs only in a herdr terminal; the Recap and the Brief run anywhere. `sdlc-doctor` stays the
one doctor and reports `sdlc-sessions`, its copy of the package and `hc`. A roadmap page or another
artifact helper joins only when it helps run a session. Three shapes were rejected. More skills in
`sdlc` would tie herdr to the guards. A personal skills directory has no package, tests or config
behind it. Delegation written as prose alone failed in the dev's first Leads (#220): reports were lost
for hours behind an open question, and Workers started on the wrong account.
