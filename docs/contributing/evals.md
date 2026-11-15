# Evals

A skill's evals run a real agent on its prompts, through `/skill-creator`, outside `pnpm test` and the
Gate. Run them when the skill changes. Four skills keep them, each under its own `evals/`:
`sdlc-pr-open`, `sdlc-recap`, `sdlc-kickoff` and `sdlc-delegate`. `evals.json` holds the behaviours, and
`trigger.json` the queries that must start the skill and the near misses that must not. The
`sdlc-reviewer` agent keeps its own, [below](#the-sdlc-reviewer-agent).

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

## The `sdlc-reviewer` agent

The agent of the `light` Review has evals too, under `plugins/sdlc/evals/sdlc-reviewer/`, outside
`plugins/sdlc/agents/`, where Claude Code may read any `.md` as an agent. They measure whether the first
line of its report is right. A broken Coding standard is a Finding
([ADR 0025](../adr/0025-a-broken-coding-standard-is-a-finding.md)); the cases check that the reviewer
reports what it must and stays quiet on a clean change. The `smell:` line of case 5 is the reviewer's own
output line for a smell that no written rule backs.

Run them when `plugins/sdlc/agents/sdlc-reviewer.md`, `plugins/sdlc/skills/sdlc-pr-ship/references/review.md`
or the Finding's definition in the ADR changes. They stay out of the Gate and CI: a case runs a real
model, and its report varies from run to run.

| directory                   | holds                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `fixture/base/`             | `shop-kit`, a small cart library: `AGENTS.md`, a `CODING_STANDARDS.md` of three one-line rules, code and docs |
| `fixture/cases/<n>-<name>/` | the files one case changes, copied over the base                                                              |
| `build-fixture.sh`          | builds the fixture as a git repository in a scratch directory and prints its path                             |
| `evals.json`                | the six cases: the prompt, and the expectations on the report                                                 |

`build-fixture.sh` makes branch `base` from `fixture/base/`, and one commit on it per case, on branch
`case-<n>-<name>`; `CLAUDE.md` links to `AGENTS.md`, as in the repositories the reviewer sees. The diffs are written for the evals: a diff from a past pull request depends on a tree
that moves. The repository has no remote, no hooks, and `.claude/settings.local.json` turns the installed
`sdlc` plugin off, so the run measures the tree and not the installed copy.

| case            | the change                                                       | first line of the report                                              |
| --------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `1-clean`       | a new function with its test and its doc line                    | `clean`                                                               |
| `2-harm`        | `removeItem` drops the last item when the sku is not in the cart | `findings: 1`                                                         |
| `3-false-doc`   | a new shipping threshold, with a doc example left false          | `findings: 1`                                                         |
| `4-standard`    | a boolean named `valid`, which breaks rule 2, and harms nothing  | `findings: 1`, citing `CODING_STANDARDS.md`, the rule and `file:line` |
| `5-smell`       | the same formatting copied three times, which no rule forbids    | `clean`, with a `smell:` line                                         |
| `6-fix-no-test` | a bug fix with no test that fails without it                     | `findings: 1`                                                         |

Each prompt plays the `light` step of `/sdlc-pr-ship`: it spawns `sdlc:sdlc-reviewer` with the diff
command, the files, the spec and the Primitives (`none`), and prints the report. Run the cases one at a
time from the repository root, with the plugin loaded through `--plugin-dir`:

```bash
repo=$PWD
evals=$repo/plugins/sdlc/evals/sdlc-reviewer/evals.json
fixture=$(plugins/sdlc/evals/sdlc-reviewer/build-fixture.sh)
cd "$fixture"
for name in $(jq -r '.evals[].name' "$evals"); do
  git switch -q "case-$name"
  echo "== $name"
  jq -r --arg name "$name" '.evals[] | select(.name == $name) | .prompt' "$evals" |
    claude -p --plugin-dir "$repo/plugins/sdlc" --allowedTools "Agent Read Grep Bash(git *)"
done
```

The branch of the case is checked out before its run: the reviewer reads the files of the working tree.
Judge each report against the case's `expectations` in `evals.json`; a case passes when every one holds.
The first line decides most of them. A failed case is a fact about the agent or its instructions, not
about the fixture, until a read of the report says the case itself is unclear. Report how many cases
passed, and name each one that failed. Delete the fixture afterwards.

## The skills of `sdlc-sessions`

| skill           | `evals.json` holds                                                                                                                                                                                                                                                                                  | `trigger.json` fires on, and not on                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `sdlc-recap`    | the Recap's shape, a follow-up going out as a Brief, one Lead for the next session and the `worker` follow-ups                                                                                                                                                                                      | `/sdlc-recap` and a Brief's instruction; not "co dalej?"                                                |
| `sdlc-kickoff`  | the Brief's shape, its routing of model and effort, a grilling Brief, no Brief for work that may land as several pull requests, the new Lead recommended in herdr                                                                                                                                   | none: only the dev invokes it                                                                           |
| `sdlc-delegate` | the Lead's rules: the first Worker alone and the rest after it, a blocked ticket queued until a Worker's end frees it, its turn ended after starting Workers, plain-text questions, no split that must merge into one diff, no merge, a refusal outside herdr, in a Worker and in a linked worktree | `/sdlc-delegate` and the dev's words handing work to Workers; not "implement #N" or a Worker's own work |

Run a trigger set with the plugin loaded through `--plugin-dir`, since a typed `/sdlc-recap` resolves only
to the real skill.
