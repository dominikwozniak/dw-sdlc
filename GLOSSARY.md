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
runs, continuation lines joined.

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
The fixed guardrails in force while any layer is invalid: every force push and every env file refused,
and master, main and production protected.

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
A branch the agent never pushes to, plainly or by force; it changes only through a pull request.

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
