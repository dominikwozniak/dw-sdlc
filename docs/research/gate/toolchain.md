# Toolchain — Vite+, anti-slop upstream, oxfmt, pnpm's release age and Node 24

Read on 2026-10-25: Vite+ release data through the GitHub API and `pnpm view`, `R/dmmulroy-anti-slop`
at its `main` ref of that day, `https://pnpm.io/settings/dependency-resolution`,
`https://nodejs.org/docs/latest-v24.x/api/typescript.html`, and one experiment in a scratch directory.

## Vite+

- `voidzero-dev/vite-plus` releases: `v1.4.0` on 2026-10-23, `v1.3.0` on 2026-10-16, `v1.2.0` on
  2026-10-14; `v1.0.0` on 2026-09-28. Licence MIT. `pnpm view vite-plus version` answers `1.4.0`.
- The package template runs on it, pinned at 1.1.0, with `vp check && vp test` as its check script and
  the rule that nothing else formats, lints, type-checks or tests (`own-repositories.md`).
- `R/dmmulroy-anti-slop/README.md:82`: "The same `ignorePatterns`, `jsPlugins`, and rules work under
  `lint` in a Vite+ config. Merge the ignore patterns into Vite+'s `fmt.ignorePatterns` as well so
  `vp check` does not reformat installed agent assets or the vendored plugin."
- This repository's gate on that day is oxlint 1.87.0, oxfmt 0.72.0, TypeScript 7.0.2 and
  `node --test`, with lint-staged 17.6.0 and husky 9.1.7 in front of a commit (`package.json`,
  `devDependencies`).

## anti-slop upstream

- `R/dmmulroy-anti-slop/package.json:3`: version `0.1.2`, the last tag; dw-mc's vendoring note says it
  "predates the Effect rules and is not what to copy from" (`own-repositories.md`).
- `README.md:9`: "**This project is meant to be vendored**, not treated as a fixed npm dependency.
  There is no official npm package. Copy the rules into your repository, read them, and change them to
  match your team's standards."
- `README.md:14, 17`: `npx skills add dmmulroy/anti-slop --skill install-anti-slop`; the skill "copies
  the plugin, installs compatible Oxlint dependencies—matching an existing Oxlint version when
  present—merges the plugin into the existing lint configuration, enables every generic rule, and
  validates the result."
- `README.md:21`: an update "stages incoming source separately, uses a three-way merge when the
  original upstream snapshot is recoverable, and otherwise ports reviewed changes conservatively."
- `README.md:33`: "Copy `src/` into the target repository, for example at `tools/oxlint/anti-slop/`.
  If the repository already uses `oxlint`, install `@oxlint/plugins` at exactly the resolved Oxlint
  version."
- `src/rules/` holds 37 files, rules with their tests; the References entry of this repository
  describes them as 18 generic rules and 5 Effect rules (`.ai/agentic.config.json`).

## oxfmt and markdown

- `.lintstagedrc.json:6`: oxfmt runs on `*.{json,jsonc,md,yaml,yml}` at commit; `.oxfmtrc.json`:
  `printWidth` 120, `ignorePatterns` `references/*/` and `.agents/`.
- Observed on the notes in this directory and on `AGENTS.md`: oxfmt pads a markdown table's columns
  to the widest cell and leaves prose line breaks where they are.

## pnpm's release age

- `minimumReleaseAge`: "The minimum number of minutes that must pass after a version is published
  before pnpm will install it"; it "applies to all dependencies, including transitive ones"; added in
  v10.16.0; default 1440 since v11, 0 before. The one exemption is a config dependency pinned with
  `version+integrity`.
- `minimumReleaseAgeStrict`: added in v11.0.0; default `true` when `minimumReleaseAge` is set
  explicitly. `false` installs a version that fails the age check so the install succeeds; `true`
  fails resolution.
- `minimumReleaseAgeExclude`: `string[]`, added in v10.16.0; "Exclusion works by package name and
  covers all versions of that package"; patterns such as `@myorg/*` since v10.17.0; version-specific
  entries such as `webpack@4.47.0 || 5.102.1` since v10.19.0.
- This repository: `pnpm-workspace.yaml` sets 10080 minutes, strict, with `trustPolicy: no-downgrade`,
  `blockExoticSubdeps` and `strictDepBuilds`; pnpm 11.21.0 is the `packageManager`.
- What follows: a release of the `dw-sdlc` package reaches a consumer seven days later, or at once
  when the consumer names it in `minimumReleaseAgeExclude`, which the template's decision 0002 allows
  only with the owner's yes, a reason and an expiry (`own-repositories.md`).

## Node 24 and TypeScript

- Type stripping is on by default since v23.6.0. "To discourage package authors from publishing
  packages written in TypeScript, Node.js refuses to handle TypeScript files inside folders under a
  `node_modules` path." `--experimental-transform-types` is needed for `Enum` declarations,
  `namespace` with runtime code, parameter properties and import aliases.
- Experiment on Node v24.22.1, one `bin.ts` with a `#!/usr/bin/env node` line and one type annotation,
  copied to three places in a scratch directory: `src/bin.ts` runs and prints; `node_modules/x/bin.ts`
  throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`; `node_modules/linked/bin.ts`, where `linked`
  is a symlink to `../src`, runs, because Node resolves the file to its real path before it decides.
- What follows: this repository and any pnpm workspace link run the package from its `.ts` source,
  and a consumer that installs it from the registry gets a real copy under `node_modules`, so the
  published artifact is JavaScript. Foundation's anti-slop package states the same rule for itself
  (`own-repositories.md`).
