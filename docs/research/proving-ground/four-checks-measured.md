# The four candidate Checks measured on the Foundation and dw-sdlc trees

Read on 2026-10-30; trees at dw-sdlc `69b96f4`, Foundation `main` `4593270`, Foundation worktree
`humming-giggling-star` `b7746c9` (branch `build/gate-checks-on`, PR #33, merged). PR #32, the Gate
adoption, is merged into Foundation `main` (head `f5c2782`). The two Foundation trees hold the same
`AGENTS.md`, `README.md`, `package.json`, `.ai/agentic.config.json`, `docs/` and workflow, so every
Foundation column below reads the same for both.

Method: throwaway scripts (Node 24, no dependencies) walk a tree minus what its root `.gitignore`
ignores, as `packages/dw-sdlc/src/checks/tree.ts:12` does, and read markdown as
`packages/dw-sdlc/src/markdown.ts` does: fenced lines skipped, one span per backtick pair, Task
Router rows by heading. Foundation is read only; nothing ran there.

## Summary

| Check                  | dw-sdlc                                                                 | Foundation (`main` = worktree)                             | Noise seen                                                                                         |
| ---------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1 commands in the map  | 1 of 29 fenced commands: `pnpm changeset`                               | 0 of 3 fenced, 0 of 15 inline `pnpm` spans                 | `\|` inside `[--dry-run \| --check]` read as a pipe; tree diagrams in bare fences; `<placeholder>` |
| 2 paths in inline code | `AGENTS.md`: 27 hits, 0 stale; all 35 docs: 579 of 873                  | `AGENTS.md`: 1 hit, 0 stale; all 17 docs: 32 of 95         | 9 classes below; under 10 % of hits name a path that once existed                                  |
| 3 generated drift      | `references setup --check` exit 0, 5 files unchanged                    | not run; CI detects with `git diff --exit-code`            | none measured                                                                                      |
| 4 Router coverage      | direct rows: 11 of 24 unreachable; via links: 6; anywhere in the map: 0 | no Task Router: 8 of 8 unreachable; anywhere in the map: 0 | a `**/` span in prose expands to every doc                                                         |

Verdict for the map: Foundation fails Router coverage under any rule that reads Router rows. dw-sdlc
fails it under the direct and the linked rule, and fails the commands rule only when the rule knows
scripts but not bins. The paths rule is noise on both trees. Drift is a Gate Step on both.

## 1. Commands in the map resolve

Rule tested: each line of a fenced block with no language or a shell one, in `AGENTS.md` and in the
docs its Task Router names, split on `&&`, `;`, `|`; the head word is a `package.json` script, a bin,
or a common tool; `pnpm <x>` is a script or a pnpm builtin, `pnpm exec <x>` a bin, `node <file>` a file.

- dw-sdlc, 29 commands over `AGENTS.md` and 16 Router docs: `AGENTS.md:100` `pnpm changeset` has no
  script in `package.json:5-14`; the `changeset` bin of `@changesets/cli` (`package.json:16`) answers
  it, as pnpm runs a bin when no script matches (`pnpm/docs/pnpm-cli.md`, read through `ctx7`). The
  inline rule finds the same span at `docs/overview.md:264` and the placeholder `pnpm store:<name>`
  at `plugins/sdlc/README.md:130`. Bins read from the main checkout's `node_modules/.bin`: the
  worktree has none.
- Foundation: `README.md:62-64` holds the only fenced commands, `pnpm build`, `pnpm changeset
  publish-plan`, `pnpm changeset pack`, all scripts (`package.json:8,15`). `AGENTS.md` has no fence.
- grateful-me: `scripts/check-agents-docs.mjs:223-228` requires every `pnpm <name>` in `AGENTS.md` to
  be a script, builtins excepted; it would flag `pnpm changeset` here.

## 2. Paths in inline code resolve

Rule tested: `agents-map.ts:35-37` (`isPath`: no spaces, only `[\w.*/-]`, a slash or an extension),
then `existsSync` or a glob match from the root. First five hits per tree, then the classes.

- dw-sdlc `AGENTS.md`: `:11` `src/`, `:12` `cli.ts`, `:13` `commands/`, `:18` `dist/`, `:30`
  `.git/info/exclude`. All 27 are a child named after its parent, a bare file name, an ignored or
  machine-local file, a slash command or `owner/repo`. `CLAUDE.md` doubles them: a Check dedupes the
  link as `tree.ts:29-38` does.
- dw-sdlc, all docs: 579 hits. The ones that name a path that once existed:
  `docs/specs/agentic-guardrails.md` has 40 spans under `plugins/guardrails/` and `test/scripts/`
  (`:154`, `:177`, `:181-261`), the layout before `plugins/sdlc/` and `packages/dw-sdlc/`;
  `docs/adr/0001-guards-ship-from-this-marketplace.md:8` `plugins/guardrails/`. Both are records.
- Foundation: `AGENTS.md:7` `byarcadia-app/foundation`, `README.md:20` `.d.ts`, `:26`
  `core.hooksPath`, `:35` `test/`, `:38` `../../tsconfig.base.json`. The one stale path:
  `.github/PULL_REQUEST_TEMPLATE.md:12` `.claude/hooks/sync-references.sh`, an example inside an HTML
  comment; the tree has no `.claude/hooks/`.
- grateful-me: `check-agents-docs.mjs:94-98` matches only `docs/agents/`, `docs/product/`,
  `references/` `.md` paths and `docs/design/` boards, at a token start; `:104-109` checks them over
  `AGENTS.md` minus its Skills table (`:209-212`); `:201-207` reads Router cells and keeps a span
  only when it ends in `.md` or `/`. `scripts/check-paths.mjs:1-13` is a unit test of
  `src/modules/questions/utils/paths.ts`, not a docs check.

## 3. Generated files do not drift

- dw-sdlc: `node packages/dw-sdlc/src/cli.ts references setup --check` exits 0 and reports
  `references/AGENTS.md`, `references/CLAUDE.md`, `.claude/settings.json`, `.gitignore` and
  `.ai/agentic.config.json` unchanged. The Gate runs it as a Step (`.ai/agentic.config.json:16`); CI
  runs the Gate (`.github/workflows/quality-gate.yaml:38`) and nothing else. `dist/` is ignored.
- Foundation, from its files: `pnpm build` is `pnpm -r run build` (`package.json:8`), `vp pack` per
  Package (`packages/*/package.json`), which rewrites each Package's `exports` (`pack.base.ts:10`,
  `AGENTS.md:36`, `README.md:46`); `pnpm references:setup` rewrites the Router (`package.json:17`).
  Detection: `pnpm check` (`.github/workflows/quality-gate.yaml:53`) is `dw-sdlc gate`
  (`package.json:18`) with the Steps `pnpm references:setup --check` and `pnpm build`
  (`.ai/agentic.config.json:11-16`), then `git diff --exit-code` (`quality-gate.yaml:58`) fails on a
  tracked file the build changed. A local `pnpm check` has no diff step, so a stale `exports` passes
  locally and fails in CI. Whether the tree drifts today is not verified: the build did not run.
