# Inside the sdlc plugin

What sits under `plugins/sdlc/` and how its tests hold it, for someone changing the plugin. What each
part does for a user is in the [plugin README](../../plugins/sdlc/README.md).

## Layout

Paths are relative to `plugins/sdlc/`.

| path                                                 | what it is                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `.claude-plugin/plugin.json`                         | the manifest; its `hooks` key wires each hook to its event                                                                     |
| `hooks/lib.sh`                                       | the library every guard sources: payload reader, git helpers, refusal, config lookup                                           |
| `hooks/lib-lines.sh`                                 | the line scanners: heredoc openers and bodies, continuation lines                                                              |
| `hooks/lib-text.sh`                                  | the text scanners: the one quote walker every scanner reads, substitutions, plain words                                        |
| `hooks/lib-live.sh`                                  | the live-quote readers: a quote handed to a shell, ended where the outer shell ends it                                         |
| `hooks/lib-mask.sh`                                  | the quote mask: separators inside a quote made text                                                                            |
| `hooks/lib-words.sh`                                 | the word readers: shell words, the two readers of the [launcher table](bash-guard.md#the-command-position), the boundary       |
| `hooks/lib-git.sh`                                   | the git readers: a verb and its options, a push and its targets, the current branch                                            |
| `hooks/schema.jq`, `hooks/config.jq`                 | the config contract in jq: schema validation and the local-over-committed-over-inferred merge, as `src/agentic-config.ts` does |
| `hooks/bash-guard.sh`                                | the dispatcher, below                                                                                                          |
| `hooks/<guard>.sh`                                   | one guard each, as the README's [Guards](../../plugins/sdlc/README.md#guards) lists                                            |
| `hooks/session-start.sh`, `hooks/references-sync.sh` | the two session hooks                                                                                                          |
| `hooks/commit-msg.sh`                                | a git hook, not a Claude Code one                                                                                              |
| `dw-sdlc`                                            | a link to `packages/dw-sdlc`, the package the hooks and skills run; `claude plugin install` copies it as a real directory      |
| `skills/sdlc-<name>/`                                | the six skills                                                                                                                 |
| `agents/sdlc-reviewer.md`                            | the subagent of a `light` Review, spawned as `sdlc:sdlc-reviewer`                                                              |
| `test/`                                              | the hook tests, mirroring `hooks/`, and the manifest's                                                                         |

The dispatcher reads stdin once, drops heredoc bodies once but for the substitutions an unquoted one
runs, and spawns each guard only when the command could trip it. A payload it cannot read, not JSON
or holding U+0001 (the byte its reader splits fields on), is refused with exit 2 and a message saying
why, since no guard could judge it. A refusal from one guard ends the chain; an ask waits for every
guard, so a later refusal still wins.

Inside the `dw-sdlc` link, `src/cli.ts` is the bin and each subcommand is a module under
`src/commands/`. `src/agentic-config.ts` resolves the layers, `src/json-schema.ts` is the
dependency-free schema validator, and `src/pr/` holds the read and the decision of the Ship script.
For References, `src/references-key.ts` parses `.ai/references.json`, `src/pins.ts` resolves a ref's
`{name}`, `src/router-block.ts` writes the Router's block, and `templates/router.md` is the Router the
setup writes. The schemas are under `config/`.

## Tests

`pnpm test` runs every test on `node:test`, a file per process, as part of `pnpm check`. jq is a hard
requirement: without it the harness fails loudly instead of passing empty.

| test                                  | holds                                                                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/hooks/<guard>.test.ts`          | each guard, spawned on the real stdin payload, its exit code and verdict; `test/harness.ts` is the shared part, and every input is built in a scratch directory                                          |
| `test/hooks/config.test.ts`           | the jq copy of the config contract, `lib.sh` against the package's resolver on the same cases                                                                                                            |
| `test/hooks/command-position.test.ts` | every rule through the dispatcher, bare and behind each launcher family                                                                                                                                  |
| `test/hooks/lib.test.ts`              | the word reader and the boundary to every launcher spelling                                                                                                                                              |
| `test/hooks/references-sync.test.ts`  | the Sync hook on a `SessionStart` payload; `test/references-harness.ts` spawns it as Claude Code does, on the package's harness, which builds throwaway repositories apart from the machine's git config |
| `test/manifest.test.ts`               | the manifest against the tree, below                                                                                                                                                                     |
| `test/skill-lines.test.ts`            | each `dw-sdlc` line a SKILL.md runs, against the bin's `--help`                                                                                                                                          |

The manifest test holds:

- each hook script wired to its event and matcher, run by the dispatcher or left to git;
- each skill under its name, with every plugin path it runs on disk, and left for the user to invoke,
  but three: `sdlc-pr-open`, whose description triggers on opening a pull request and writing its
  body, and `sdlc-pr-ship` and `sdlc-sweep`, which hold the model to a Brief or the dev's "go";
- `sdlc-sweep` running the bin through the link and never a kept item's command;
- each subagent under its name, at medium effort on the session's model, with no tool that edits a file;
- the link to the package, and the marketplace listing this plugin at the manifest's version.

The commands' tests sit beside the package's code, in its `test/commands/`: `setup`, `doctor` and
`config`, `references-sync.test.ts`, which drives the Sync against upstreams served over `file://`, and
`references-setup.test.ts`, the setup with `--root`. `test/references-key.test.ts` runs one case list
through the file's parser and its schema.
