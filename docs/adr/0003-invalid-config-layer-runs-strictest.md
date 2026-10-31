---
status: accepted
---

# An invalid config layer is dropped whole and the guards run on the strictest set

A layer can be malformed, fail the schema, or, the local one, loosen a guardrail the committed file
set; the guards must answer something while it is broken, and a partial read of a failed file is the
one answer nobody can predict. A layer with any problem is not applied at all, a local file that
loosens `guardrails.*` or `pr.merge` counts as invalid, and while any problem exists the guardrails
are one fixed strictest set: `forcePush: deny`, `commitOnProtected: deny`, `envFiles: deny`,
`protectedBranches` master, main, production, and the Ship script runs `pr.merge: ask`. The
session-start report and the doctor name every problem by file, path and message.

## Consequences

One bad key blocks the whole file, and until it is fixed lease pushes and every env file are refused.
While a layer is invalid, a repository that commits small fixes on its protected branch cannot commit
them there.
Applying the valid keys of a failed file, falling back to the ordinary defaults and refusing every
command are the rejected shapes. A doctor `config` FAIL traced to this rule rather than to a real
misconfiguration is the signal to reopen it.
