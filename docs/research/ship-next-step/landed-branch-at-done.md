# What `done` can delete on a Landed branch

Read on 2026-11-28 from this repository at `origin/main` (`7eda0f69`), from `cli/cli` at `trunk`
(`aec38089`; `pkg/cmd/pr/merge/merge.go` last changed in `8fcd6a64`, 2026-09-11; `git/client.go`,
`git/objects.go`), from `gh pr merge --help` of gh 2.97.0, and from GitHub's page on the automatic
deletion of branches. The guards were run on sample input and the guard suite was run.

The question: at `done`, what do `gh pr merge --delete-branch`, the repository setting and the Sweep
already do for a merged pull request's remote branch, local branch, worktree and checkout; which steps
the `sdlc` Bash guards refuse; what is left for the Ship script.

## What this repository does today

- The merge call is `gh pr merge <n> -R <repo> --squash --match-head-commit <head>`, no `--delete-branch`:
  `packages/dw-sdlc/src/pr/decide.ts:226`.
- The script performs every host Action with `-R <repo>`, "so the checkout the script runs in plays no
  part": `packages/dw-sdlc/src/commands/pr-ship.ts:258-261` (`hostArgs(pr, action, policy, true)`,
  `decide.ts:237-239`). The dev's printed command leaves `-R` out (`decide.ts:249`).
- The `MERGED` row answers `done`, actor `dev`, with the command
  `git push origin --delete <branch>` only when `pr.branchStands && !pr.fromFork`:
  `decide.ts:281-292`. `branchStands` is true when GitHub reports a `headRef`: `state.ts:119-120`, `369`.
- The Ship skill: "Never delete a branch, the one `done` names included": `plugins/sdlc/skills/sdlc-pr-ship/SKILL.md:114`;
  `park` and `done` print the command and stop, "the dev's to run, never yours": same file `:105-107`.
  The overview says the same, "It never deletes a branch": `docs/overview.md:327-328`.
- This repository has `delete_branch_on_merge: true` and `allow_auto_merge: false`
  (`gh api repos/dominikwozniak/dw-sdlc`, read 2026-11-28). With the setting on, GitHub reports no `headRef`
  after the merge, so the `MERGED` row prints no command here. A repository without the setting gets the command.

## gh: `--delete-branch` (`-d`)

Help text: "Delete the local and remote branch after merge". `mergeRun` runs, in this order: `merge`,
`deleteLocalBranch`, `deleteRemoteBranch` (`merge.go:600-635`).

**Remote branch** (`deleteRemoteBranch`, `merge.go:517-546`)

- Skipped when delete was not asked, for a cross-repository (fork) pull request, and under `--auto`.
- Calls `api.BranchDeleteRemote`. A 422 or 404 (branch already gone) is not an error. Any other failure
  returns "failed to delete remote branch". It prints "Deleted remote branch" only on a terminal.
- With `--match-head-commit` the flag reaches the same call; the repository setting and the flag can both
  run, and the second finds the branch gone (the 422/404 case above).

**Local branch** (`deleteLocalBranch`, `merge.go:380-512`)

- Skipped under `--auto`, when delete was not asked, when `-R/--repo` was passed
  (`CanDeleteLocalBranch = !cmd.Flags().Changed("repo")`, `merge.go:124`; checked at `:398`), and when no
  local branch of the head's name exists (`merge.go:594`, `:398`).
- Worktrees are read with `git` and the current worktree is `ToplevelDir`; the first listed worktree is the
  main one (`mainWorktree := &worktrees[0]`, `:427`). A stale (prunable) worktree record for the head is pruned
  first (`:417-425`). Then the head's worktree decides:

| where the head branch is checked out                    | what gh does                                                                                                                                                                                                                                 | lines                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| nowhere                                                 | `git branch -D <head>`                                                                                                                                                                                                                       | `:504`                                           |
| the current linked worktree                             | skips the local delete, warns, prints `git worktree remove <path> && git branch -D <head>` for the dev                                                                                                                                       | `:430-437`                                       |
| the current worktree, which is the main checkout        | checks `<base>` out (`git checkout <base>`, or a new tracking branch if none), `git pull --ff-only <remote> <base>` (a failed pull only warns), then `git branch -D <head>`; prints "Deleted local branch ... and switched to branch <base>" | `:440-483`, `Pull` `client.go:893-905`           |
| the same, with `<base>` checked out in another worktree | skips, warns, prints `git checkout <base> && git branch -D <head>`                                                                                                                                                                           | `:450-457`                                       |
| the main checkout, gh running in another worktree       | skips, warns, prints `git branch -D <head>` after the main checkout is switched off                                                                                                                                                          | `:487-492`                                       |
| another linked worktree, gh running elsewhere           | `git worktree remove -- <path>` (no `--force`), then `git branch -D`; if the remove fails, warns and skips the branch delete                                                                                                                 | `:494-505`, `WorktreeRemove` `client.go:276-283` |

