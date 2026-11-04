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
that fails; `--verbose` streams every command's output instead. It exits 0 when everything passes, 1
when a Step or a Check fails, and 2 when the Gate cannot run. `--json` prints the result as one
document. `--cache` skips the run when the working tree and the resolved Gate match the last green
run in that checkout, so a pre-push hook costs nothing on an unchanged tree. `dw-sdlc check <name>`
runs one Check alone, with the same lines, exit codes and document.

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

Under `gate.checks`, a Check the package ships is `true` for its defaults or an object of its options.
`comment-budget` holds each comment block in the JavaScript, TypeScript and shell (`.sh`) files under
its `roots` to `maxProseLines` lines of prose, 3 by default.

## The Ship script

`dw-sdlc pr ship [<n>] [-R owner/name]` reads one pull request through an authenticated `gh` and
answers the one Action it needs next, as a line or, with `--json`, one document. The exit code says
whose turn it is: 0 done, 10 the agent's, 20 wait, 30 the dev's, 2 it cannot run. The script
performs its own Actions: it updates a branch behind its base, marks a draft ready once nothing else
holds it back, and squash merges a pull request that is green, reviewed and opened by the `gh`
account, when the merge is its own. `--dry-run` performs nothing: it answers the first Action the
script would perform as the dev's. It never deletes a branch; a merged pull request answers with
the delete command for the dev.

`pr.merge` in the committed `.ai/agentic.config.json` says who merges: the script under `auto`, the
dev under `ask`, the default. The local layer may tighten it and never loosen it, and `--merge` acts
as `auto` for one call. A pull request the `gh` account did not open is always the dev's to merge.

```json
{ "pr": { "merge": "auto" } }
```

`pr ship` answers `review` until the head carries the commit status `dw-sdlc/review`, which
`dw-sdlc pr reviewed <n> --head <sha>` posts after a clean review. It posts nothing and exits 2 once
a push moved the head, so a new head needs a fresh review.

## Commands

| command            | what it does                                                                        |
| ------------------ | ----------------------------------------------------------------------------------- |
| `gate`             | the Steps of `gate.steps` in order, then every Check under `gate.checks`            |
| `check <name>`     | one Check of the Gate by its name, without the Steps and the other Checks           |
| `primitives`       | the Primitives that own each path, with their summaries and documents               |
| `setup`            | this machine's local config layer, the git excludes and the permission rules        |
| `doctor`           | one PASS / WARN / FAIL line per machine check the guardrails rely on                |
| `config`           | the resolved agentic config, or one file validated against the schema               |
| `references sync`  | every declared Reference brought to its ref under `references/`                     |
| `references setup` | the Router, its table and the ignore rules a repository needs to declare References |
| `pr ship [<n>]`    | the Action one pull request needs next, performing the script's own                 |
| `pr reviewed <n>`  | a clean review pinned to the head it read, as a commit status                       |

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
