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

## The Gate

`dw-sdlc gate` proves a change. It runs the Steps under `gate.steps`, the repository's own commands, in
order from the repository root, then every Check under `gate.checks`, a named rule the package ships. It
prints one line per Step and per Check, and the last 50 lines of a command that fails; `--verbose` streams
every command's output instead. A Step that creates, changes or deletes a file git tracks or would track
fails the Gate as Drift, unless `gate.drift` is `"allow"`. It exits 0 when everything passes, 1 when a
Step or a Check fails or a Step drifts, and 2 when the Gate cannot run. `--json` prints the result as one
document. `--cache` skips the run when the working tree and the resolved Gate match the last green run in
that checkout, so a pre-push hook costs nothing on an unchanged tree. `dw-sdlc check <name>` runs one
Check alone, with the same lines, exit codes and document.

```json
{
  "$schema": "../node_modules/dw-sdlc/config/agentic.config.schema.json",
  "version": 1,
  "gate": {
    "steps": ["pnpm lint", "pnpm typecheck", "pnpm test"]
  }
}
```

A Step is a command string, or `{ "command": "…", "hint": "…" }`; a `gate.checks.run` entry takes a
`hint` beside `name` and `command`. When the Step or script fails, the Gate prints `hint: <text>` under
its failure line, and `--json` carries `hint` on every Step and Check, `null` where there is none.

```json
{ "scripts": { "check": "dw-sdlc gate" } }
```

Under `gate.checks`, a Check the package ships is `true` for its defaults or an object of its options;
the schema names each one's options. The package ships `primitives`, `agents-map`, `routed-docs`,
`markdown-budget`, `markdown-refs`, `temporal-language`, `decision-records`, `file-size-ratchet`,
`comment-budget`, `disable-directives` and `skill-sections`. Three of them:

- `comment-budget` holds each comment block in the JavaScript, TypeScript and shell (`.sh`) files under
  its `roots` to `maxProseLines` lines of prose, 3 by default.
- `disable-directives` fails every Disable directive, a comment that turns a linter or the type checker
  off, that gives no reason: `oxlint-disable*`, `eslint-disable*`, `@ts-expect-error`, `@ts-ignore`,
  `rubocop:disable` and `noqa`. A reason follows `--` on the directive's line, follows an `@ts-`
  directive, or is a comment on the line above.
- `skill-sections` holds each README section a skill copies to its source. A part sits between two
  markers, each on its own line, and `dw-sdlc check skill-sections --write` fills an empty pair:

  ```md
  <!-- README.md#errors -->
  <!-- /README.md#errors -->
  ```

  The anchor is GitHub's, and the section runs from its heading to the next heading of its level or
  above, in the `README.md` beside the `skills` directory that holds the file, or beside the file outside
  one. The Check fails a part that differs from its section, a part whose anchor names no heading of the
  README, a part from a section no Primitive in `.ai/primitives.json` names among its docs, a marker
  without its pair, and a code fence that never closes above a marker, which hides it. A Primitive is one
  unit a repository exposes to an agent, a module, a hook, a script, a config key or a skill, and
  `.ai/primitives.json` is their catalogue.

Every Check is in
[The Checks the package ships](https://github.com/dominikwozniak/dw-sdlc/blob/main/docs/overview.md#the-checks-the-package-ships).

## The Ship script

`dw-sdlc pr ship [<n>] [-R owner/name]` reads one pull request through an authenticated `gh` and answers
the one Action it needs next, as a line or, with `--json`, one document. The exit code says whose turn it
is: 0 done, 10 the agent's, 20 wait, 30 the dev's, 2 it cannot run. The script performs its own Actions:
it updates a branch GitHub reports `BEHIND`, marks the head reviewed when the Review depth is `off`,
marks a draft ready once nothing else holds it back, and squash merges a pull request that is green,
reviewed and opened by the `gh` account, when the merge is its own. `--dry-run` performs nothing: it
answers the first Action the script would perform as the dev's. It never deletes a branch; a merged pull
request answers with the delete command for the dev.

`pr.merge` in the committed `.ai/agentic.config.json` says who merges: the script under `auto`, the dev
under `ask`, the default. A pull request the `gh` account did not open is always the dev's to merge.
`pr.review` sets the Review depth of a head no one has reviewed: `full` runs the command
`pr.reviewCommand` names, `/code-review` by default; `light` spawns the `sdlc-reviewer` subagent of the
[`sdlc` plugin](https://github.com/dominikwozniak/dw-sdlc/blob/main/plugins/sdlc/README.md#the-light-review);
`off` reads nothing. Under `auto`, the default, the script routes the depth from the size of the change.
The local layer may tighten either key and never loosen it; `--merge` acts as `auto` and
`--review full|light|off` sets the depth for one call.

```json
{ "pr": { "merge": "auto", "review": "full" } }
```

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
Recap, a Brief, a Worker and a Lead belong to the
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
