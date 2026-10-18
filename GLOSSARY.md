# dw-sdlc

The software delivery process Dominik works by, and the Claude Code tooling that carries it. It is proven in
this repository before it goes wider.

## Language

### Guards

**Guard**:
One hook that judges a tool call before it runs and answers with a verdict.
_Avoid_: rule, check

**Dispatcher**:
The guard that reads a shell command once and runs the other guards in order; the first refusal or ask
ends the chain.

**Verdict**:
A guard's answer to a tool call: deny, ask or pass.
_Avoid_: result, decision

**Scan**:
The command text the guards judge: heredoc bodies dropped but for the substitutions an unquoted one
runs and the body a shell reads as its script, continuation lines joined.

**Command position**:
Where the shell reads a command, not an argument: a line start, indented or not, after a separator,
in a subshell or a substitution, or behind a launcher. A guard judges a command only there.

**Launcher**:
A word that runs the command after it: `sudo`, `env`, `xargs`, `timeout`, `find -exec`, `bash -c`, a
shell keyword such as `then` or `do`. Its options are read with it, so the command behind stays in
command position.

**Plain words**:
A command segment's shell words with the quotes gone and quoted prose dropped.

### Config

**Layer**:
One source of a repository's agent rules: inferred, committed or local. Local wins over committed,
committed over inferred.

**Inferred layer**:
The values read from the repository itself when no file sets them: the package manager from the lockfile,
and the conventional commit convention.

**Strictest set**:
The fixed guardrails in force while any layer is invalid: every force push, every env file and every
commit on a protected branch refused, and master, main and production protected.

**Convention**:
The preset a commit subject must follow: `ticket-key` (`[KEY-123] type: subject`) or `conventional`
(Conventional Commits). An explicit pattern wins over it.
_Avoid_: commit format, commit style

### Git

**Lease push**:
A force push that names `--force-with-lease` or `--force-if-includes`; the one force form a guard lets
through, and only to a branch that is not protected.
_Avoid_: safe force push

**Protected branch**:
A branch the agent never pushes to, plainly or by force, and never commits on where the repository
says so; it changes only through a pull request.

**Landed branch**:
A local branch whose work is on origin's base branch: its tip is there, or it changes something
and a base commit since it forked holds its tree or the patch-id of its whole diff, as a squash
merge leaves them. The one branch a forced delete may remove.
_Avoid_: merged branch, which git's `--merged` keeps for a tip the base contains

### Distribution

**Marketplace**:
The catalogue Claude Code installs plugins from. This repository is one.

**Plugin**:
One installable unit the marketplace lists: hooks and skills under one version.

### Research

**Reference**:
A repository cloned on one machine so an agent can read how a problem was solved before. Read-only, and never
part of this repository's history.
_Avoid_: vendored repo, subtree