- grateful-me: `scripts/check-generated.mjs:17-24` lists each generated file with the script that
  writes it, `:35-53` runs the generator, compares bytes and restores the file, `:61-78` runs the
  generators that check themselves with `--check` (the shape of `references:setup --check`); `:1-2`
  says why it is not `git diff --exit-code`.

## 4. Every doc is reachable from the Task Router

Three rules: A, named in a Router row (a directory or glob names what it holds); B, A or linked from
a doc A reaches, by a markdown link or a backticked file path, to a fixpoint; C, B with every
backticked path anywhere in `AGENTS.md` as a root.

- dw-sdlc: 7 rows (`AGENTS.md:109-115`), 24 docs. A leaves 11 unreachable: `docs/agents/domain.md`
  and the 10 under `docs/research/`. B leaves 6: `docs/research/agentic-guardrails/claude-code.md`,
  `docs/research/gate/{claude-code,gate,kcd-skills,open-mercato-skills,own-repositories}.md`;
  `docs/overview.md` names `kody.md` and `toolchain.md`, `docs/specs/agentic-guardrails.md:212-214`
  the two agentic-guardrails notes, `AGENTS.md:121` `docs/agents/domain.md`. C leaves 0. Letting a
  directory or glob span in prose expand makes B reach 24 of 24, through the `**/` span of
  `plugins/sdlc/README.md`: that rule measures nothing.
