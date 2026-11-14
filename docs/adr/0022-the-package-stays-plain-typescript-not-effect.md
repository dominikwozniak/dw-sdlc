---
status: accepted
---

# The package stays plain TypeScript, not Effect

`dw-mc` is built on Effect, and moving the `dw-sdlc` package onto it was weighed for consistency
across the two. The package stays plain TypeScript.

- **The plugin cannot load a runtime dependency.** The installed plugin runs the package's source
  through its `dw-sdlc` link (`node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts"`, from the skills and
  the Sync hook). A marketplace install has no `node_modules`, so an `import "effect"` fails there.
  The Sync hook always exits 0, so it would fail silently at every session start.
- **ADR 0008 keeps the package free of runtime dependencies.** Effect would add about 58 MB to a
  570 kB package that four repositories pin.
- **The parts a CLI needs are not stable yet.** Effect 4 is stable, but its `cli` and `process`
  modules are marked unstable and can break in a minor release.
- **The bin keeps its exit codes and help text.** Tests pin both. Effect's CLI exits 1 on help.
- **Most of the gain is in reach without Effect.** One error type that the bin alone turns into
  exit 2, and one module that owns how git runs, give the package that shape in plain TypeScript.

## Consequences

The question reopens when two things hold together:

- the plugin ships a committed bundle, which ends the no-build-step rule;
- Effect marks `cli` and `process` stable.

The move then goes one command at a time behind the same bin. `cli.ts` already accepts a command
that returns a number or a Promise of one. The tests that spawn the bin carry over unchanged.
