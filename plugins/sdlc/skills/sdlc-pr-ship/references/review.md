# The Review: what it checks and how its report is judged

`SKILL.md` runs the Review and marks the head it read. This file holds the rules around it: what
the Review checks, when an earlier one stands in, and how its report is judged.

## The earlier Findings

When the changes since `<since>` are a fix for Findings an earlier Review in this conversation left
open, name each of those Findings to the Review: in the command's arguments at `full`, in the
subagent's prompt at `light`. The Review checks each one is fixed and that the fix breaks nothing.
Findings still open in this conversation with no fix pushed yet: fix them and push before any Review.

## A Review an earlier one stands in for

Skip either Review, `full` or `light`, when one earlier in this conversation read the changes since `<since>` at `<head>`,
was clean, and nothing changed after it: no edit, no commit, no pull. Only a clean run of
`details.reviewCommand`, or at `light` of `sdlc-reviewer` too, whose range ended at `<head>` counts
as that earlier Review; an informal read of the diff never counts. A Review whose head the
conversation does not show needs a fresh Review.

## Judging the report

A Review is clean when it reports no Finding. A Finding is one of:

- a concrete harm the pull request's own changes cause, a bug in old code they start calling included;
- a doc or a Primitive summary the changes make false, so the next agent would act on a falsehood;
- a miss against the spec;
- a bug fix without its regression test.

A doc that only leaves new behaviour unmentioned is no Finding. A known limit the dev accepted in
this conversation is no Finding. Decline everything else, naming, duplication, comments, style
rules and judgement-call smells among them, each with one line in the answer, or in the Recap when
the session ends with one. A harm in code the pull request neither changes nor reaches is a
follow-up: one line in the answer, or under the Recap's follow-ups. The Recap is the session report
of `/sdlc-recap`, in the `sdlc-sessions` plugin; without that plugin the answer carries these lines.
Never post a success over an open Finding.

## What no one asked for

Whatever the Review depth, carry what no one asked for into the Recap's "Decisions without you",
or into the answer without a Recap, one line each, not into the declined lines above: at `light`,
each `added:` line of the subagent's report, and at `full`, each scope-creep item `code-review`
reports. This holds for a skipped Review too: carry the lines of the earlier Review it reuses. These
never count as Findings and never hold the merge.
