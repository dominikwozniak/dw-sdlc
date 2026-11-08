---
status: accepted
---

# A Sweep deletes only what the guards let an agent delete by hand

Finished work leaves worktrees, Landed branches and Workers' terminals behind, and no session owns their
removal: a Worker cannot remove the worktree it runs in, a Lead leaves its Workers' to the dev, and the
guards judge each delete as a command of its own. `dw-sdlc sweep` removes them on the dev's word, from the
main checkout only, within the bounds a guard keeps: never `--force`, a branch only when it is Landed,
nothing on the remote, a Claude Code lock only when the process that took it is gone, and a terminal only
of a Worker the sweeping session started. It judges each worktree whole before it touches its terminal, so
a Worker is never stopped beside work it could still commit. What it keeps it names, with the reason and
the command the dev would run. Landed branch has two implementations, the guard's in bash and the
package's in TypeScript, held to one meaning by a table of scenarios both test suites read.

## Considered Options

A trusted path that forces once its own checks pass is rejected: the command would become the way round a
refusal, and the guard would stop being the one boundary. A guard that asks the package whether a branch
is Landed is rejected, since it starts Node on every forced delete; a package that calls the plugin's bash
is rejected, since the package ships to npm without the hooks. A sweep from a linked worktree is refused,
because git run inside the command is out of sight of Claude Code's worktree isolation.

## Consequences

A dirty worktree, a scratch one included, still needs the dev's `--force`. The sweep spans the whole
repository, so it removes what other sessions left; that is safe only because each thing it removes holds
nothing to lose, and a live lock or another session's terminal keeps it off work in progress.
