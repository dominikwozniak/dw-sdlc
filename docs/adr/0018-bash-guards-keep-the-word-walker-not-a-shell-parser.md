---
status: accepted
---

# The Bash guards keep the word walker; sh-syntax is measured and not taken

A real shell parser can back the word walker under three bounds: it is a pinned npm dependency of
the `dw-sdlc` package, it adds at most about 50 ms median to one Bash call with its cold start, and
the guards still run on bash and `jq` alone when it is absent. `sh-syntax` 0.8.0, mvdan/sh built to
WASM, meets all three for the package: it costs 34 ms a fresh process, 13 ms over a bare `node`. Of
the 80 #318 payloads of the causes a parser closes, it reads all 80 and brings 65 out whole, as the
simple command bash runs. The choice rests on what lies past the bounds. The walker already refuses
the 35 payloads of a substitution, a shell by path and a heredoc delimiter, the causes #318 holds a
guard to. The 30 the parser adds are Known limits, spellings only a deliberate evasion writes, which
ADR 0017 keeps outside a guard's job. The walker stays as the fallback, so every rule still lands in
it. The parser would add a second reader, a runtime dependency the package does not have (ADR 0008)
and a way to install it into the plugin. So the walker stays the one reader, and no parser is taken.

## Measurement

Measured on 2026-11-13 at `c8f9c65` with `sh-syntax` 0.8.0, Node 24.22.1, `/bin/bash` 3.2.57, macOS
27.0.1 on an Apple M5 Pro. `sh-syntax` sits in an empty directory outside the repository, installed
with `pnpm add sh-syntax@0.8.0 --save-exact --ignore-scripts --config.minimum-release-age=0`. The
release is from 2026-11-07, younger than the 7 days the repository asks for, and the install is a
one-time exception the dev granted. It has no runtime dependency and no install script; it unpacks
to 872 KB, 768 KB of it `main.wasm`.

`med15 <command>` spawns the command 16 times from one Node process, drops the first run and prints
the median wall time of the other 15, each a cold start. `PARSE` is
`import { parseSync } from "sh-syntax"; parseSync(process.argv[1])`. It only parses, so its figure is
a floor: handing the words back to bash adds to it. The chain is
`git fetch origin && git status --short && git log --oneline -5`. The heredoc commit is
`git commit -m "$(cat <<'EOF' … EOF)"` with a 36-line body, 43 lines and 2277 bytes in all. The
dispatcher reads a PreToolUse payload of the same command on stdin. Its `cwd` is a throwaway
repository holding this repository's config and an uncommitted change. Each range spans three rounds
of `run-timing.sh <sh-syntax dir> <checkout> <repository>`; a later round lands within 1 ms of them.

| what                                | median         | command                                                           |
| ----------------------------------- | -------------- | ----------------------------------------------------------------- |
| a bare `node`                       | 21.1–21.8 ms   | `med15 node -e ''`                                                |
| `sh-syntax`, `git status`           | 33.6–33.9 ms   | `med15 node --input-type=module -e "$PARSE" 'git status'`         |
| `sh-syntax`, the chain              | 33.6–34.1 ms   | the same, on the chain                                            |
| `sh-syntax`, the heredoc commit     | 34.4–34.7 ms   | the same, on the heredoc commit                                   |
| `bash-guard.sh`, `git status`       | 50.6–52.2 ms   | `STDIN=$payload med15 /bin/bash plugins/sdlc/hooks/bash-guard.sh` |
| `bash-guard.sh`, the chain          | 51.6–52.2 ms   | the same, on the chain                                            |
| `bash-guard.sh`, the heredoc commit | 255.5–260.0 ms | the same, on the heredoc commit                                   |

Inside one process, `node breakdown.mjs 'git status'` gives 4.8–4.9 ms for the import, 5.6–5.8 ms
for the first parse (the WASM compile and a Go runtime start) and 0.2 ms for a second parse.

`node extract.mjs 318.md payloads.json` reads the payloads of the eight causes verbatim from #318's
body. `node correct.mjs payloads.json out.json` parses each one. A payload comes out whole when one
simple command of the tree, its words after quote removal, starts with the words bash runs: for a
substitution, `git push origin «$(…)» --force` as one command. A literal after `sh`, `bash`, `zsh` or
`dash` with `-c` is parsed again, the one rule kept beside the parser.
`node walker.mjs plugins/sdlc/hooks <repository> payloads.json out.json` sends each payload to
`bash-guard.sh` and counts exit 2. Every payload runs in the one throwaway repository, on a branch
`feat`, where #318 sent six of them to three other repositories.

| cause                               | payloads | `sh-syntax` whole | walker refuses |
| ----------------------------------- | -------- | ----------------- | -------------- |
| `F01` args after a substitution     | 21       | 21                | 21             |
| `F13` a shell by path               | 10       | 10                | 10             |
| `F24` a heredoc delimiter           | 4        | 4                 | 4              |
| `F14` a shell two levels deep       | 1        | 1                 | 0              |
| `F18` a quoted command name         | 14       | 14                | 0              |
| `F19` launcher forms                | 19       | 4                 | 0              |
| `F20` a redirection before the verb | 8        | 8                 | 0              |
| `F25` a shift read as a heredoc     | 3        | 3                 | 0              |
| all                                 | 80       | 65                | 35             |

The 15 launcher payloads that are not whole parse into the words bash passes, and a rule still has
to read them: `command --`, `nohup --`, `eval --`, `rtk proxy --`, `env -`, `env -S`, a second
`find -exec`, and brace expansion, which bash performs after parsing and `sh-syntax` leaves as one
word. Version 0.8.0 misreads no payload, so no later 0.8.x is measured. The scripts are in the pull
request that adds this record.

## Considered Options

`sh-syntax` 0.8.0 read before the walker, the walker its fallback, is rejected. It meets the cost
bound and the fallback bound. The dependency bound holds for the package, which would pin it, but
not for the plugin, where the guards run. Claude Code installs a plugin's Node dependencies only from
an npm or Bun lockfile at the plugin's root and skips `pnpm-lock.yaml`. So the plugin would carry an
npm lockfile in a pnpm-only repository, or install the parser itself into `${CLAUDE_PLUGIN_DATA}`.
Wherever that install fails or never runs, as for a plugin loaded in place from a local marketplace,
the walker reads alone. The parser replacing the walker fails the fallback bound. Every other parser
stays as #331's evidence leaves it: shfmt is a system binary, tree-sitter's bash grammar misreads
`<<E"O"F` and `coproc`, and bash-parser has had no release since 2017.

## Consequences

Each fix of a guard keeps landing in the walker, with a regression test per payload. The plugin's
README keeps listing as Known limits a shell two levels deep, a quoted command name, the launcher
forms, a redirection before the verb and a `<<` inside `$(( ))`. A Bash call pays for no Node
process. The choice reopens when the second adversarial pass of #318 finds 5 or more new causes an
agent writes in ordinary work. A new measurement starts from these bounds and these figures.