- Foundation: `AGENTS.md` has no `Task Router` heading, so `tableRows` (`markdown.ts:74-79`) yields
  no row and `agents-map` (`agents-map.ts:60-74`) has nothing to judge. A and B leave 8 of 8
  unreachable. C leaves 0: `AGENTS.md:7` `docs/agents/issue-tracker.md`, `:11`
  `docs/agents/triage-labels.md`, `:15` `docs/adr/` and `docs/agents/domain.md`.
- grateful-me: `check-agents-docs.mjs:164-166` passes a `docs/agents/*.md` when `AGENTS.md` contains
  its path anywhere (rule C); `:523-529` requires every references map linked from
  `references/AGENTS.md`.

## Heuristics that produced false positives

Counts are dw-sdlc all docs / Foundation all docs, under the strict span rule.

| class                                             | hits    | examples                                                                        |
| ------------------------------------------------- | ------- | ------------------------------------------------------------------------------- |
| child named after a directory earlier in the text | 109 / 2 | `src/`, `commands/`, `hooks/lib.sh`, `test/`, `workflows/release.yaml`          |
| bare file name that exists elsewhere              | 81 / 5  | `cli.ts`, `lib.sh`, `agentic.config.json`, `release.yaml`, `CHANGELOG.md`       |
| dotted identifier                                 | 112 / 6 | `gate.checks.run`, `core.hooksPath`, `error.code`, `.envrc`                     |
| bare name or extension that exists nowhere        | 53 / 5  | `.env`, `.ts`, `.d.ts`, `.sh`, `GLOSSARY-MAP.md` (an optional file)             |
| slash command or home path                        | 25 / 6  | `/sdlc-setup`, `/triage`, `/code-review`                                        |
| `owner/repo`, rule id, git ref                    | 18 / 3  | `dominikwozniak/dw-sdlc`, `unicorn/no-array-sort`, `origin/HEAD`, `refs/heads/` |
| version                                           | 15 / 0  | `v1.2.3`                                                                        |
| glob with no match                                | 6 / 0   | `**/`, `docs/**/*.md` in an exempt list                                         |
| relative from a package directory                 | 1 / 2   | `../../tsconfig.base.json`, `../../pack.base.ts`                                |

Beyond the span shape, four scopes make a path unresolvable by design:

- machine-local, ignored or runtime files the docs describe: `.ai/agentic.config.local.json`,
  `.claude/settings.local.json`, `.git/info/exclude`, `dist/`, `references/.sync.lock`;
- docs that describe other trees: `docs/research/` (202 hits, `R/dw-solo-skills/templates/hooks/`),
  `plugins/sdlc/skills/sdlc-references-add/SKILL.md` (`pstack/`, `harness/pstack/`, `vendor/`);
- records that name a past layout: `docs/specs/agentic-guardrails.md` (40), `docs/adr/0001` and
  `0007` (`.ai/references.json`, a rejected alternative);
- paths inside HTML comments and fenced examples: Foundation's PR template.

A looser rule (any span with a slash or an extension) adds 113 / 17 spans, all noise: placeholders
(`docs/research/<feature>/`, `packages/<name>/`), URLs, npm scopes (`@byarcadia-app/*`), home paths.

For the commands rule: a `|` between options in brackets is not a pipe; a fence with no language may
hold a tree diagram (`docs/agents/domain.md:17-39` in Foundation, 16 lines); a `/skill` line is not a
command; `node <plugin root>/...` is a placeholder.
