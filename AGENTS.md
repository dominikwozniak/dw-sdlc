# dw-sdlc — agent rules

> `CLAUDE.md` is a symlink to this file — edit `AGENTS.md` directly.

The software delivery process Dominik works by, and the Claude Code tooling that carries it, proven
here before it goes wider. `README.md` is the one-minute front page for a person; `docs/overview.md`
is its long form: how a guard works, why the design, adopting and releasing.

## Project map

- `packages/dw-sdlc/` — the `dw-sdlc` package, a workspace member: `src/` the resolver of the
  config's layers, the JSON Schema validator and the `dw-sdlc` bin, `cli.ts`, one row per
  subcommand, each a module under `commands/` (`gate`, `primitives`, `setup`, `doctor`, `config`,
  `references sync`, `references setup`), and one module per Check it ships under `checks/`, beside
  the modules they share; `config/` the JSON Schema for `.ai/agentic.config.json`, which declares
  how this repo works for an agent, and the `references` key's own, which that schema leaves
  unnamed; `templates/` the Router the setup writes; `test/` their tests, the bin spawned on a
  throwaway repo, from the source and from the packed tarball; `dist/` the JavaScript `pnpm pack`
  emits for npm, ignored
- `plugins/guardrails/` — the guardrails plugin, published through `.claude-plugin/marketplace.json`:
  `hooks/` holds the bash guards on a shared `lib.sh` plus the jq config contract, `dw-sdlc` a link
  to the package, whose bin the skill runs, and `test/` the guard tests, mirroring `hooks/`:
  `harness.ts` spawns a guard on the real stdin payload; every input a test reads is built beside
  it; `skills/sdlc-guardrails-setup/` the user-invoked skill that runs `dw-sdlc setup`
- `plugins/references/` — the references plugin, published beside guardrails and enabled at user
  scope: `hooks/` the session-start hook that runs `dw-sdlc references sync`, `dw-sdlc` a link to
  the package, `skills/sdlc-references-add/` the user-invoked skill that adds a Reference, and
  `test/` the hook test, on the package's References harness through the link
- `.ai/` — `agentic.config.json`, this repo's own agent rules against the package's schema, its
  References under the `references` key; `primitives.json`, the catalogue of what this repo exposes
  to an agent, per Primitive where its code lives and which document explains it, held to the tree
  by the `primitives` Check (`agentic.config.local.json` is one machine's layer, kept out of git
  through `.git/info/exclude`)
- `.claude/settings.json` — tracked; turns the dw-solo plugins off in this repo and keeps the clones'
  `CLAUDE.md` and `AGENTS.md` out of context. `.claude/settings.local.json` is one machine's
  permission backstop, written by the setup and excluded from git. A worktree reads it and the local
  config from the main checkout, so nothing is copied into one. The references are not copied either:
  the references plugin's session-start hook clones them
- `.agents/skills/` — the engineering skills this repo works with, pinned in `skills-lock.json`;
  `.claude/skills/` links to them
- `docs/agents/` — how those skills use this repo: the issue tracker and the domain docs
- `docs/overview.md` — the long form of the README; `docs/adr/` — decision records, one paragraph each,
  written only for a choice that is hard to reverse, surprising without context and a real trade-off;
  read the ones naming a file before changing it
- `docs/specs/` — the design record of a built feature: problem, goal, decisions, testing, tasks,
  notes; `docs/research/<feature>/` — the facts that spec rests on, read from outside sources and
  dated by when they were read. New work is specified in GitHub Issues, not here
- `GLOSSARY.md` — what a word means in this repo
- `references/` — repositories cloned on each machine for reading, never tracked; the Router is
  `references/AGENTS.md`, the list the `references` key of `.ai/agentic.config.json`, and the
  Router's table of each Reference's `when` is written from the list by `pnpm references:setup`; the
  references plugin's session-start hook or `pnpm references:sync` fetches them
- `ideas/` — local-only notes; everything but `.gitkeep` is gitignored, so nothing in it reaches a clone
- `.github/` — CI: `workflows/quality-gate.yaml` runs `pnpm check` on every pull request and on `main`;
  `workflows/release.yaml` turns the changesets under `.changeset/` into a version pull request and,
  once it merges, publishes the package to npm. Dependabot (`dependabot.yml`) opens grouped npm and
  GitHub Actions updates weekly, 7 days after a release. Review runs locally, through `/code-review`

