# Evals

A skill's evals run a real agent on its prompts, through `/skill-creator`, outside `pnpm test` and the
Gate. Run them when the skill changes. Each skill keeps them under its own `evals/`: `evals.json` the
behaviours, `trigger.json` the queries that must start it and the near misses that must not.

## The skills of `sdlc`

`sdlc-pr-open`'s `evals/trigger.json` holds the queries that open a pull request or write its body, and
near misses such as "merge it" and "is CI green?"; its `evals/evals.json` holds four behaviours: a
repository with a pull request template, one without, a branch that has a pull request, and an issue as
the source.

### Running the evals of a pull-request skill

An eval of a skill that opens pull requests, `sdlc-pr-open` or any like it, runs a real agent, and
that agent can run `git push` and `gh pr create` for real. Run such evals only in a setup that cannot
reach GitHub:

1. **A scratch clone whose `origin` is no GitHub repository.** Clone the repository into a temporary
   folder, outside the working tree, then point `origin` at a path that does not exist:
   `git clone --local <repo> <scratch> && git -C <scratch> remote set-url origin /nonexistent/no-remote.git`.
   Never leave `origin` as the clone's own source: a push to a local path succeeds. With this
   remote `git push` fails with "repository ... does not exist", and `gh pr create` fails with "none of
   the git remotes configured for this repository point to a known GitHub host". Neither opens a
   connection to GitHub.
2. **One worker.** Run the evals one at a time, never in parallel: parallel workers write the same
   temporary command under the scratch clone's `.claude/commands` and collide.
3. **The installed `sdlc` plugin turned off in the scratch clone.** Put
   `{"enabledPlugins": {"sdlc@dw-sdlc": false}}` in `<scratch>/.claude/settings.local.json`. While it is
   on, the installed skill wins over the temporary command the run loads, so the run measures the
   installed copy and not the change.

Start the agent with the scratch clone as its working directory, never the real checkout. Leave
`GH_REPO` unset in its environment and add no other remote to the clone: either one gives `gh` and `git`
a way to reach GitHub. Delete the clone after the run.

## The skills of `sdlc-sessions`

The evals of `sdlc-recap` hold the Recap's shape, a follow-up going out as a Brief and the next session
named but not started, and `evals/trigger.json`
its trigger: it fires on `/sdlc-recap` and on a Brief's instruction, not on "co dalej?". Run the trigger set
with the plugin loaded through `--plugin-dir`, since a typed `/sdlc-recap` resolves only to the real skill.
The evals of `sdlc-brief` hold the Brief's shape and its routing of model and effort; only the dev invokes
it, so it has no trigger set. Those of `sdlc-delegate` hold the Lead's rules: it starts the first Worker
alone and the rest after it, queues a blocked ticket and starts it once a Worker's end frees it, ends its
turn after starting Workers, asks in plain text, refuses a split whose pieces must merge into one diff,
never merges, and refuses outside herdr, in a Worker and in a linked worktree. Its `evals/trigger.json`
fires on `/sdlc-delegate` and on the dev's words handing work to Workers, not on "implement #N" or a Worker's
own work.
