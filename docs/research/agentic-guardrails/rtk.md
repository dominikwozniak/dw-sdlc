# RTK 0.45.0 — how the rewrite hook behaves

Dry runs with `rtk hook check` on 2026-09-23, plus `docs/contributing/TECHNICAL.md` of `rtk-ai/rtk`.

## Rewrites observed

| command                                        | rewritten to                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `git status --short`                           | `rtk git status --short`                                                                                        |
| `git push --force-with-lease origin feature-x` | `rtk git push --force-with-lease origin feature-x`                                                              |
| `git -C ../other status`                       | `rtk git -C ../other status`                                                                                    |
| `git commit -m "fix: a && b \| c"`             | `rtk git commit -m "fix: a && b \| c"` (quotes respected)                                                       |
| `git status && git diff --stat`                | `rtk git status && rtk git diff --stat`                                                                         |
| `cd sub && git status`                         | `cd sub && rtk git status`                                                                                      |
| `gh pr create --title x --body y`              | `rtk gh pr create --title x --body y`                                                                           |
| `gh pr view 981 --json title`                  | no rewrite (`--json`/`--jq`/`--template` guard)                                                                 |
| `pnpm install`                                 | `rtk pnpm install`                                                                                              |
| `grep -rn "token" app/`                        | `rtk grep -rn "token" app/`                                                                                     |
| `find . -name '*.rb' -exec grep -l foo {} \;`  | `rtk find …`, which below 0.46.0 refuses `-exec` with exit 1; such a machine names `find` in `exclude_commands` |
| `cat .env.development`                         | `rtk read .env.development`                                                                                     |
| `rm -rf tmp/cache`                             | no rewrite                                                                                                      |
| `RTK_DISABLED=1 git status`                    | no rewrite, with the message "RTK_DISABLED=1 detected — skipping filter for this command"                       |

Engine rules from `docs/contributing/TECHNICAL.md`: `&&`, `||`, `;` rewrite both sides; a pipe keeps
intermediate stages raw and `|&` keeps the whole pipeline raw; a command containing `<<` or `$((` is
skipped; `cat`/`head`/`tail` with a write redirect are skipped; an unknown command is skipped; an env
prefix is extracted and re-prepended. The rule table lives in the binary
(`^(?:git|yadm)\s+(?:-[Cc]\s+\S+\s+)*(status|log|diff|show|add|commit|checkout|push|pull|branch|fetch|stash|worktree)`
→ `rtk git`, and so on). `exclude_commands` matches partially per the README ("matches `npx playwright`
too").

Consequences for the design: hooks run in parallel, so the guards judge the original command and never
see the rewrite; permission rules judge the rewritten command, and `rtk` is not on Claude Code's
stripped-wrapper list, so every allow rule needs both spellings — generated, not typed. The worktree
isolation check refuses `rtk git …` — re-probed on 2026-09-25 with Claude Code 2.1.282 and rtk 0.49.0,
after the 2.1.259 changelog entry about "launcher-wrapped commands": `claude -p -w` with a project
`settings.json` wiring `rtk hook claude` refuses `git status --short` ("runs rtk with a git command
among its operands: what runs it, and from which directory or root, cannot be read here"), and the
same session with no hook runs it — so the plugin's `rtk-rewrite.sh` skips the rewrite for a git
command in a linked worktree. `RTK_DISABLED=1` is the per-command escape hatch as a command prefix
only; set in the hook's environment it changes nothing. The guards' `VAR=x` wrapper handling already
sees through it.

`[hooks] exclude_commands` on a machine running the guards: `find` below rtk 0.46.0, an anchored
`^<entry>($|\s)` over one segment; the doctor checks it. Why, with source lines: `agentic-guardrails.md`,
verification 2.