## Never

- Never edit, build, lint, or import from `references/` — read-only clones.
- Never point tracked files at `ideas/` — its contents exist on one machine only.

## Tooling

- **pnpm only**, pinned in `package.json` — never `npm`, `npx`, `yarn` or `bun`; one-off tools via
  `pnpm dlx`. Dependencies are pinned exactly; `pnpm-workspace.yaml` refuses versions younger than 7 days.
- **TypeScript runs natively on Node 24** — `node packages/dw-sdlc/src/cli.ts <command>`, no build step.
  Erasable syntax only (no `enum`, `namespace` or parameter properties), and relative imports keep
  the `.ts` extension.
- **Formatting and import order belong to oxfmt.** The pre-commit hook runs oxlint `--fix` and oxfmt on
  staged files.
- **CI runs on `ubuntu-latest`.** External actions are pinned to a full commit SHA with a `# vX.Y.Z`
  comment.
- **A skill a plugin ships is named `sdlc-<plugin>-<verb>`**, as `sdlc-references-add`, so the skills
  group in the slash menu and never collide with the `dw-*` skills of dw-solo.

## Git

- Subjects follow Conventional Commits and every commit carries a `Co-Authored-By` trailer; the
  guards enforce both from `.ai/agentic.config.json`. `.husky/commit-msg` checks the subject of
  every commit, one typed in a terminal included.
- `main` is a protected branch: a change reaches it through a pull request, after `pnpm check` passes
  in CI. For a small fix the agent commits on `main` and the push comes from Dominik's own terminal;
  the guards judge only the agent's tool calls. GitHub branch protection is not available on this private
  repository, so the guard is the only check.

## Commands

```bash
pnpm check                      # dw-sdlc gate: the gate.steps of .ai/agentic.config.json in order, then its Checks; = CI
pnpm exec dw-sdlc gate [--json] # the Gate itself; exit 0 green, 1 a Step or Check failed, 2 cannot run
pnpm exec dw-sdlc primitives --paths <files> [--json] # the Primitives that own each path: summary, docs to read
pnpm lint | lint:fix            # oxlint — check / --fix
pnpm format | format:fix        # oxfmt — check / write
pnpm typecheck                  # tsc, no emit
pnpm test                       # node --test over every *.test.ts under packages/*/test/ and plugins/*/test/, in one run
pnpm agentic:check [file]       # resolve .ai/agentic.config.json (+ .local) or validate one file
pnpm guardrails:setup [--dry-run] # write this machine's local config, excludes, deny rules, lease exception
pnpm guardrails:doctor          # one PASS / WARN / FAIL line per machine check; exit 1 on a FAIL
pnpm references:sync [dir...]   # clone or update each reference repository on this machine
pnpm references:setup [--check] # the Router's table from the references key; --check exits 1 when it is behind
pnpm changeset                  # record a change to the dw-sdlc package for its next release
```

## Task Router

Match this table **before** researching or coding — read every row that matches, explore only the rest.

| task                                                                     | read                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| how others built a skill, hook, plugin or workflow, before designing one | `references/AGENTS.md`, then the clones whose `when` matches the task     |
| reading, adding or updating a reference repository                       | `references/AGENTS.md`, then `plugins/references/README.md`               |
| editing a guard, `lib.sh`, the schema or the config resolver             | `docs/adr/*.md`, then the Decisions of `docs/specs/agentic-guardrails.md` |
| explaining the repo, editing `README.md` or anything under `docs/`       | `README.md`, `docs/overview.md`, `GLOSSARY.md`                            |
| releasing a plugin or the package, bumping a version                     | `docs/overview.md`, its two Releasing sections                            |
| planning new work, filing or reading an issue                            | `docs/agents/issue-tracker.md`                                            |
| what a guard, hook, script, key or skill is and where it lives           | `.ai/primitives.json`, or `dw-sdlc primitives --paths` on the files       |

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `dominikwozniak/dw-sdlc`, managed with `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
