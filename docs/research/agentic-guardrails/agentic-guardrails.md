# Research — agentic guardrails

Verified findings behind `docs/specs/agentic-guardrails.md`. Everything here was read or run on
2026-09-23 (Claude Code 2.1.280, macOS) unless a line says otherwise. `R/` is `references/` in this
repo, cloned by `pnpm references:sync`; a cited path is as it read on that date. A line that could not
be verified sits under Still open, not among the findings. The facts behind the decisions are split by
topic: `claude-code.md`, `rtk.md`.

## The predecessor hooks, audited

The audited files are `R/dw-solo-skills/templates/hooks/`, wired per machine in `~/.claude/settings.json`:
PreToolUse `Bash` → the rtk shim, then `bash-guard.sh`; PreToolUse on the file tools →
`block-env-access.sh`; PostToolUse `Write` → `large-file-guard.sh`. No `permissions.allow`, `ask` or
`deny` beside them, although every hook header names `permissions.deny` as "the jq-less backstop".

| file                                   | finding                                                                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash-guard.sh:11`                     | `command -v jq >/dev/null \|\| exit 0` — without `jq` every guard is a silent no-op                                                                                                                   |
| `bash-guard.sh:93-101`                 | trigger arms: `*npm* \| *npx* \| *yarn* \| *bun*` → `block-non-pnpm`; `*git*commit* \| *git*add*` → `enforce-commit-hygiene`; a guard's own self-test cannot see this list                            |
| `block-dangerous-commands.sh:67`       | `push( [^;&\|]*)?( --force\| -f\b)` — the comment says "incl. --force-with-lease"; lease pushes are refused by prefix                                                                                 |
| `block-dangerous-commands.sh:71`       | `git branch -f` refused; `git branch -D` deliberately not; `git worktree remove --force` not covered                                                                                                  |
| `block-env-access.sh:15-27`            | allowlist `.env.example`, `.env.sample`, `.env.template`; refuses every other `.env*` and `.envrc` by basename — including a repository's tracked `.env`, `.env.test`, and any `cp` of an env file    |
| `block-non-pnpm.sh:48-56`              | refuses `npm install\|i\|add\|ci\|update\|upgrade\|exec\|run`, every `yarn`, every `npx`, `bun install\|…`; global, no repo awareness                                                                 |
| `credential-leak-guard.sh:66-70`       | "DUPLICATED, NOT SHARED": `strip_heredocs` copied across guards because each is installed alone; "Nothing detects the drift"                                                                          |
| `enforce-commit-hygiene.sh:79-107`     | `resolve_declared` reads `- **Commit pattern**:` / `- **Commit trailer**:` from `AGENTS.md` or `CLAUDE.local.md`; a repository's own pattern has nowhere to live without touching a shared prose file |
| `large-file-guard.sh:18-19,39`         | PostToolUse, 256 KiB, `CLAUDE_MAX_WRITE_BYTES` override — the one guard with a kill switch                                                                                                            |
| `rtk-hook-guard.sh` (outside the repo) | in a linked worktree a command naming `git` bypasses `rtk hook claude`, because the isolation "command shape" check cannot read through `rtk`                                                         |

Design quality is high — quote-state machines, heredoc stripping, wrapper prefixes (`sudo`, `rtk …`,
`VAR=x`), fail-closed on unterminated quotes — and the defects above are all policy or distribution,
not parsing.

## Reference repositories

| repo                        | Claude Code hooks                                   | registered where                                                                                                 | reaches the user how                                 |
| --------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `R/open-mercato-skills`     | none                                                | —                                                                                                                | `npx skills add`                                     |
| `R/addyosmani-agent-skills` | 3 scripts in `hooks/`, not registered by the plugin | user pastes JSON into settings                                                                                   | marketplace, `npx skills add`, Codex/Gemini adapters |
| `R/mattpocock-skills`       | one guardrail script inside a `misc/` skill         | the skill copies it to `.claude/hooks/` and merges JSON by hand                                                  | official marketplace                                 |
| `R/dw-solo-skills`          | 10 templates                                        | `dw-init` copies into the consumer's tracked `.claude/hooks/` + `settings.json`; no plugin carries a `hooks` key | `dw-init` skill                                      |

- Open Mercato: `.ai/agentic.config.json` (`version`, `baseBranch: "auto"`, `tracker`,
  `validation.commands`, `labels`, `qaGate`, `paths`); read by a `jq` snippet copied into each of the
  42 skills (`skills/om-setup-agent-pipeline/references/agentic-setup.md:26-54`);
  `om-setup-agent-pipeline` refuses to clobber, detects defaults from the repo, offers `--defaults`;
  repo-local `.ai/skills/<name>/SKILL.md` overrides "cannot relax the installed skill's safety rules".
  Worktrees: detached under `.ai/tmp/<skill>/<slug>-<ts>`, env files never copied, cleanup with
  `git worktree remove --force`.
- dw-solo-skills: decisions `0010` (hook policies are declared bullets), `0014` (`templates/hooks/` is
  canon), `0021` (no git skill; `EnterWorktree` rejected "for now"), `0023` (hookify advisory only;
  guards "stay what they are: shell under `templates/hooks/`, copied byte-identical into
  `.claude/hooks/`, wired in tracked `settings.json`"). Every hook has `scripts/tests/<hook>.test.sh`
  and `hooks-in-sync.test.sh`; `doctor.sh` is 633 lines, read-only, FAIL on missing `jq`;
  `templates/settings.json` carries `ask`/`deny` lists;
  `templates/worktreeinclude.txt` exists, all patterns commented; `scripts/runtime/worktree.sh` creates
  at `.claude/worktrees/<slug>` and reproduces `.worktreeinclude` for `git worktree add`.
- mattpocock-skills: `block-dangerous-git.sh` refuses every `git push`; ADR 0002 notes Codex "drops
  symlinks" when copying a plugin tree. addyosmani: hook tests run in CI; one skill tree with per-agent
  adapters, versions locked by a script.
- superpowers (`obra/superpowers`): only a `SessionStart` hook injecting `using-superpowers/SKILL.md`
  as `additionalContext`; nothing guard-like.

## Supply-chain tooling

- Aikido Safe Chain 1.5.20 (`https://github.com/AikidoSec/safe-chain`): wraps npm, npx, yarn, pnpm,
  pnpx, rush, bun, bunx and pip, pip3, uv, uvx, poetry, pipx, pdm; installer drops a binary into
  `~/.safe-chain` and shell functions; `--ci` installs PATH shims; 48 h minimum age
  (`--safe-chain-minimum-package-age-hours`, `SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS`, `~/.safe-chain/config.json`);
  repo file `.aikido` for `customRegistries` and exclusions; verify with `npm safe-chain-verify`, test
  with `npm install safe-chain-test`.
