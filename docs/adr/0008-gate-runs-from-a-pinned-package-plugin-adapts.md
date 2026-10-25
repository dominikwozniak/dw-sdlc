---
status: accepted
---

# The Gate runs from a pinned npm package; the plugin is its adapter

A Check must answer the same in CI, in a commit hook, in a plain terminal and in an agent hook, and a
plugin's code exists only inside a Claude Code session, under `${CLAUDE_PLUGIN_ROOT}`. The runner, the
Checks, the setup, the doctor and the Sync are therefore one npm package, `dw-sdlc`, developed in
`packages/dw-sdlc/` of this repository and installed as a pinned devDependency of every repository
that runs the Gate; the `sdlc` plugin (ADR 0010) links to the same code, so a hook, a skill and
`pnpm check` run one implementation. Scripts copied into each repository are the shape this replaces:
the vendored anti-slop rules alone sit at three sizes and two upstream pins across four repositories,
and no copy learns a fix made in another. ADR 0006 declined the cost of a package for the Sync until
the first consumer outside a local session appeared; the Gate's CI run is that consumer.

## Consequences

A fix reaches a consuming repository through a release, a Dependabot bump and the seven days of
`minimumReleaseAge`, not in the next session; a repository that cannot wait names the package in
`minimumReleaseAgeExclude` under its own rule for exclusions. The package has no runtime dependency,
so what a consumer installs is this repository's code and nothing under it. The plugin and the
package carry separate versions, and the doctor reports when they drift apart. A publish pipeline and
a token are the price; a copy-in generator with a drift check, and a plugin-only runner with no CI
leg, were rejected.
