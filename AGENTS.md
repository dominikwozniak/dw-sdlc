# dw-sdlc — agent rules

> `CLAUDE.md` is a symlink to this file — edit `AGENTS.md` directly.

The software delivery process Dominik works by, and the Claude Code tooling that carries it, proven
here before it goes wider. `README.md` is the one-minute front page for a person; `docs/overview.md`
is its long form: how a guard works, why the design, adopting and releasing.

## Project map

- `packages/dw-sdlc/` — the `dw-sdlc` package, a workspace member: `src/` the resolver of the config's
  layers, the JSON Schema validator and the `dw-sdlc` bin, `cli.ts`, one row per subcommand, each a
  module under `commands/` (`gate`, `check`, `primitives`, `setup`, `doctor`, `config`,
  `references sync`, `references setup`, `pr ship`, `pr reviewed`, `recap`), one module per Check it ships
  under `checks/` beside the modules they share, and under `pr/` the read the `pr` commands and
  `recap` share and the Ship script's decision; `config/` the JSON Schema for `.ai/agentic.config.json`, which
  declares how this repo works for an agent, and the one for `.ai/references.json`; `templates/` the
  Router the setup writes; `test/` their tests, the bin spawned on a throwaway repo, from the source
  and from the packed tarball; `dist/` the JavaScript `pnpm pack` emits for npm, ignored
- `plugins/sdlc-sessions/` — the plugin of the session helpers, depending on `sdlc`: `skills/sdlc-recap`,
  a `dw-sdlc` link, the manifest test
- `plugins/sdlc/` — the plugin `.claude-plugin/marketplace.json` lists first, enabled at user
  scope: `hooks/` the bash guards on a shared `lib.sh` plus the jq config contract, and the session
  hooks, the report and the Sync; `skills/` the user-invoked `sdlc-setup`, `sdlc-doctor`,
  `sdlc-references-add` and `sdlc-pr-ship`; `agents/` the `sdlc-reviewer` subagent a `light` Review
  spawns; `dw-sdlc` a link to the package, whose bin the hooks and skills run; `test/` the hook
  tests, mirroring `hooks/`, each spawning a hook on the real stdin payload, and the manifest test