- The local delete is `git branch -D <head>` (`DeleteLocalBranch`, `client.go:665-676`); a failure after
  all those checks returns an error.
- With a merge queue the flag is refused: "Cannot use `-d` or `--delete-branch` when merge queue enabled"
  (`merge.go:242-250`).
- When the pull request was already merged, gh prompts on a terminal ("was already merged. Delete the branch
  locally?") and otherwise warns only (`merge.go:386-395`).
- `-d` is a short flag of the same option (`merge.go:175`).

## GitHub: automatic deletion of head branches

From GitHub's page (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches,
read through a page fetcher, so the wording below is a summary, not a verbatim quote, except the quoted
words):

- "You can have head branches automatically deleted after pull requests are merged in your repository."
  Merged pull requests only; the page says nothing of closed ones.
- Branch protection rules and repository rules can prevent the deletion.
- For a pull request from a fork the setting of the head repository (the fork) applies, and the merger
  needs write access there.
- The setting acts on the remote branch only. It touches no local branch, worktree or checkout.

## The Sweep

`packages/dw-sdlc/src/commands/sweep.ts`, `docs/adr/0015-a-sweep-deletes-only-what-the-guards-let-an-agent-delete.md`.

- Runs from the main checkout only; from a linked worktree it exits 2 (`sweep.ts:344-350`; ADR `:22-23`).
- Never touches a remote: "the fetch only writes remote-tracking refs" (`sweep.ts:60`; ADR `:11`). It
  fetches `origin` first (`sweep.ts:86-94`).
- Branch: `git branch -D -- <name>` (`sweep-removal.ts:123`), only for a local branch that is Landed on
  `origin/<base>` (tip read once, `sweep.ts:248-251`; re-read right before the delete, `sweep-removal.ts:116-121`).
  It keeps the default branch, the base, a protected branch, and a branch checked out in the main checkout
  or a kept worktree (`sweep.ts:172-191`; `sweep-removal.ts:111-114`).
- A Landed branch checked out in the main checkout, clean and with nothing paused, is kept with the dev's
  command `git switch <base> && git pull --rebase` (`sweep-trees.ts:150-151`). The Sweep never switches
  the main checkout itself.
- Worktree: `git worktree remove -- <path>`, never `--force` (`sweep-removal.ts:95`), only for a clean
  linked worktree whose HEAD is Landed, no paused operation, no live lock (`sweep.ts:128-160`). The
  branch it held goes right after it (`sweep.ts:282-284`).
- "A Worker cannot remove the worktree it runs in, a Lead leaves its Workers' to the dev": ADR `:7-9`.
- The ADR names `git update-ref -d` (expects a tip) as closing a race window that the guard refuses, so the
  Sweep does not use it: ADR `:31-35`.

## What the sdlc Bash guards refuse

All in `plugins/sdlc/hooks/block-dangerous-commands.sh`, spawned by `bash-guard.sh`. Probed on 2026-11-28
by feeding each command as a PreToolUse payload to `bash-guard.sh` from this repository (origin/HEAD is
`main`); the suite `plugins/sdlc/test/hooks/block-dangerous-commands.test.ts` ran 687 pass, 0 fail.

| command                                                                      | verdict                                                                  | source                                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `git push origin --delete <b>`, `git push origin :<b>`, `-d`                 | refused: "deletes a remote branch"                                       | `block-dangerous-commands.sh:88`, parser `lib-git.sh:85,101,106,115`; test `:360-375`, `:454` |
| `gh pr merge ... --delete-branch` or `-d`                                    | refused: "deletes the pull request's branch on GitHub and here"          | `:369-371`; test `:892`; `=false` passes `:909`; README `plugins/sdlc/README.md:154-158`      |
| `gh api -X DELETE .../git/refs/...`, GraphQL `deleteRef`                     | refused                                                                  | `:411`, `:420`                                                                                |
| `git update-ref -d`                                                          | refused: "deletes a ref"                                                 | `:346-348`                                                                                    |
| `git branch -D <b>` of a branch not Landed                                   | refused, naming the branch                                               | `:195-197`; probe                                                                             |
| `git branch -D <b>` of a Landed branch, written out, as a command of its own | passes                                                                   | `:161-200`; tests `:525-541`; README `plugins/sdlc/README.md:104-112`                         |
| `git branch -d <b>`, `--delete` (no force)                                   | passes (git itself refuses an unmerged one, which a squash merge leaves) | `:297-303`; test `:399-400`; README table `:61`                                               |
| `git worktree remove <path>`                                                 | passes                                                                   | `:324-328`; test `:414`                                                                       |
| `git worktree remove --force` / `-f`                                         | refused                                                                  | `:327`; tests `:410-413`                                                                      |
| `git switch <b>`, `git pull --rebase`                                        | pass (probed; not a guarded verb)                                        | probe; `:446` lists `switch`, `worktree` among read-only git verbs                            |

