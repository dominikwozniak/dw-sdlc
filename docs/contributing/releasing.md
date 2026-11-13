# Releasing

The two plugins and the `dw-sdlc` package each carry a version of their own: a release of one never
bumps another. Where they meet, the doctor names a drift.

## Releasing the plugin

`plugins/sdlc/.claude-plugin/plugin.json` and its entry in `.claude-plugin/marketplace.json` carry
one version, and `claude plugin update` refreshes an installed copy by that version only. A change
to any part of the plugin ships when both files are bumped in one `chore: release sdlc x.y.z` commit
that lands on `main`. Installs from a clone see the change in the next session without a bump.

The doctor's `package` line names a drift between the `dw-sdlc` the plugin links and the one a
repository pins.

`sdlc-sessions` releases the same way, on a version of its own, in a `chore: release sdlc-sessions x.y.z`
commit. The doctor's `sessions` line names a drift between its copy of `dw-sdlc` and the copy `sdlc` runs.

## Releasing the package

The `dw-sdlc` package goes to npm as JavaScript. Its source is TypeScript, and Node refuses to strip
types from a file under `node_modules`, so `pnpm pack` runs the package's `prepack`: `tsc` emits
`dist/` from `packages/dw-sdlc/tsconfig.build.json`. The manifest's `bin` and `exports` name the
source, so this repository's workspace link runs it as written; their twins under `publishConfig`
name `dist/`, and pnpm writes those into the packed manifest. `files` ships `dist/`, `config/` with the
schemas, and `templates/` with the Router the setup writes; pnpm adds the package's `README.md` and its MIT
`LICENSE` unasked, and the package has no runtime dependency. `test/pack.test.ts` packs it, installs
the tarball into a throwaway repository and runs `dw-sdlc gate` from that repository's `node_modules`.

A change to the package carries a changeset: `pnpm changeset` writes one under `.changeset/`, with
the bump and the line the changelog gets. On a push to `main` that touches `.changeset/` or the
package's `package.json`, `.github/workflows/release.yaml` picks one of two modes:

- **version**, while a changeset is pending: it opens or updates the
  `chore(release): version packages` pull request. `pnpm release:version` bumps the version, writes
  and formats `CHANGELOG.md` and deletes the changesets. GitHub opens it only when Settings → Actions →
  General allows GitHub Actions to create pull requests.
- **publish**, when npm lacks the version on `main`, which is what merging the version pull request
  makes true: one job runs `pnpm check` and packs the tarball with no secret in reach; the next
  publishes it, pushes the `dw-sdlc@x.y.z` tag and creates the GitHub release.

A publish that fails runs again by hand, `gh workflow run release.yaml`, and only from `main`.

Merging the version pull request is the decision to release. The publish job signs in to npm by
trusted publishing alone: no secret and no `.npmrc` exist, and pnpm exchanges the job's OIDC token,
from its `id-token: write`, for a token scoped to the package. npm accepts the exchange because the
package's settings on npmjs.com hold a saved trusted publisher: `dominikwozniak/dw-sdlc`, the
workflow `release.yaml`, no environment, and `npm publish` allowed beside `npm stage publish`.
`pnpm publish`, which `changeset publish` runs, names `npm publish` in its request. The version goes
live on the registry about a minute later, with no approval, and its `_npmUser` names GitHub Actions
as the trusted publisher. A publish with no trusted publisher saved fails with `E404: 404 Not Found`
and no reason in the log: pnpm warns why it skipped OIDC, and changesets drops that warning. What the
releases showed is in the [research notes](../research/gate/toolchain.md#npm-publishing).

npm attests provenance only for a build from a public repository. The workflow leaves pnpm's
`provenance` setting unset and trusted publishing decides, so a version published from here carries
provenance; the versions up to 0.17.0 were built while the repository was private and carry none.
Trust evidence only grows from one version to the next. A consumer on `trustPolicy: no-downgrade` refuses a
version that carries less trust evidence than an earlier one, so a version after 0.1.0 never goes
out on an access token. A consumer takes a release through Dependabot after the seven days of
`minimumReleaseAge`; one that cannot wait names `dw-sdlc` in `minimumReleaseAgeExclude` under its own
rule for exclusions, as [ADR 0008](../adr/0008-gate-runs-from-a-pinned-package-plugin-adapts.md)
records.
