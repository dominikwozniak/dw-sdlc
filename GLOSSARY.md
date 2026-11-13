# dw-sdlc

Claude Code tooling that holds my agentic workflow where the engineering skills leave it loose:
guards on every tool call, a Gate that proves a change, and the road from a pull request to merged. It
extends those skills and replaces none.

## Language

### Guards

**Guard**:
One hook that judges a tool call and answers with a verdict, before the call runs or, for a flag only, after it. A Check judges the tree.
_Avoid_: rule

**Dispatcher**:
The guard that reads a shell command once and runs the others in order; the first deny ends it, and an ask waits for the rest, since a later deny wins.

**Verdict**:
A guard's answer to a tool call: deny, ask or pass.
_Avoid_: result, decision

**Known limit**:
A way past a guard only a deliberate evasion writes: listed, not caught.

**Scan**:
The command text the guards judge: heredoc bodies dropped but for the substitutions an unquoted one
runs and the body a shell reads as its script, continuation lines joined.

**Command position**:
Where the shell reads a command, not an argument: a line start, indented or not, after a separator,
in a subshell or a substitution, or behind a launcher. A guard judges a command only there.

**Launcher**:
A word that runs the command after it: `sudo`, `env`, `xargs`, `timeout`, `find -exec`, `bash -c`, a shell keyword
such as `then` or `do`. Its options are read with it, so the command behind stays in command position.

**Plain words**:
A command segment's shell words with the quotes gone and quoted prose dropped.

**Word walker**:
The one reader of a shell command the Bash guards share, written in bash: it walks the Scan by its words to
find each Command position and the Plain words after it, with no shell parser behind it. A spelling it does not
read and only a deliberate evasion writes is a Known limit.
_Avoid_: parser

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
A force push that names `--force-with-lease` or `--force-if-includes`, the one force form a guard lets through.
_Avoid_: safe force push

**Protected branch**:
A branch the agent never pushes to, forced or not, nor commits on if the repo says so; only a pull request changes it.

**Landed branch**:
A local branch whose work is on origin's base: its tip is there, or it changes something and a base commit since it
forked holds its tree or its whole diff's patch-id, as a squash merge leaves them. The one a forced delete or a
Sweep may remove.
_Avoid_: merged branch, which git's `--merged` keeps for a tip the base contains

**Sweep**:
The removal from this machine of what finished work leaves behind and holds nothing to lose: a Landed branch, a
clean worktree whose work has landed, and the terminal of a Worker the sweeping session started. What could
still hold work stays, for the dev to decide.
_Avoid_: clean (git's deletes untracked files), prune, cleanup, tidy, teardown, sunset

**Action**:
The one thing a pull request needs next, as the ship script decides it: performed by the script, handed
to the agent or left to the dev. Waiting and parking are Actions too.
_Avoid_: Step, Verdict, move, GitHub Actions (the CI)

**Ship script**:
The command that drives one pull request to merged: it decides each Action and performs the ones it owns.
_Avoid_: autopilot, babysitter, land (a Landed branch is a local one)

**Review**:
The agent's reading of a pull request's changes before the merge, pinned to the head it read.
_Avoid_: approval (a person's verdict on GitHub), code review (the skill that may carry one out)

**Review depth**:
How closely a Review reads the changes: full, light, or off, where no one reads them.
_Avoid_: tier, level, mode (a permission mode says what the agent may do unasked)

**Finding**:
What a Review reports that holds the merge: a concrete harm the pull request's own changes cause, a doc
or Primitive summary they make false, a miss against the spec, or a bug fix without its regression
test. A Review with none is clean.
_Avoid_: nit, smell (a judgement call the agent may decline), issue (a GitHub Issue)

**Read mark**:
The `dw-sdlc/review` status in state failure, described "read, findings open", that pins a Review which
left a Finding open to the head it read; the next Review reads the fix from it. It never carries over a
merge of the base, and three of them with no success between them park the pull request.
_Avoid_: review marker (it does not say whether the Review was clean), failure status

### Sessions

**Lead**:
The session that cuts the dev's work into Briefs, hands each to a Worker and answers the dev for all of them.
_Avoid_: orchestrator, coordinator

**Worker**:
A session that carries one Brief to its end itself, reporting to its Lead when it has one; it starts no other session.
_Avoid_: subagent (a helper inside one session), child, agent

**Brief**:
What a Worker starts from: the goal, a pointer to its source rather than a retelling, what it may write,
what it must not do, the proof it is done, where it reports, and the model and effort it runs on.
_Avoid_: prompt, task

**Recap**:
What a session tells a dev who did not follow it: where its work stands in Action words, what happened, what
it decided alone, whether it can close, its questions, follow-ups and next session. A Worker reports to its
Lead with one.
_Avoid_: status report, summary

### Gate

**Check**:
One unit that judges the state of the working tree and answers with an exit code, a line naming the
remedy and, on request, machine-readable output: a module the package ships or a repository's own script.
_Avoid_: Step (a toolchain command the Gate runs first), rule, validator, test (proves behaviour, not the tree)

**Step**:
One toolchain command the Gate runs before its Checks, such as lint or the tests; the first to fail ends the Gate.
_Avoid_: Check (which judges the tree and runs on after another fails), stage, job

**Gate**:
The Steps and then the Checks a change must pass, run by one command, locally and in CI.
_Avoid_: quality gate, CI (which runs it), lint (one part of a Step)

**Hint**:
One line a Step carries that names what to try when it fails.
_Avoid_: remedy (the line a Check prints)

**Disable directive**:
A comment that turns a lint rule or a type check off for the code it marks.
_Avoid_: suppression, waiver, ignore

**Drift**:
A file a Step creates, changes or deletes while the Gate runs, such as a stale generated file; never an edit made before the run.

**Shared workflow**:
The one CI job that runs a repository's Gate, kept in a public repository so a private one of any owner
can call it, and pinned by a release tag's commit SHA.
_Avoid_: reusable workflow (GitHub's mechanism for it), template, Action (the Ship script's next step)

**Ratchet**:
A Check whose recorded baseline may only tighten: a number that never grows or a list of exceptions that only shrinks.
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

**Engineering skills**:
The skills that plan, build and review the work, `mattpocock/skills` here. dw-sdlc runs beside them and replaces none.
_Avoid_: framework, base plugin

**Marketplace**:
The catalogue Claude Code installs plugins from. This repository is one.

**Plugin**:
One installable unit the marketplace lists: hooks and skills under one version.

### Research

**Reference**:
A repository cloned on one machine so an agent reads how a problem was solved before. Read-only, never in history.
_Avoid_: vendored repo, subtree

**Router**:
The file an agent reads first under a repository's References: the rules for reading them, where
their list is declared, and a table of each one's `dir` and `when` that the setup writes from that list.
_Avoid_: manifest, index, Task Router (the Agent map's table)

**Sync**:
Bringing every Reference a repository declares to its ref: a missing one cloned, an existing one moved.
_Avoid_: pull, update
