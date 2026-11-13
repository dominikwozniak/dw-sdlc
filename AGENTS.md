# dw-sdlc — agent rules

> `CLAUDE.md` is a symlink to this file — edit `AGENTS.md` directly.

The software delivery process Dominik works by, and the Claude Code tooling that carries it, proven
here before it goes wider. `README.md` is the front page; `docs/overview.md`
is its long form: how a guard works, the design, adopting, releasing.

## Project map

- `packages/dw-sdlc/` — the `dw-sdlc` package: `src/` the resolver of the config's
  layers, the JSON Schema validator and the bin, `cli.ts`, one row per subcommand, each a
  module under `commands/` (`gate`, `check`, `primitives`, `setup`, `doctor`, `config`,
  `references sync`, `references setup`, `pr ship`, `pr reviewed`, `recap`, `sweep`, `lead start`,
  `worker start`, `worker ls`, `worker report`), one module per Check under `checks/` beside what they share, under `pr/` the read the `pr` commands and
  `recap` share and the Ship script's decision, under `worker/` the herdr calls and `launch.ts`, the start
  both `start` commands share, and `recap-next.ts` the next-session candidates `recap` lists; `config/` the JSON Schemas of `.ai/agentic.config.json` and `.ai/references.json`; `templates/` the
  Router the setup writes; `test/` their tests, the bin spawned on a throwaway repo from the source
  and the packed tarball; `dist/` what `pnpm pack` emits, ignored
- `plugins/sdlc-sessions/` — the session helpers, depending on `sdlc`: `skills/`, `templates/brief.md`,
  a `dw-sdlc` link, the manifest test
- `plugins/sdlc/` — the plugin `.claude-plugin/marketplace.json` lists first, enabled at user
  scope: `hooks/` the bash guards on a shared `lib.sh` plus the jq config contract, the session
  hooks, the report and the Sync; `skills/` holding `sdlc-setup`, `sdlc-doctor`,
  `sdlc-references-add`, `sdlc-pr-open`, `sdlc-pr-ship` and `sdlc-sweep`; `agents/` the `sdlc-reviewer` a `light` Review spawns; `dw-sdlc` a link to the package, whose bin hooks and skills run; `test/` the hook
  tests, mirroring `hooks/`, each spawning a hook on its payload, and the manifest test
- `.ai/` — `agentic.config.json`, this repo's agent rules against the package's schema;
  `references.json`, the References it reads; `primitives.json`, the catalogue of what this
  repo exposes to an agent, held to the tree by the `primitives` Check; `file-size-ratchet.baseline.json`, the files the Ratchet lets stay over limit (`agentic.config.local.json`, one machine's layer, git-excluded)
- `.claude/settings.json` — tracked; turns the dw-solo plugins off here, keeps the clones'
  `CLAUDE.md` and `AGENTS.md` out of context. `.claude/settings.local.json` is one machine's
  permission backstop, git-excluded; a worktree reads it and the local config from the main checkout
- `.agents/skills/` — the engineering skills it works with, pinned in `skills-lock.json`;
  `.claude/skills/` links them
- `docs/agents/` — how those skills use this repo: issue tracker, domain docs
- `docs/overview.md` — the README's long form; `docs/adr/` — decision records, a paragraph each, for a
  choice hard to reverse, surprising without context and a real trade-off; read those naming a file
  before a change
- `docs/specs/` — a built feature's design record; `docs/research/<feature>/` — the dated outside
  facts it rests on. New work goes in GitHub Issues
- `GLOSSARY.md` — what a word means here
- `references/` — repositories cloned per machine for reading, never tracked; the Router is
  `references/AGENTS.md`, its table written from `.ai/references.json`; the Sync hook fetches them
- `ideas/` — local-only notes, gitignored
- `.github/` — CI: `workflows/quality-gate.yaml` runs `pnpm check` on every pull request and on direct
  pushes to `main`; `workflows/release.yaml` turns `.changeset/` into a version pull request and, once it
  merges, publishes to npm. Dependabot groups updates weekly

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
  every commit, a terminal's included. `pnpm install` installs it and the pre-commit hook.
- `main` is a protected branch: a change reaches it through a pull request, after `pnpm check` passes
  in CI, as GitHub's `main` ruleset asks; the admin bypasses it. For a small fix the agent commits on
  `main` and the push comes from Dominik's terminal, which the guards skip.
- Commit before `/code-review`: it reads committed work only, the diff from its fixed point to `HEAD`.

## Commands

```bash
pnpm check                      # dw-sdlc gate: gate.steps, then its Checks
pnpm exec dw-sdlc gate [--json] [--verbose] [--update-baseline | --cache] # a line per Step and Check, --verbose streams all; exit 0 green, 1 failed or Drift, 2 cannot run
pnpm exec dw-sdlc check <name> [--json] # one Check of the Gate by name, no Step; off in the config, it runs on defaults
pnpm exec dw-sdlc primitives --paths <files> | --diff <base> [--json] # the Primitives owning a path, or a change removes, adds, extends
pnpm exec dw-sdlc pr ship [<n>] [-R owner/name] [--merge] [--review full|light|off] [--dry-run] [--json] [--verbose] # the Action a pull request needs next, done when the script owns it; exit 0 done, 10 act, 20 wait, 30 park, 2 cannot run
pnpm exec dw-sdlc pr reviewed <n> [-R owner/name] --head <sha> [--findings | --accept] [--json] # post dw-sdlc/review on that head; exit 2 when it moved or cannot run
pnpm exec dw-sdlc recap [--json] # a Recap's facts and close verdict, read-only; exit 0 can close, 1 cannot, 2 cannot run
pnpm exec dw-sdlc sweep [--dry-run] [--json] # main checkout only: removes Landed branches, clean worktrees, stale locks, its Workers' terminals; names the rest; exit 0 none kept, 1 some, 2 cannot run
pnpm exec dw-sdlc lead start --name <name> --prompt <first message> [--wait <seconds>] [--json] # the next session as a Lead in a herdr terminal; exit 0 started, 1 not, 2 cannot run
pnpm exec dw-sdlc worker start --brief <file> --name <name> [--model] [--effort] [--json] # a Worker on a Brief in a herdr terminal; exits as `lead start`
pnpm exec dw-sdlc worker ls [--json] # this Lead's Workers: state, status, folder
pnpm exec dw-sdlc worker report --to <lead> --recap <file> # a Recap to the Lead, retried while blocked; exit 1 gives up
pnpm exec vp check [--fix]      # Vite+: oxfmt, oxlint and the type check from vite.config.ts
pnpm test                       # node --test over every *.test.ts under packages/*/test/ and plugins/*/test/
pnpm test:content               # CI's `pnpm test` on a content-only PR
pnpm agentic:check [file]       # resolve the config (+ .local) or validate one file
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