- `.ai/` — `agentic.config.json`, this repo's agent rules against the package's schema;
  `references.json`, the References this repo reads; `primitives.json`, the catalogue of what this
  repo exposes to an agent, held to the tree by the `primitives` Check; `file-size-ratchet.baseline.json`, the files the Ratchet lets stay over their
  limit (`agentic.config.local.json` is one machine's layer, kept out of git through `.git/info/exclude`)
- `.claude/settings.json` — tracked; turns the dw-solo plugins off in this repo and keeps the clones'
  `CLAUDE.md` and `AGENTS.md` out of context. `.claude/settings.local.json` is one machine's
  permission backstop, written by the setup and excluded from git. A worktree reads it and the local
  config from the main checkout, and the plugin's Sync hook clones the references, so nothing is copied
- `.agents/skills/` — the engineering skills this repo works with, pinned in `skills-lock.json`;
  `.claude/skills/` links to them
- `docs/agents/` — how those skills use this repo: the issue tracker and the domain docs
- `docs/overview.md` — the long form of the README; `docs/adr/` — decision records, one paragraph each,
  written only for a choice that is hard to reverse, surprising without context and a real trade-off;
  read the ones naming a file before changing it
- `docs/specs/` — the design record of a built feature: problem, goal, decisions, testing, tasks,
  notes; `docs/research/<feature>/` — the outside facts that spec rests on, dated. New work is
  specified in GitHub Issues, not here
- `GLOSSARY.md` — what a word means in this repo
- `references/` — repositories cloned on each machine for reading, never tracked; the Router is
  `references/AGENTS.md`, its table written from the list `.ai/references.json` by
  `pnpm references:setup`; the plugin's Sync hook or `pnpm references:sync` fetches them
- `ideas/` — local-only notes, gitignored but for `.gitkeep`
- `.github/` — CI: `workflows/quality-gate.yaml` runs `pnpm check` on every pull request and on `main`;
  `workflows/release.yaml` turns the changesets under `.changeset/` into a version pull request and,
  once it merges, publishes the package to npm. Dependabot (`dependabot.yml`) opens grouped updates
  weekly. Review runs locally, through `/code-review`

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
- **CI runs on `ubuntu-latest`.** External actions are pinned to a full commit SHA with a `# vX.Y.Z`
  comment.
- **A skill the plugin ships is named `sdlc-<verb>`, or `sdlc-<area>-<verb>`**, as `sdlc-setup` and
  `sdlc-references-add`, so the skills group in the slash menu and never collide with dw-solo's `dw-*`.

## Git

- Subjects follow Conventional Commits and every commit carries a `Co-Authored-By` trailer; the
  guards enforce both from `.ai/agentic.config.json`. `.vite-hooks/commit-msg` checks the subject of
  every commit, one typed in a terminal included. `pnpm install` installs it and the pre-commit hook.
- `main` is a protected branch: a change reaches it through a pull request, after `pnpm check` passes
  in CI. For a small fix the agent commits on `main` and the push comes from Dominik's own terminal;
  the guards judge only the agent's tool calls. GitHub branch protection is not available on this private
  repository, so the guard is the only check.
- Commit before `/code-review`: it reads committed work only, the diff from its fixed point to `HEAD`.

## Commands

```bash
pnpm check                      # dw-sdlc gate: the gate.steps of .ai/agentic.config.json in order, then its Checks; = CI
pnpm exec dw-sdlc gate [--json] [--verbose] [--update-baseline | --cache] # a line per Step and Check, a failure's last 50 lines (--json: tail), --verbose streams all; exit 0 green, 1 failed or a Step wrote the tree (Drift), 2 cannot run; --update-baseline tightens baselines, --cache skips a tree already green
pnpm exec dw-sdlc check <name> [--json] # one Check of the Gate by name, no Step; off in the config, it runs on its defaults
pnpm exec dw-sdlc primitives --paths <files> [--json] # the Primitives that own each path: summary, docs to read
pnpm exec dw-sdlc pr ship [<n>] [-R owner/name] [--merge] [--review full|light|off] [--dry-run] [--json] [--verbose] # the Action one pull request needs next; the script updates a branch behind, marks a head reviewed under off, marks a draft ready and merges under pr.merge auto; exit 0 done, 10 act, 20 wait, 30 park, 2 cannot run
pnpm exec dw-sdlc pr reviewed <n> [-R owner/name] --head <sha> [--json] # post dw-sdlc/review success on that head; exit 2 when it moved or cannot run
pnpm exec dw-sdlc recap [--json] # a Recap's facts and the close verdict, read-only; exit 0 can close, 1 cannot, 2 cannot run
pnpm exec vp check [--fix]      # Vite+: oxfmt, oxlint and the type check from vite.config.ts; --fix writes
pnpm test                       # node --test over every *.test.ts under packages/*/test/ and plugins/*/test/, in one run
pnpm agentic:check [file]       # resolve .ai/agentic.config.json (+ .local) or validate one file
pnpm guardrails:setup [--dry-run] # write this machine's local config, excludes, deny rules, lease exception
pnpm guardrails:doctor          # one PASS / WARN / FAIL line per machine check; exit 1 on a FAIL
pnpm references:sync [dir...]   # clone or update each reference repository on this machine
pnpm references:setup [--check] # the Router's table from .ai/references.json; --check exits 1 when it is behind
pnpm changeset                  # record a change to the dw-sdlc package for its next release
```

## Task Router

Match this table **before** researching or coding — read every row that matches, explore only the rest.

| task                                                                     | read                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| how others built a skill, hook, plugin or workflow, before designing one | `references/AGENTS.md`, then the clones whose `when` matches the task     |
| reading, adding or updating a reference repository                       | `references/AGENTS.md`, then `plugins/sdlc/README.md`                     |
| editing a guard, `lib.sh`, the schema or the config resolver             | `docs/adr/*.md`, then the Decisions of `docs/specs/agentic-guardrails.md` |
| explaining the repo, editing `README.md` or anything under `docs/`       | `README.md`, `docs/overview.md`, `GLOSSARY.md`                            |
| releasing the plugin or the package, bumping a version                   | `docs/overview.md`, its two Releasing sections                            |
| planning new work, filing or reading an issue                            | `docs/agents/issue-tracker.md`                                            |
| what a guard, hook, script, key or skill is and where it lives           | `.ai/primitives.json`, or `dw-sdlc primitives --paths` on the files       |

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `dominikwozniak/dw-sdlc`, managed with `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