- Socket MCP hook (`https://github.com/SocketDev/socket-mcp`): `~/.claude/hooks/socket-gate/socket-gate.cjs`,
  PreToolUse on Bash, intercepts `gem install`, `bundle add`, `npm install`, `pip install`, `cargo add`,
  `go get`, `dotnet add package`; queries `https://mcp.socket.dev/` via OAuth; denies when
  `supplyChain < 20`; "Network, timeout, or parse errors all fail open".
- pnpm policy in this repo (`pnpm-workspace.yaml`): `minimumReleaseAge: 10080` strict,
  `trustPolicy: no-downgrade`, `blockExoticSubdeps`, `strictDepBuilds`. A global
  `minimumReleaseAge=10080` extends the age gate to `pnpm dlx`, which applies it strictly
  (`ERR_PNPM_NO_MATCHING_VERSION` when the latest version is too young, no fallback — pnpm #10037,
  #14176).
- The Bash tool's shell is a zsh login shell with the profile loaded, so a Safe Chain installed as
  shell functions can reach the agent.

## Verifications

Answered on 2026-09-24 from the RTK source (`develop` and the `v0.45.0` tag) and from runs on rtk 0.45.0.

1. **`transparent_prefixes`** — `src/core/config.rs:123-141`: literal wrapper prefixes stripped
   before routing to a filter and re-prepended on the rewrite, so `docker exec c git status` becomes
   `docker exec c rtk git status` instead of passing through unrewritten. A prefix matches a command
   that starts with `"<prefix> "` or equals it; it extends the built-in list (`noglob`, `command`, …).
   Nothing here needs one.
2. **`rtk find -exec`** — the hook rewrites `find . -name '*.rb' -exec grep -l foo {} \;` to
   `rtk find …`, and 0.45.0 then refuses: "rtk find does not support compound predicates or actions
   (e.g. -not, -exec). Use `find` directly.", exit 1, the original never runs. v0.46.0 onwards lists
   `-exec` among `VERBATIM_ACTIONS` (`src/cmds/system/find_cmd.rs`) and passes it through. Remedy
   below 0.46.0: `exclude_commands` for `find`; the doctor's rtk check names it as missing only there.

`exclude_commands` semantics (`src/discover/registry.rs:1540`, confirmed with `rtk hook check` on
0.45.0): each entry becomes the anchored regex `^<entry>($|\s)` over one command segment after the
env-assignment prefix is stripped — `find` excludes `find …` and `cd sub && find …` but not
`grep -rn find src/`. An entry that starts with `^` is taken as a regex verbatim.

Still open:

3. Safe Chain in the agent shell after install: alias route vs `--ci` shims, and PATH order against
   mise shims.
4. Whether the model sees RTK's rewritten command: the hooks doc says `updatedInput` is what runs;
   RTK's README says "the agent doesn't know".
5. `pnpm dlx` outside any repo under the global `minimumReleaseAge`.
