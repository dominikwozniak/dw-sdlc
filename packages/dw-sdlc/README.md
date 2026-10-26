# dw-sdlc

The Gate and the agentic config of a repository. `.ai/agentic.config.json` declares how a repository
works for an agent: its package manager, protected branches, env-file policy, commit convention and
the Gate. The package ships the `dw-sdlc` bin that runs on that file, its JSON Schema, and the
resolver of its layers.

## Install

Node 24 or later.

```sh
pnpm add -D dw-sdlc
```

## The Gate

`dw-sdlc gate` runs the Steps under `gate.steps` in order from the repository root, then every Check
under `gate.checks`. It exits 0 when everything passes, 1 when a Step or a Check fails, and 2 when the
Gate cannot run. `--json` prints the result as one document.

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

## Commands

| command            | what it does                                                                        |
| ------------------ | ----------------------------------------------------------------------------------- |
| `gate`             | the Steps of `gate.steps` in order, then every Check under `gate.checks`            |
| `primitives`       | the Primitives that own each path, with their summaries and documents               |
| `setup`            | this machine's local config layer, the git excludes and the permission rules        |
| `doctor`           | one PASS / WARN / FAIL line per machine check the guardrails rely on                |
| `config`           | the resolved agentic config, or one file validated against the schema               |
| `references sync`  | every declared Reference brought to its ref under `references/`                     |
| `references setup` | the Router, its table and the ignore rules a repository needs to declare References |

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
