# dw-sdlc — agent rules

> `CLAUDE.md` is a symlink to this file — edit `AGENTS.md` directly.

Claude Code tooling that holds Dominik's agentic workflow where the Engineering skills leave it loose:
guards on every tool call, a Gate that proves a change, and the road from a pull request to merged. It
extends those skills and replaces none. `README.md` is the front page, `docs/overview.md` how it works,
`docs/contributing/` how this repository is built and released.

## Project map

- `packages/dw-sdlc/` — the `dw-sdlc` package: `src/cli.ts` the bin, one row per subcommand, each a
  module under `src/commands/`; one module per Check under `src/checks/`; `src/pr/` the Ship script,
  `src/worker/` the herdr calls; `config/` the JSON Schemas of `.ai/*.json`; `templates/` the Router
  the setup writes; `test/` the bin spawned on a throwaway repo and the packed tarball
- `plugins/sdlc/` — guards, session hooks, the Sync, six skills and the `sdlc-reviewer` agent, as
  `docs/contributing/plugin-internals.md#layout` lists; `dw-sdlc` links the package its hooks and skills run;
  `test/` mirrors `hooks/`
- `plugins/sdlc-sessions/` — the session skills, depending on `sdlc`: `skills/`, `templates/brief.md`
- `.ai/` — `agentic.config.json`, this repo's agent rules against the package's schema;
  `references.json`, the References it reads; `primitives.json`, the catalogue of what this repo
  exposes to an agent, held to the tree by the `primitives` Check; `file-size-ratchet.baseline.json`,
  the files the Ratchet lets stay over limit (`agentic.config.local.json`, one machine's layer, git-excluded)
- `.claude/settings.json` — tracked; turns the dw-solo plugins off here, keeps the clones'
  `CLAUDE.md` and `AGENTS.md` out of context. `.claude/settings.local.json` is one machine's
  permission backstop, git-excluded; a worktree reads it and the local config from the main checkout
- `.agents/skills/` — the Engineering skills it works with, pinned in `skills-lock.json`;
  `.claude/skills/` links them
- `docs/agents/` — how those skills use this repo: issue tracker, domain docs
- `docs/overview.md` — how it works, for a user; `docs/contributing/` — development, how a change lands,
  releasing, the bash guard's parser, the plugin's internals, evals
- `docs/adr/` — decision records; `docs/specs/` — a built feature's design record;
  `docs/research/<feature>/` — the dated outside facts it rests on. New work goes in GitHub Issues
- `GLOSSARY.md` — what a word means here
- `references/` — repositories cloned per machine for reading, never tracked; the Router is
  `references/AGENTS.md`, its table written from `.ai/references.json`; the Sync hook fetches them
- `ideas/` — local-only notes, gitignored
- `.github/` — `workflows/quality-gate.yaml` runs `pnpm check` on a pull request once it is out of
  draft and on a push to `main` that is not a squash merge; `workflows/release.yaml` turns
  `.changeset/` into a version pull request and, once it merges, publishes to npm

## Never

- Never edit, build, lint, or import from `references/` — read-only clones.
- Never point tracked files at `ideas/` — its contents exist on one machine only.

## Tooling

- **pnpm only**, pinned in `package.json` — never `npm`, `npx`, `yarn` or `bun`; one-off tools via
  `pnpm dlx`. Dependencies are pinned exactly; `pnpm-workspace.yaml` refuses versions younger than 7 days.
- **TypeScript runs natively on Node 24** — `node packages/dw-sdlc/src/cli.ts <command>`, no build
  step; only `pnpm pack` runs tsc, for the JavaScript the package ships to npm.
  Erasable syntax only (no `enum`, `namespace` or parameter properties), and relative imports keep
  the `.ts` extension.
- **Formatting, import order, lint and the type check belong to Vite+**, configured in `vite.config.ts`.
  The pre-commit hook runs `vp staged`: `vp lint --fix` and `vp fmt` on the staged files.
- **External actions are pinned** to a full commit SHA with a `# vX.Y.Z` comment.
- **A skill the plugin ships is named `sdlc-<verb>`, or `sdlc-<area>-<verb>`**, as `sdlc-setup` and
  `sdlc-references-add`, so the skills group in the slash menu and never collide with dw-solo's `dw-*`.
- **Tests pin the words of a skill.** `plugins/*/test/manifest.test.ts` holds each description and
  frontmatter, and `plugins/sdlc/test/skill-lines.test.ts` each `dw-sdlc` line a SKILL.md runs to the
  bin's `--help`. A changed description or command line changes its test in the same commit.
- **This session's guards run from the installed plugin**, not this tree. A guard you edit takes
  effect after a release and `claude plugin update`; until then `pnpm test` is its only proof.

## Git

- Subjects follow Conventional Commits and every commit carries a `Co-Authored-By` trailer; the
  guards enforce both from `.ai/agentic.config.json`. `.vite-hooks/commit-msg` checks the subject of
  every commit, a terminal's included. `pnpm install` installs it and the pre-commit hook.
- `main` is a protected branch: a change reaches it through a pull request, after `pnpm check` passes
  in CI, as GitHub's `main` ruleset asks; the admin bypasses it. For a small fix the agent commits on
  `main` and the push comes from Dominik's terminal, which the guards skip.
- `pr.merge` is `auto` here: the Ship script merges a pull request it finds ready, unasked.
- Commit before `/code-review`: it reads committed work only, the diff from its fixed point to `HEAD`.

## Commands

```bash
pnpm check                      # dw-sdlc gate: gate.steps, then its Checks; exit 0 green, 1 failed or Drift, 2 cannot run
pnpm exec dw-sdlc --help        # every subcommand; `dw-sdlc <command> --help` gives its flags and exit codes
pnpm exec dw-sdlc check <name> [--json] [--write] # one Check by name, no Step
pnpm exec dw-sdlc primitives --paths <files> | --diff <base> [--json] # the Primitives owning a path, with their docs
pnpm exec dw-sdlc pr ship [<n>] [--dry-run] # the Action a pull request needs next; exit 0 done, 10 act, 20 wait, 30 park, 2 cannot run
pnpm exec vp check [--fix]      # Vite+: oxfmt, oxlint and the type check from vite.config.ts
pnpm test                       # node --test over every *.test.ts under packages/*/test/ and plugins/*/test/
pnpm test:content               # CI's `pnpm test` on a content-only PR
pnpm changeset                  # record a change to the dw-sdlc package for its next release
```

`pnpm agentic:check`, `guardrails:setup`, `guardrails:doctor`, `references:sync` and `references:setup`
run `dw-sdlc config`, `setup`, `doctor`, `references sync` and `references setup`.

## Task Router

Match this table **before** researching or coding — read every row that matches, explore only the rest.

| task                                                                     | read                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| how others built a skill, hook, plugin or workflow, before designing one | `references/AGENTS.md`, then the clones whose `when` matches the task        |
| reading, adding or updating a reference repository                       | `references/AGENTS.md`, then `plugins/sdlc/README.md`                        |
| editing a guard, `lib.sh`, the schema or the config resolver             | `dw-sdlc primitives --paths` on the files, then the ADRs and docs it names   |
| editing a skill, its description or the reviewer agent                   | `.agents/skills/writing-for-agents/SKILL.md`, then the skill's plugin README |
| why a part is built this way, or changing a choice a record names        | `docs/adr/`                                                                  |
| working on this repository: setup, a change landing, the guard parser    | `docs/contributing/`                                                         |
| explaining the repo, editing `README.md` or anything under `docs/`       | `README.md`, `docs/overview.md`, `GLOSSARY.md`                               |
| releasing the plugin or the package, bumping a version                   | `docs/contributing/releasing.md`                                             |
| planning new work, filing or reading an issue                            | `docs/agents/issue-tracker.md`                                               |
| what a guard, hook, script, key or skill is and where it lives           | `.ai/primitives.json`, or `dw-sdlc primitives --paths` on the files          |

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `dominikwozniak/dw-sdlc`, managed with `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
