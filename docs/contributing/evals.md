# Evals

A skill's evals run a real agent on its prompts, through `/skill-creator`, outside `pnpm test` and the
Gate. Run them when the skill changes. Four skills keep them, each under its own `evals/`:
`sdlc-pr-open`, `sdlc-recap`, `sdlc-brief` and `sdlc-delegate`. `evals.json` holds the behaviours, and
`trigger.json` the queries that must start the skill and the near misses that must not.

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

| skill           | `evals.json` holds                                                                                                                                                                                                                                                                                  | `trigger.json` fires on, and not on                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `sdlc-recap`    | the Recap's shape, a follow-up going out as a Brief, the next session named but not started                                                                                                                                                                                                         | `/sdlc-recap` and a Brief's instruction; not "co dalej?"                                                |
| `sdlc-brief`    | the Brief's shape and its routing of model and effort                                                                                                                                                                                                                                               | none: only the dev invokes it                                                                           |
| `sdlc-delegate` | the Lead's rules: the first Worker alone and the rest after it, a blocked ticket queued until a Worker's end frees it, its turn ended after starting Workers, plain-text questions, no split that must merge into one diff, no merge, a refusal outside herdr, in a Worker and in a linked worktree | `/sdlc-delegate` and the dev's words handing work to Workers; not "implement #N" or a Worker's own work |

Run a trigger set with the plugin loaded through `--plugin-dir`, since a typed `/sdlc-recap` resolves only
to the real skill.
