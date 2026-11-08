---
"dw-sdlc": minor
---

`dw-sdlc pr ship` parks a pull request whose changes-requested review a push has answered as the reviewer's turn: `park awaiting-review`, actor `dev`, no command, the reason naming each reviewer. A review is answered when a non-merge commit follows the commit it read, which the one GraphQL query reads from `latestReviews` and finds in the commit history; dates are never compared, since the script's own `update-branch` merges the base after a review. A review whose commit has left the history, after a force-push or past the last 100 commits, counts as unanswered, and so does the pull request while any one of several reviewers asking for changes is. The new row sits right after `awaiting-reply`, so the pull request's own Review and CI run first, and `awaiting-review` rides in `blockers` of any earlier Action. A review still unanswered answers `act address-review` as before.
