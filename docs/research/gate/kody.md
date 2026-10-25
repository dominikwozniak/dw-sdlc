# kody — the gate, the checks, the ratchet and the primitives map

Read from `R/kody` on 2026-10-25, the clone at its `main` ref of that day.

## The gate

- `AGENTS.md` is 23 lines. Lines 7-9: "`npm run validate` is the single authoritative local gate.
  UI/API: verify locally with control-kody first". The rest is a list of pages to open.
- `package.json:96`: `"validate": "node tools/run-validate.ts"`. `tools/validate-gate.ts:1-10` is "the
  local gate": "GitHub Actions runs the same checks as separate jobs, each on its own runner. This
  module is the local gate." Legs carry a weight (`check`, `suite`, `build`) and the parallelism is
  capped at `saturatedSuiteParallelism = 4` for small machines; the legs are format, lint, typecheck,
  worker-types, test-node, test-workers (lines 29-45).
- `tools/run-check-group.ts:2-3`: "Run every check in a named group. Continues after a failure so one
  member does not hide the next. Exits non-zero when any member failed." The loop collects `failed`
  names and logs `<group>: failed checks: a, b` (lines 88-108).
- 41 `tools/check-*.ts` scripts on that day (`ls tools | grep -c '^check-'`).

## Two checks read whole

- `tools/check-file-size-ratchet.ts:24-42`: three groups, `agents-md` at 23 lines, `client-routes`
  at 800, `node-tests` at 2000. The comment on the first: "Reversible: raise this deliberately when
  the map must grow; do not grandfather AGENTS.md via the snapshot allowlist." A
  `FileSizeRatchetSnapshot` holds one allowlist per group (lines 44-46).
- `tools/check-docs-temporal-language.ts`: exempt prefixes `docs/contributing/decisions/` and
  `docs/audits/` (lines 25-27); the phrases, each a labelled regex (lines 36-87): `now we`, `we now`,
  `we no longer`, `previously we`, `as before`, `were removed`, `was/were retired`,
  `no longer support/accept/require/use/…`, `is now a/the`, `are now`, `previously a/the`,
  `recently changed/added/updated/removed/introduced`, `used to support/require`. On failure it
  prints the count, "Documentation should describe current behavior, not rollouts.", a pointer to
  `docs/contributing/documentation.md`, then the matches (lines 305-311).

## The primitives map

- `docs/contributing/architecture/primitives.yaml`, header lines 1-19: "Stable vocabulary for the
  visual-recap skill"; "This is NOT a living feature changelog and NOT derived source-of-truth for
  behavior"; "Update this file only when adding, removing, or materially reshaping a primitive (id,
  name, group, code roots, or meaning). Do NOT edit `summary` for ordinary feature work"; "`code`
  entries are coarse ownership roots for `classify-primitives.mjs` (longest-prefix match). Prefer
  directories over file lists. Keep the map small." Sections `version`, `groups`, `primitives`,
  `invariants`; 76 `id` entries across them.
- `.agents/skills/visual-recap/scripts/primitives-map.mjs:15-32`: a primitive is `id`, `name`,
  `group?`, `summary?`, `code[]`, `docs[]`; the parser reads a constrained YAML subset of its own.
- `.agents/skills/visual-recap/scripts/check-primitives-map.mjs:1-8, 15`: "unique ids", "every
  code/docs path resolves on disk", "summaries stay single-line and short (no feature-changelog
  essays)", `maxSummaryLength = 120`. Wired as `"primitives:check"` in `package.json:61`.
- `.agents/skills/visual-recap/scripts/classify-primitives.mjs:1-9`: classifies the paths of
  `git diff --name-only base...head`, or stdin, against the map, so a PR recap names the primitives it
  composes, extends or adds.

## Principles

- `docs/principles/lean-agent-context.md:9, 13`: the file-size ratchet "enforces the line budget" of
  the map; "Progressive disclosure: agents open the index, then only the page the task needs".
- `docs/contributing/harness-engineering.md:11, 38-44`: "Prefer small, enforceable rules over long,
  fragile instructions." The ladder: 1 "Lint / types / validate" for local, syntactic violations; 2
  "Tests" when the failure is behavioural; 3 "Scripts / automation" for multi-step workflows; 4
  "Docs — describe how the system works and point at the check or test."
