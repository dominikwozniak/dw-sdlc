# The close verdict

What `dw-sdlc recap` reports under `close`, and why it answers as it does. The [`sdlc-sessions` README](../../plugins/sdlc-sessions/README.md#dw-sdlc-recap) gives the command.

| reason              | blocks | when                                                                                                            |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `paused`            | yes    | a rebase, `git am`, merge, cherry-pick, revert or bisect is paused, however clean the tree reads                |
| `uncommitted`       | yes    | a change git would commit or could track                                                                        |
| `unpushed`          | yes    | commits past the upstream                                                                                       |
| `no-upstream`       | yes    | commits on no remote, on a branch with no upstream or a detached HEAD                                           |
| `open-pull-request` | yes    | the pull request is open, whatever its Action                                                                   |
| `orphaned`          | yes    | commits of a closed pull request left the branch, as by a reset, and no remote branch holds them                |
| `no-pull-request`   | yes    | commits on top of the base, no pull request holds the head, and the branch is neither the default nor protected |
| `workers`           | yes    | a Worker this session started as a Lead is live, whatever its status                                            |
| `merged`            | no     | the pull request merged                                                                                         |
| `closed`            | no     | the pull request closed without merging; commits only it holds read as `no-upstream`                            |
| `worktree`          | no     | a linked worktree, left to remove                                                                               |
| `clean`             | no     | no reason blocks                                                                                                |

Why it answers as it does:

- **It leans to "no".** An open pull request blocks even when parked on the dev, and a live Worker blocks
  even when its turn ended: a wrong "no" costs less than a wrong "yes".
- **It never fetches.** A branch force-pushed or deleted since the last fetch can read as holding the
  head. Run `git fetch --prune` first to be exact. Treating every moved branch as stale would answer no
  each time the base moves on. A remote out of reach holds nothing, so it answers no.
- **A commit a pull request holds counts as pushed**, so a branch whose pull request merged and whose
  remote ref is gone still closes.
- **The pull request comes from `gh pr view`**, then from the head branch the upstream names. It counts
  only when its commits hold the local `HEAD`, so a parent branch's pull request is never this one's.
  The limit follows: a branch pushed under another name, with commits its pull request lacks, gets no
  pull request, and those commits read as `unpushed` and `no-pull-request`.
- **A detached HEAD or no remote asks `gh` nothing**: the `pull request` line reads `gh not asked`. A
  remote on another host exits 2, and so does a failed `hc` in herdr.
