---
status: accepted
---

# A broken rule of the Coding standards is a Finding, and every Review depth reads them

A Review's depth decided which of a repository's rules applied. The `full` Review, `/code-review`,
always reads `CODING_STANDARDS.md` and `CONTRIBUTING.md`. The `light` Review, `sdlc-reviewer`, read
the Agent map alone. And at either depth a Finding needed a concrete harm (ADR 0016), so a broken
judgement-call rule was declined as a smell. A repository's written standards held no merge.

A Finding is one of:

- a concrete harm the pull request's own changes cause, a bug in old code they start calling included;
- a doc or a Primitive summary the changes make false;
- a miss against the spec;
- a bug fix without its regression test;
- a broken rule of the Coding standards, when the Review cites the rule (file and rule) and the
  change's `file:line`. It needs no harm.

A Fowler smell, or taste no written rule backs, stays declined. Every Finding cites `file:line` as its
evidence. This definition replaces the one in ADR 0016; that record's loop and limit stand.

The `light` and the `full` Review read the same files: `CODING_STANDARDS.md` and `CONTRIBUTING.md`,
each whole, when it exists. They are the list `code-review` guarantees.

One rule has one home. A mechanical rule is a Check, a lint rule or a guard. A judgement call for the
Review lives in `CODING_STANDARDS.md`. A fact the implementer needs while working is in `AGENTS.md` or
`docs/agents/`; `AGENTS.md` keeps a mechanical rule only when it spares the implementer a guard's
refusal. Process for people is `CONTRIBUTING.md`, product behaviour `README.md` and `docs/`. The Gate
never requires the file, and a new rule reaches it through `/retro`.

## Considered Options

A `REVIEW.md` is rejected: only Claude Code's managed Code Review app reads it, the local
`/code-review` does not, and `retro` writes `CODING_STANDARDS.md`. Keeping the harm test for every
rule is rejected: a rule that needs a harm to bind is a suggestion.

## Consequences

A `light` Review reads two more files, and a change that breaks a written rule holds the merge without
a bug. A rule written loosely holds merges it should not, so a rule is one line a Review can cite and
check against a diff.
