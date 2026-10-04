# A lease push to an unprotected branch passes; every other force push is refused

The workflow rebases feature branches, so their remote copies must be rewritten, and a guard that
refuses every force push leaves the agent unable to update its own branch. `--force-with-lease` and
`--force-if-includes` pass to a branch outside `guardrails.protectedBranches` (with `--all`, every
local branch counts); bare `--force`, `-f`, a `+refspec` and `--mirror` are refused, and so is any
force to a protected branch. `guardrails.forcePush: deny` refuses every force, and the local file may
only tighten.

## Consequences

A lease push still replaces a feature branch's remote commits, only never ones the agent has not
fetched. The auto-mode classifier soft-denies "force push" by default, so the setup writes one
`autoMode.allow` exception for lease pushes, opening a list it creates with `"$defaults"`, and
exact-spelling deny rules for the bare forms in plain and `rtk` form. Allowing every force push and
asking each time are rejected. Branch rules on the git host, where a repository has them, are a second
line behind the guard, not a replacement for it.
