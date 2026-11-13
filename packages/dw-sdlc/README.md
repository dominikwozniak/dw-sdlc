# dw-sdlc

The Gate and the agentic config of a repository. `.ai/agentic.config.json` declares how a repository
works for an agent: its package manager, protected branches, env-file policy, commit convention, the
Gate and who merges a pull request. The package ships the `dw-sdlc` bin that runs on that file, its JSON Schema, and the
resolver of its layers.

## Install

Node 24 or later.

```sh
pnpm add -D dw-sdlc
```

## The Gate

`dw-sdlc gate` runs the Steps under `gate.steps` in order from the repository root, then every Check
under `gate.checks`. It prints one line per Step and per Check, and the last 50 lines of a command
that fails; `--verbose` streams every command's output instead. A Step that creates, changes or
deletes a file git tracks or would track fails the Gate as Drift, unless `gate.drift` is `"allow"`.
It exits 0 when everything passes, 1 when a Step or a Check fails or a Step drifts, and 2 when the
Gate cannot run. `--json` prints the result as one document. `--cache` skips the run when the
working tree and the resolved Gate match the last green run in that checkout, so a pre-push hook
costs nothing on an unchanged tree. `dw-sdlc check <name>` runs one Check alone, with the same
lines, exit codes and document.

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

Under `gate.checks`, a Check the package ships is `true` for its defaults or an object of its options.
`comment-budget` holds each comment block in the JavaScript, TypeScript and shell (`.sh`) files under
its `roots` to `maxProseLines` lines of prose, 3 by default.
`disable-directives` fails every Disable directive in a comment that gives no reason: `oxlint-disable*`,
`eslint-disable*`, `@ts-expect-error`, `@ts-ignore`, `rubocop:disable` and `noqa`. A reason follows `--`
on the directive's line, follows an `@ts-` directive, or is a comment on the line above.

## The Ship script

`dw-sdlc pr ship [<n>] [-R owner/name]` reads one pull request through an authenticated `gh` and
answers the one Action it needs next, as a line or, with `--json`, one document. The exit code says
whose turn it is: 0 done, 10 the agent's, 20 wait, 30 the dev's, 2 it cannot run. The script
performs its own Actions: it updates a branch GitHub reports `BEHIND`, marks the head reviewed when the
Review depth is `off`, marks a draft ready once nothing else holds it back, and squash merges a pull
request that is green, reviewed and opened by the `gh` account, when the merge is its own. `--dry-run` performs nothing: it answers the first Action the
script would perform as the dev's. It never deletes a branch; a merged pull request answers with
the delete command for the dev.

`pr.merge` in the committed `.ai/agentic.config.json` says who merges: the script under `auto`, the
dev under `ask`, the default. `pr.review` says how closely a head no one has reviewed is read: the
agent reviews it under `full`, one `sdlc-reviewer` subagent of the plugin does under `light`, and no
one does under `off`. Under `auto`, the default, the script routes the depth from the changes:
lockfiles alone `off`; a workflow file, more than 100 changed lines outside lockfiles, or a change
too large to size `full`; the rest `light`. The local layer may tighten either and never loosen it;
`--merge` acts as `auto` and `--review full|light|off` sets the depth for one call. A pull request
the `gh` account did not open is always the dev's to merge.

```json
{ "pr": { "merge": "auto", "review": "full" } }
```

`pr ship` answers `review`, its depth under `details`, until the head carries the commit status
`dw-sdlc/review`, which `dw-sdlc pr reviewed <n> --head <sha>` posts after a clean review. A Review
that leaves a Finding open posts it with `--findings`, in state failure, "read, findings open": the
read mark. After the next push, `details.since` names the last head a Review read, clean or marked,
so the Review after a fix reads the fix alone. `pr reviewed` posts nothing and exits 2 once a push
moved the head, so a new head needs a fresh review. Under `off` the script posts that status
itself, its description saying why, and goes on.

Three Reviews with no success between them end the loop: `pr ship` answers `park review-limit`
instead of `review`, whose command, `dw-sdlc pr reviewed <n> -R <owner/name> --head <sha> --accept`,
is the dev's. `--accept` posts the success described "accepted by the dev, findings open"; with
`--findings` it exits 2. The limit is a constant, not a config key, and `--review <depth>` on a call
buys one more Review past it.

## Commands

| command            | what it does                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `gate`             | the Steps of `gate.steps` in order, then every Check under `gate.checks`                   |
| `check <name>`     | one Check of the Gate by its name, without the Steps and the other Checks                  |
| `primitives`       | the Primitives that own each path, or that a change removes, adds or extends               |
| `setup`            | this machine's local config layer, the git excludes and the permission rules               |
| `doctor`           | one PASS / WARN / FAIL line per machine check the guardrails rely on                       |
| `config`           | the resolved agentic config, or one file validated against the schema                      |
| `references sync`  | every declared Reference brought to its ref under `references/`                            |
| `references setup` | the Router, its table and the ignore rules a repository needs to declare References        |
| `pr ship [<n>]`    | the Action one pull request needs next, performing the script's own                        |
| `pr reviewed <n>`  | a Review pinned to the head it read, as a commit status: clean, Findings open, or accepted |
| `recap`            | the facts a Recap rests on and whether the session can be closed                           |

`dw-sdlc <command> --help` gives each one's options.

## The resolver

```ts
import { resolveConfig } from "dw-sdlc"

const { config, problems } = resolveConfig(process.cwd())
```

`resolveConfig` merges the committed `.ai/agentic.config.json`, the machine's
`.ai/agentic.config.local.json` and what it infers from the repository. `problems` names each layer
that fails the schema; an invalid layer is dropped whole.

## License

MIT
