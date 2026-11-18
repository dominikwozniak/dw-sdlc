---
status: accepted
---

# A Brief routes by its kind from a fuller table, and the dev can name a model for one ticket

A Worker's model and effort follow the kind of its Brief, never the size of the change. The table in
`templates/brief.md`, section Model and effort, is the one place its eight rows live: mechanical work, a
clear spec with a pattern to copy, a clear spec, read-only work, decisions, a grilling, risk and the dev's
word. Risk is the one row that sets `xhigh` itself; `xhigh`, `max` and `fable` are otherwise the dev's word.
The Lead itself is never routed: it starts on the default model of the dev, and the dev changes it in the
session.

The dev names a model or an effort for one ticket after its number: `/sdlc-delegate #12 #13:opus/medium`
runs #13 on `opus`, `medium` and #12 by the table. A model or an effort with no number applies to every
Worker. A word after a ticket wins over a word with no number. The Lead's plan table shows each ticket's
model and effort.

`haiku` is not in the table. The mechanical row takes `haiku`, `high` only after a trial on one real
mechanical ticket, filed apart.

## Consequences

This supersedes one claim of ADR 0021, Consequences: that a Lead runs every Worker on the one model it was
given, so that a follow-up the dev routes alone needs a Lead of its own. A Lead routes each Worker by its
own ticket, so one Lead takes every ticket of a delegation, and a Recap's "go, but 1 on fable" is
`/sdlc-delegate #<n> #<m>:fable` in the one Lead.

Rejected: a Lead of its own for each ticket the dev routes alone, which spends a session on what one
Lead already answers for; and a row picked by size, which sends a small change in a guard to the
cheapest model.
