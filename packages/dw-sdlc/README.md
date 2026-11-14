# dw-sdlc

The bin and the config behind the [dw-sdlc](https://github.com/dominikwozniak/dw-sdlc) Claude Code plugins.
`.ai/agentic.config.json` declares how a repository works for an agent: its package manager, protected
branches, env-file policy, commit convention, the Gate and who merges a pull request. The package ships
the `dw-sdlc` bin that runs on that file, the file's JSON Schema and the resolver of its layers. The Gate
and the Ship script work in any repository, with or without the plugins.

## Install

Node 24 or later.

```sh
pnpm add -D dw-sdlc
```

Every release goes to npm from GitHub Actions by trusted publishing, and every version after 0.17.0
carries provenance too. Trust evidence never drops from one version to the next, so a repository on
pnpm's `trustPolicy: no-downgrade` takes each release. Dependabot offers one after the seven days of
`minimumReleaseAge`; a repository that cannot wait names `dw-sdlc` in `minimumReleaseAgeExclude` under
its own rule for exclusions.

## The Gate

`dw-sdlc gate` proves a change. It runs the Steps under `gate.steps`, the repository's own commands, in
order from the repository root, stopping at the first that fails. Then it runs every Check under
`gate.checks`, a named rule the package ships, none stopping the next.

```json
{
  "$schema": "../node_modules/dw-sdlc/config/agentic.config.schema.json",
  "version": 1,
  "gate": {
    "steps": ["pnpm lint", "pnpm typecheck", "pnpm test"]
  }
}
```

```json
{ "scripts": { "check": "dw-sdlc gate" } }
```

It prints one line per Step and per Check, and the last 50 lines of a command that fails. A Step that
creates, changes or deletes a file git tracks or would track fails as Drift, unless `gate.drift` is
`"allow"`. A Step written as `{ "command": "…", "hint": "…" }` prints `hint: <text>` under its failure
line; a `gate.checks.run` entry takes a `hint` beside `name` and `command`.

| flag                | does                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| `--json`            | prints the result as one document; each Step and Check carries `tail` and `hint`  |
| `--verbose`         | streams every command's output instead of the tail                                |
| `--cache`           | skips the run when the tree and the Gate match the last green run in the checkout |
| `--update-baseline` | after a green run, tightens the baseline of each Ratchet                          |

| exit | means                                                                              |
| ---- | ---------------------------------------------------------------------------------- |
| 0    | everything passes                                                                  |
| 1    | a Step or a Check fails, or a Step drifts                                          |
| 2    | the Gate cannot run: an invalid config layer, a command not found, a missing input |

`dw-sdlc check <name>` runs one Check alone, with the same lines, exit codes and document.

### Checks

Under `gate.checks`, a Check is `true` for its defaults, an object of its options, or `false`. The
schema's description of each one names its options and defaults.

| Check                | fails                                                                          | reads first               |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| `markdown-refs`      | a relative link, image or repository URL whose path or anchor does not resolve | nothing                   |
| `temporal-language`  | a changelog phrase in a durable document, outside code                         | nothing                   |
| `comment-budget`     | a comment block over 3 lines of prose in JS, TS or shell                       | nothing                   |
| `disable-directives` | a linter or type-checker disable comment with no reason                        | nothing                   |
| `agents-map`         | an `AGENTS.md` over budget, missing the Gate command or pointing at nothing    | `AGENTS.md`               |
| `primitives`         | a catalogue entry out of step with the tree, or a file no entry owns           | `.ai/primitives.json`     |
| `routed-docs`        | a document under `docs/` no Task Router row or Primitive leads to              | the map, the catalogue    |
| `markdown-budget`    | a markdown file over the byte budget of its glob                               | the files its globs match |
| `decision-records`   | a decision record misnamed, misnumbered or without a valid status              | a records directory       |
| `file-size-ratchet`  | a code file over its line limit that the baseline does not allow               | its baseline              |
| `skill-sections`     | a README section a skill copies that differs from its source                   | the catalogue             |

Each Check's options and defaults:
[its description in the schema](https://github.com/dominikwozniak/dw-sdlc/blob/main/packages/dw-sdlc/config/agentic.config.schema.json).

## The Ship script

`dw-sdlc pr ship [<n>] [-R owner/name]` reads one pull request through an authenticated `gh` and answers
the one Action it needs next, as a line or, with `--json`, one document. It performs its own Actions:
it updates a branch GitHub reports `BEHIND`, marks the head reviewed at Review depth `off`, marks a draft
ready once nothing else holds it back, and squash merges when the merge is its own. It never deletes a
branch. `--dry-run` performs nothing.

| exit | whose turn         |
| ---- | ------------------ |
| 0    | done               |
| 10   | the agent's: act   |
| 20   | nobody's yet: wait |
| 30   | the dev's: park    |
| 2    | it cannot run      |

| key                | sets                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `pr.merge`         | who merges: the script under `auto`, the dev under `ask`, the default                          |
| `pr.review`        | the Review depth of an unreviewed head: `full`, `light`, `off`, or `auto` from the change size |
| `pr.reviewCommand` | the slash command a `full` Review runs, `/code-review` by default                              |

```json
{ "pr": { "merge": "auto", "review": "full" } }
```

The local layer may tighten `pr.merge` and `pr.review`, never loosen them. `--merge` acts as `auto` and
`--review full|light|off` sets the depth for one call. A pull request the `gh` account did not open is
always the dev's to merge. `light` spawns the `sdlc-reviewer` subagent of the
[`sdlc` plugin](https://github.com/dominikwozniak/dw-sdlc/blob/main/plugins/sdlc/README.md#the-light-review).

`dw-sdlc pr reviewed <n> --head <sha>` pins a Review to the head it read, as the commit status
`dw-sdlc/review`: clean, Findings open with `--findings`, or accepted by the dev with `--accept`. The
routing rules, the read mark and the limit of three unclean Reviews are in
[How the Ship script merges a pull request](https://github.com/dominikwozniak/dw-sdlc/blob/main/docs/overview.md#how-the-ship-script-merges-a-pull-request).

## Commands

| command            | what it does                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `gate`             | the Gate: the Steps of `gate.steps` in order, then every Check under `gate.checks`                |
| `check <name>`     | one Check of the Gate by its name, without the Steps and the other Checks                         |
| `primitives`       | the Primitives that own each path, or that a change removes, adds or extends                      |
| `setup`            | the Gate adopted where asked, this machine's local config layer, git excludes and permissions     |
| `doctor`           | one PASS / WARN / FAIL line per machine check the `sdlc` plugin relies on                         |
| `config`           | the resolved agentic config, or one file validated against the schema                             |
| `references sync`  | every declared Reference, a repository cloned for reading, brought to its ref under `references/` |
| `references setup` | the Router, its table and the ignore rules a repository needs to declare References               |
| `pr ship [<n>]`    | the Action one pull request needs next, performing the script's own                               |
| `pr reviewed <n>`  | a Review pinned to the head it read, as a commit status                                           |
| `recap`            | the facts a Recap rests on, whether the session can be closed and what could come next            |
| `sweep`            | Landed branches and clean worktrees removed, and what it keeps named                              |
| `worker start`     | a Worker started on a Brief in a herdr terminal                                                   |
| `worker ls`        | the Workers this Lead started and their states                                                    |
| `worker report`    | a Recap delivered to the Lead, retried while it is blocked                                        |
| `lead start`       | the next session started as a Lead in a herdr terminal of its own                                 |

`dw-sdlc --help` lists them, and `dw-sdlc <command> --help` gives each one's options and exit codes. A
Primitive is one unit a repository exposes to an agent, a module, a hook, a script, a config key or a
skill, listed in `.ai/primitives.json`. A Recap, a Brief, a Worker and a Lead belong to the
[`sdlc-sessions` plugin](https://github.com/dominikwozniak/dw-sdlc/blob/main/plugins/sdlc-sessions/README.md).

## The resolver

```ts
import { resolveConfig } from "dw-sdlc"

const { config, problems } = resolveConfig(process.cwd())
```

`resolveConfig` merges the committed `.ai/agentic.config.json`, the machine's
`.ai/agentic.config.local.json` and what it infers from the repository. `problems` names each layer that
fails the schema; an invalid layer is dropped whole, and the guards then run the strictest set.

## License

MIT
