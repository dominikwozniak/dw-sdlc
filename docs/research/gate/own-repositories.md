# The owner's repositories — the checks and the copies they carry

Read on 2026-10-25: grateful-me-app-v2 and package-template-pnpm from their checkouts on this machine,
`R/dw-mc` and `R/byarcadia-foundation` from the clones at their `main` ref of that day.

## grateful-me-app-v2

- `scripts/` holds `check.mjs`, `check-cached.sh` and nineteen `check-*.mjs` scripts. `check.mjs`
  runs a `STEPS` list in order (lines 14, 51) and ends with `check — N step(s) green in Ns.`
  (line 65).
- `scripts/check-comment-budget.mjs:15`: `MAX_PROSE_LINES = 3`; a failure reads
  `path:line — N prose lines over span, past the 3-line budget.` (line 185).
- `scripts/check-agents-docs.mjs:28-32`: one flag, `--update-baseline`, and "anything unrecognised
  is fatal rather than ignored". Lines 796-801: a word-count ratchet over `docs/agents/*.md` in
  `docs/agents/corpus.baseline.json`, "it may shrink freely and grows only through a commit that
  re-records this file"; "Words, not bytes, so a reflow moves nothing." Line 816: "refusing to
  re-record the baseline while the above fails." Line 843: "A baseline whose total disagrees with its
  parts would disable the ratchet while reporting green", so it is rejected.
- `scripts/check-cached.sh:3, 19`: a run is skipped when the tree fingerprint, `git write-tree` over a
  throwaway index copied from the real one, matches the last green run.
- `tools/oxlint/anti-slop/README.md:1-7`: upstream `dmmulroy/anti-slop` at tag `v0.1.2`, SHA
  `e8c4880471b23ab7f216fba7b27d173a6ef07d4c`, "copied from its `src/` minus `*.test.ts`", registered
  through `jsPlugins` in `.oxlintrc.json`, `oxlint` and `@oxlint/plugins` pinned together. Lines 9-16:
  `index.ts` diverges from upstream in a first-party block of rules and in `definePlugin` over
  upstream's `eslintCompatPlugin`, so "a refresh conflicts here — re-apply both, never take theirs".
  `rules/` holds 42 rule files without their tests.

## package-template-pnpm

- `package.json:6`: `"check": "vp check && vp test && node scripts/agents-check.ts"`; line 16:
  `vite-plus` 1.1.0.
- `scripts/agents-check.ts:11-12`: `MAX_LINES = 120`, `MAX_BYTES = 8192`; a failure reads
  `N lines, over the 120-line budget — cut` (lines 74-78).
- `docs/decisions/0001-vite-plus-is-the-one-toolchain.md`, the `rule` line: "Formatting, linting,
  type-checking, tests and the pre-commit hook run through Vite+ (`vp`), configured in
  `vite.config.ts` alone, with no separate oxlint, oxfmt, typescript, vitest, lint-staged or husky
  dependency".
- `docs/decisions/0002-dependencies-wait-seven-days-and-are-pinned-exactly.md`, the `rule` line: "A
  dependency resolves only after it has been public for 7 days, strictly, and is pinned to an exact
  version; an exception is asked for, and once granted carries its reason and when it goes". Its
  context names the repositories on the same baseline: grateful-me-asc, foundation,
  grateful-me-app-v2, dw-sdlc.
- `vite.config.ts:26`: `jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }]`,
  the rules at `error` from line 31. `tools/oxlint/anti-slop/UPSTREAM.md:1-5`: "Eleven oxlint rules
  from `dmmulroy/anti-slop` at commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` on `main`, dated
  2026-09-10. Upstream ships no package and is meant to be copied, so this directory is the
  installation".

## dw-mc

`R/dw-mc/tools/oxlint/anti-slop/UPSTREAM.md:1-6`: "Four Oxlint rules copied from `dmmulroy/anti-slop`
at commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` on `main`, dated 2026-09-10. There is no package
to install and the project is meant to be copied, so this directory is the installation. `v0.1.2`,
the last tag, predates the Effect rules and is not what to copy from."

## byarcadia foundation

`R/byarcadia-foundation/packages/anti-slop/README.md:1-11`: `@byarcadia-app/anti-slop`, "An oxlint JS
plugin for the patterns oxlint's built-in rules miss. Foundation lints itself with it: the root
`vite.config.ts` loads it from source, so lint needs no build first. It stays private until its own
release is decided." "The plugin ships as built JS, never as raw `.ts`: Node does not strip types
inside `node_modules`." "Rules arrive one at a time, each with a test, when real code calls for them."
`package.json:3`: version `0.0.0`. Nothing is vendored from upstream.

## The four copies side by side

| repository            | rules                                | upstream pin                | registered through                   |
| --------------------- | ------------------------------------ | --------------------------- | ------------------------------------ |
| package-template-pnpm | 11                                   | `c44ef22`, 2026-09-10       | `vite.config.ts` `lint.jsPlugins`    |
| dw-mc                 | 4                                    | `c44ef22`, 2026-09-10       | `tools/oxlint/anti-slop/`            |
| grateful-me-app-v2    | 42 files, upstream plus first-party  | tag `v0.1.2`, SHA `e8c4880` | `.oxlintrc.json` `jsPlugins`         |
| foundation            | its own package, added one at a time | none                        | `vite.config.ts`, loaded from source |
