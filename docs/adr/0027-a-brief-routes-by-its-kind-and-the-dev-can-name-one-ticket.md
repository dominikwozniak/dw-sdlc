---
status: accepted
---

# A Brief routes by its kind from a fuller table, and the dev can name a model for one ticket

A Worker's model and effort follow the kind of its Brief, never the size of the change. The table in
`templates/brief.md`, section Model and effort, has eight rows:

| the Brief's kind                                                    | model          | effort          |
| ------------------------------------------------------------------- | -------------- | --------------- |
| mechanical, its proof a command: translation keys, a bump, a rename | `sonnet`       | `medium`        |
| a clear spec with an existing pattern to copy                       | `sonnet`       | `medium`        |
| a clear spec                                                        | `worker.model` | `worker.effort` |
| read-only, across many files or repositories, no decisions          | `opus`         | `medium`        |
| decisions, design or unclear code                                   | `opus`         | `high`          |
| a grilling                                                          | `opus`         | `high`          |
| risk: security, payments, a data migration                          | `opus`         | `xhigh`         |
| the dev named a model or an effort                                  | as they said   | as they said    |

`xhigh`, `max` and `fable` stay on the dev's word, with one exception: the risk row sets `xhigh` itself.
The risk row wins over every row above it. The Lead itself is never routed: it starts on the default
model of the dev, and the dev changes it in the session.

The dev names a model or an effort for one ticket of a delegation after its number:
`/sdlc-delegate #12 #13:opus/medium` runs #13 on `opus`, `medium` and #12 by the table. A model or an
effort with no number applies to every Worker, as before. The plan table of the Lead shows each ticket's
model and effort.

`haiku` stays out of the table. The mechanical row moves to `haiku`, `high` only after a trial on one real
mechanical ticket. `claude --model haiku` resolves to Haiku 5.5, which takes every effort level.

## Consequences

This supersedes the part of ADR 0021 that says a Lead runs every Worker on the one model it was given, and
that a follow-up the dev routes alone gets a Lead of its own. A Lead routes each Worker by its own ticket,
so one Lead takes every ticket of a delegation, and a Recap's "go, but 1 on fable" becomes
`/sdlc-delegate #<n> #<m>:fable` in the one Lead.

Rejected: a Lead of its own for each ticket the dev routes alone, which spends a session on what one
Lead already answers for; and a row picked by size, which sends a small change in a guard to the
cheapest model.
