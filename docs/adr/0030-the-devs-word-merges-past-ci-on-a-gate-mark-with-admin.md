---
status: accepted
---

# The dev's word merges past CI on a Gate mark, with --admin

The Ship script merges a pull request only on green CI or a Gate mark. When the dev writes "merge
without CI" for one pull request, the skill passes `--without-ci`: a Gate mark on the head stands in
for CI that is pending or red, and the script merges with `gh pr merge --admin`, which bypasses
required checks where the viewer may. The Gate mark keeps any merged head proven by something, and
every non-CI blocker still parks before the merge row, so `--admin` bypasses only the checks the dev
waived.

`--without-ci` moves aside the CI rows only: `fix-ci`, `unverified`, `ci-pending`, `ci-stuck` and
`ci-limit`. Without a Gate mark on the head the answer is `act prove-locally`, `dw-sdlc gate --mark`,
and a red Gate is fixed and pushed as under `fix-ci`. CI unavailable answers `prove-locally` too, with
`gate.steps` or without: the dev's word asks for the merge, so no `ci-unavailable` park hands it back. Conflicts, unresolved threads, changes requested,
a required approval, a draft and another author's pull request block under it too. It does not imply
`--merge`: "merge without CI" carries the word "merge", so the skill adds `--merge` under its existing
rule, and the flag alone never merges past what `pr.merge` says.

The merge is `gh pr merge <n> --admin --squash --match-head-commit <head>`, run by the script or named
for the dev. `--admin` is needed because, while required checks have not passed, gh turns on
auto-merge in place of merging. This repository has `allow_auto_merge: false` and a ruleset requiring
`Check / Check` on `main`, which the admin role bypasses. `--admin` also passes over a required
approval, but the `awaiting-approval`, changes-requested and thread rows park before the merge row,
so it never merges past a blocker the script reads. Without `--without-ci` no merge carries `--admin`.

## Considered Options

- Park with the dev's merge command. The safer default, rejected: the dev writes the rule often and
  wants it done without typing.
- Refuse the path. Rejected for the same reason.

## Consequences

The skill passes `--without-ci` only on the dev's word for this pull request, and on every later call
of the run. A merge GitHub refuses, as for a viewer whose role cannot bypass the rules, parks
`ready-to-merge` with that command as the dev's step. The skill's own words follow in their own change.