Notes:

- The `--delete-branch` rule carries the comment "Drop this rule to let a merge delete its branch" and
  says "A merged branch on GitHub goes with the repository's delete_branch_on_merge setting; a local one is
  the user's to delete" (`:369-371`).
- The guard reads the command the agent runs. A `gh pr merge` that the Ship script performs runs inside
  `dw-sdlc` through `gh(args)` (`pr-ship.ts:261`), not as an agent Bash command, so the guard does not see
  its arguments. This is inference from where the guard is hooked (`plugins/sdlc/README.md:29`, `PreToolUse`,
  Bash); no test runs the script against the guard.
- The Sweep's own `git` calls run inside `dw-sdlc` as well, and are held to the guard's bounds by design
  (ADR `:1-15`), not by the hook.

## How a Worker ends, and who sweeps

- A Worker ends with `/sdlc-recap`, delivered to its Lead with `dw-sdlc worker report`; `/sdlc-pr-ship`
  waits are reported the same way: `plugins/sdlc-sessions/templates/brief.md:20`, `:47`, `:53`.
- "Never remove a Worker's terminal or worktree yourself, by `hc kill`, `hc rm` or a worktree removal. The
  Sweep clears what a Worker leaves behind, on the dev's "go", once every Worker has reported":
  `plugins/sdlc-sessions/skills/sdlc-delegate/SKILL.md:166-167`. After the Recap the Lead offers
  `/sdlc-sweep`, which stops finished Workers' terminals and clears their worktrees; a worktree with
  uncommitted files stays (`:178-183`).
- Each Worker gets its own worktree (`:86`); the Lead runs in the main checkout (a Lead in a linked worktree
  is refused, `:27-29`).

## What follows from the above (inferred)

- Remote branch: nothing in this repository deletes it at `done` unless `delete_branch_on_merge` is on (it
  is here). `gh pr merge -R ... --delete-branch` would delete it, but the guard refuses that flag in an
  agent's Bash command, and `git push origin --delete` is refused too. A script-run `gh` is outside the
  guard's reach (unverified, see below).
- Local branch, worktree and checkout: because the Ship script's merge call carries `-R`, gh's
  `--delete-branch` would do none of them (`merge.go:124`, `:398`); only the remote delete would run. The
  main-checkout switch to base, the pull and the local delete would be steps of the script itself.
- In the main checkout: `git switch <base>`, `git pull --rebase` and the local delete pass the guard when
  the delete is `git branch -D <b>` (Landed, a command of its own) or `git branch -d <b>` (which git
  itself refuses on a squash-merged branch, since the branch tip is not an ancestor of the base).
- In a Worker's worktree: the branch is checked out there, so `git branch -D` of it fails in git while the
  worktree exists (the Sweep's own check, `sweep-removal.ts:111-114`, reflects that git rule, but the git
  message was not run here). gh would skip the local delete from inside the current linked worktree and
  print `git worktree remove <path> && git branch -D <head>` (`merge.go:430-437`). The ADR and the delegate
  skill leave the worktree to the Lead's Sweep.

## Unverified

- That a `gh` call made by the Ship script is not seen by the Bash guard: inferred from the hook's scope,
  not run end to end.
- That git refuses `git branch -D` of a branch checked out in a worktree: known from git's documented
  behavior, not run here; this research read the Sweep's code that avoids it.
- gh behavior was read from `trunk` source and `gh --help` of 2.97.0; a gh older than the 2026 worktree
  handling (`merge.go` history) may behave differently. No `gh pr merge` was run.
- The GitHub docs page was read through a summarizing fetcher, not verbatim. Whether a deleted head branch
  is restorable, and the behavior when the branch is the head of another open pull request, are not
  established: the page that describes them (`deleting-and-restoring-a-branch-in-a-pull-request`) returned 404.
- Whether the repository setting deletes the branch before or after `gh pr merge --delete-branch` runs
  its own remote delete is not read; gh treats 422/404 as success (`merge.go:524-533`), so either order passes.
