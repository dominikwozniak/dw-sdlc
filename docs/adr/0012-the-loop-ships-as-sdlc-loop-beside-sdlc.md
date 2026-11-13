---
status: deprecated
---

# The Loop ships as a second plugin, `sdlc-loop`, that depends on `sdlc`

This marketplace publishes two plugins. `sdlc@dw-sdlc` carries what sets a repository up and keeps a
session safe: the guards, the session hooks and the Sync, the agent side of the Gate, and the skills
`sdlc-setup`, `sdlc-doctor` and `sdlc-references-add`. `sdlc-loop@dw-sdlc` carries the skills that move
a change through the Loop, starting with `sdlc-pr-ship` over the ship script. Each plugin holds a link
to `packages/dw-sdlc`, which the install copies, so both run the code the package publishes (ADR 0008).
The guards, the Sync and the Gate stay one plugin: every machine enables them together, and they need
one version, one setup and one doctor. The Loop is a different kind of part. It is work the dev starts,
not protection that runs on every tool call, it grows with the later stages, and its releases need not
move the guards. `sdlc-loop` lists `sdlc` under `dependencies`. Installing it brings the guards, and
Claude Code refuses to disable `sdlc` while `sdlc-loop` is enabled, because the Loop's skills rely on
the guards, for instance to refuse a branch deletion. The name is `loop`, not `workflow`, which here
means a GitHub Actions workflow.

Not adopted: `sdlc-pr-ship` ships in `sdlc` under ADR 0010, and the session helpers are a plugin of
their own under ADR 0014.

## Consequences

There are two versions to bump, and two copies of the package that can drift apart. `sdlc-doctor`
stays the one doctor: it reports `sdlc-loop` and the drift of its copy when the plugin is installed.
`sdlc-setup` stays the one setup and writes the config's `pr` key, which the package's schema owns.
A machine can install the guards without the Loop, but not the Loop without the guards. The skill naming
rule in `AGENTS.md` applies to every plugin of the marketplace. Each skill sets `name` in its
frontmatter, so `/sdlc-pr-ship` works without the plugin prefix.
