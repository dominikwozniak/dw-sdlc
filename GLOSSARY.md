# dw-sdlc

The software delivery process Dominik works by, and the Claude Code tooling that carries it.

## Language

### Guards

**Guard**:
One hook that judges a tool call before it runs and answers with a verdict. A Check judges the tree.
_Avoid_: rule

**Dispatcher**:
The guard that reads a shell command once and runs the others in order; the first deny or ask ends it.

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
One source of a repository's agent rules: inferred, committed or local, each winning over the one before.

**Inferred layer**:
The values read from the repository itself when no file sets them: the package manager from the lockfile,
the conventional commit convention, and the Gate command from the manifest's `check` script.

**Strictest set**:
The fixed guardrails in force while any layer is invalid: every force push, every env file and every
commit on a protected branch refused, and master, main and production protected.

**Convention**:
The preset a commit subject follows: `ticket-key` (`[KEY-123] type: subject`) or `conventional`; a pattern wins.
_Avoid_: commit format, commit style

### Git and pull requests

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

**Action**:
The one thing a pull request needs next, as the ship script decides it: performed by the script, handed
to the agent or left to the dev. Waiting and parking are Actions too.
_Avoid_: Step, Verdict, move, GitHub Actions (the CI)

### Gate

**Check**:
One unit that judges the state of the working tree and answers with an exit code, a line naming the
remedy and, on request, machine-readable output: a module the package ships, or a repository's own
script under `gate.checks.run`, run the same in CI, a commit hook, an agent hook and a terminal.
_Avoid_: Step (a toolchain command the Gate runs first), rule, validator, test (proves behaviour, not the tree)

**Step**:
One toolchain command the Gate runs before its Checks, such as lint, format, typecheck or the tests.
Steps run in order and the first that fails ends the Gate, its output passed through.
_Avoid_: Check (which judges the tree and runs on after another fails), stage, job

**Gate**:
The Steps and then the Checks a change must pass, run by one command, the same locally and in CI.
_Avoid_: quality gate, CI (which runs it), lint (one part of a Step)

**Ratchet**:
A Check with a recorded baseline whose limit may only tighten: a number that must not grow, or a list
of exceptions that may only shrink.
_Avoid_: threshold, budget (a fixed limit with no baseline)

**Primitive**:
The smallest unit of meaning a repository exposes to an agent: a module, a hook, a script, a config key,
a skill. The catalogue names where its code lives and which document explains it.
_Avoid_: component, feature, building block

**Agent map**:
The file an agent reads first in a repository, `AGENTS.md`: where things live, the commands, and the
Task Router that sends a task to the one document it needs.
_Avoid_: instructions file, rules

### Distribution

**Marketplace**:
The catalogue Claude Code installs plugins from. This repository is one.

**Plugin**:
One installable unit the marketplace lists: hooks and skills under one version.

**Proving ground**:
A repository other than this one that adopts each release as it ships and judges it on real work.
_Avoid_: playground, pilot, sandbox

### Research

**Reference**:
A repository cloned on one machine so an agent reads how a problem was solved before. Read-only, never in history.
_Avoid_: vendored repo, subtree

**Router**:
The file an agent reads first under a repository's References: the rules for reading them, where
their list is declared, and a table of each one's `dir` and `when` that the setup writes from that list.
_Avoid_: manifest, index

**Sync**:
Bringing every Reference a repository declares to its ref: a missing one cloned, an existing one moved.
_Avoid_: pull, update
