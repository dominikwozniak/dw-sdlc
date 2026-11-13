---
status: accepted
---

# The Bash guards keep the word walker; sh-syntax is measured and not taken

A real shell parser was to replace or back the word walker only if it is a pinned npm dependency of
the `dw-sdlc` package, adds at most about 50 ms median to one Bash call with its cold start, and
leaves the guards running on bash and `jq` alone when it is absent. `sh-syntax` 0.8.0, mvdan/sh built
to WASM, meets the cost bound: 34 ms a fresh process, 13 ms over a bare `node`. It reads every
#318 payload of the causes a parser closes, and it brings 65 of those 80 out whole, as the simple
command bash runs. But the walker already refuses the 35 payloads of `F01`, `F13` and `F24`, the
causes #318 holds a guard to. The 30 the parser adds are Known limits of `F14`, `F18`, `F19`, `F20`
and `F25`, spellings only a deliberate evasion writes, which ADR 0017 keeps outside a guard's job. With the walker staying as the
fallback, every rule still lands in it, and the parser adds a second reader, a dependency the package
does not have (ADR 0008) and a way to install it into the plugin. So the walker stays the one reader,
and no parser is taken.

## Measurement

Measured on 2026-11-13 at `c8f9c65` with `sh-syntax` 0.8.0, Node 24.22.1, `/bin/bash` 3.2.57, macOS
27.0.1 on an Apple M5 Pro. `sh-syntax` sits in an empty directory outside the repository, installed
with `pnpm add sh-syntax@0.8.0 --save-exact --ignore-scripts --config.minimum-release-age=0`: the
release, published 2026-11-07, was younger than 7 days, and the dev lifted that rule for this one
install. It has no runtime
dependency and no install script; it unpacks to 872 KB, 768 KB of it `main.wasm`.

`med15 <command>` spawns the command 16 times from one Node process, drops the first run and prints
the median wall time of the other 15, each a cold start. `PARSE` is
`import { parseSync } from "sh-syntax"; parseSync(process.argv[1])`. The chain is
`git fetch origin && git status --short && git log --oneline -5`; the heredoc commit is
`git commit -m "$(cat <<'EOF' … EOF)"` with a 36-line body, 43 lines and 2277 bytes in all. The
dispatcher reads a PreToolUse payload of the same command on stdin, its `cwd` a throwaway repository
holding this repository's config and an uncommitted change. Each range spans three rounds.

| what                                | median         | command                                                           |
| ----------------------------------- | -------------- | ----------------------------------------------------------------- |
| a bare `node`                       | 21.1–21.8 ms   | `med15 node -e ''`                                                |
| `sh-syntax`, `git status`           | 33.6–33.9 ms   | `med15 node --input-type=module -e "$PARSE" 'git status'`         |
| `sh-syntax`, the chain              | 33.6–34.1 ms   | the same, on the chain                                            |
| `sh-syntax`, the heredoc commit     | 34.4–34.7 ms   | the same, on the heredoc commit                                   |
| `bash-guard.sh`, `git status`       | 50.6–52.2 ms   | `STDIN=$payload med15 /bin/bash plugins/sdlc/hooks/bash-guard.sh` |
| `bash-guard.sh`, the chain          | 51.6–52.2 ms   | the same, on the chain                                            |
| `bash-guard.sh`, the heredoc commit | 255.5–260.0 ms | the same, on the heredoc commit                                   |

Inside one process the import takes 4.8–4.9 ms, the first parse 5.6–5.8 ms (the WASM compile and a Go
runtime start), and a second parse 0.2 ms.

The payloads are those of #318 for the eight causes, read verbatim from its body. A payload comes out
whole when it parses and one simple command of the tree, its words after quote removal, starts with
the words bash runs. For `F01` that is `git push origin «$(…)» --force` as one command. A literal
after `sh`, `bash`, `zsh` or `dash` with `-c` is parsed again, the one rule kept beside the parser.
The walker column sends each payload to `bash-guard.sh` and counts exit 2.

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

The 15 `F19` payloads that are not whole parse into the words bash passes, and a rule still has to
read them: `command --`, `nohup --`, `eval --`, `rtk proxy --`, `env -`, `env -S`, a second
`find -exec`, and brace expansion, which bash performs after parsing and `sh-syntax` leaves as one
word. Version 0.8.0 misreads no payload, so no later 0.8.x is measured. The scripts behind the reading
table are in the pull request that adds this record.

## Considered Options

`sh-syntax` 0.8.0 read before the walker, the walker its fallback, is rejected. It meets the second
and third bounds. The first bound holds for the package, which would carry it pinned, but not for the
plugin, where the guards run. Claude Code installs a plugin's Node dependencies only from an npm or
Bun lockfile at the plugin's root and skips `pnpm-lock.yaml`, so the plugin would carry an npm lockfile
in a pnpm-only repository, or install the parser itself into `${CLAUDE_PLUGIN_DATA}`. Wherever that
install fails, or never runs, as for a plugin loaded in place from a local marketplace, the walker
reads alone. The parser replacing the walker fails the third bound. Every other parser stays as
#331's evidence leaves it: shfmt is a system binary, tree-sitter's bash grammar misreads `<<E"O"F`
and `coproc`, and bash-parser has had no release since 2017.

## Consequences

Each fix of a guard keeps landing in the walker, with a regression test per payload, and the Known
limits of `F14`, `F18`, `F19`, `F20` and `F25` stay listed in the plugin's README. A Bash call pays
for no Node process. The choice reopens when the second adversarial pass of #318 finds 5 or more new
causes an agent writes in ordinary work, or when ADR 0017 holds the guards to deliberate evasion. A
new measurement starts from these bounds and these figures.
