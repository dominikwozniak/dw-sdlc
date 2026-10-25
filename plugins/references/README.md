# references

The Sync for a repository's References, shipped as a plugin: the repositories an agent reads to see
how a problem was solved before, declared as the `references` key of `.ai/agentic.config.json` and
cloned under `references/`. Only the committed file is read; the local layer adds no References. A
repository without the key gets no output at all.

## Install

```bash
claude plugin marketplace add dominikwozniak/dw-sdlc --sparse .claude-plugin plugins
claude plugin install references@dw-sdlc --scope user
```

Enabled once at user scope, it syncs a repository's References when a local Claude Code session
starts, a new worktree's session included. A cloud session, Codex and a plain terminal load no
plugin, so a Reference there is what the last local session left on disk (ADR 0006). A repository
that runs a Sync hook of its own drops it, or the Sync runs twice.

## The session hook

`hooks/session-start.sh` runs on `SessionStart` with matcher `startup` and a 60 s timeout. It runs the
Sync from the project directory and prints its lines, both streams, as the session's context. When the
Sync fails, one line more says the clones stay where they were and names the script to rerun. It always
exits 0, so being offline never blocks a session.

## The key

An array of entries, each with:

- `dir` — the one directory under `references/` the clone lives in, unique in the list;
- `repository` — a URL `git` can fetch; a `https://github.com/` one fetches with the GitHub CLI's
  credentials, so a private repository clones without a prompt;
- `ref` — a branch or a tag; `{name}` in it stands for the exact version the root `package.json`
  pins for package `name`, read through the default catalog of `pnpm-workspace.yaml` when the pin
  says `catalog:` or `catalog:default`;
- `skip` — optional, paths the sparse checkout leaves out, relative and inside the clone;
- `what` and `when` — what the Reference is, and when an agent reaches for it.

An unknown field is refused. `config/references.schema.json` documents the contract; at runtime
`scripts/references-key.ts` is the authority, and one case list holds the two in agreement. The
guardrails schema never names the key, so a mistake in it never moves the guards to the strictest
set (ADR 0007).

## The Sync

```bash
node <plugin root>/scripts/references-sync.ts [dir...]
pnpm references:sync [dir...]   # in a checkout of dw-sdlc
```

Every Reference, or only the named ones. A missing one is cloned shallow, blobless and without a
checkout; an existing one is fetched at depth 1. Either is then checked out detached at what was
fetched, sparse when `skip` names paths. Each prints one line: directory, short commit, repository
and ref. The variables `git rev-parse --local-env-vars` lists are dropped, so a run from a git hook
never touches the repository that hook points at, and the terminal prompt is off.

A directory under `references/` the list does not name is reported and never deleted.

One Sync runs in a checkout at a time: it holds `references/.sync.lock`, with its pid inside, while
it syncs. A second one started meanwhile, a session starting beside another or `pnpm references:sync`
during a session start, waits for it, up to 30 s, then syncs. Past that it prints one line naming the
pid, exits 0 and leaves the clones to the Sync still running. `REFERENCES_SYNC_WAIT` sets the seconds
to wait. A lock whose process is gone, left by a killed Sync, is removed and never waited on. A
worktree has a `references/` of its own, so only Syncs in one checkout wait on each other.

## Failures

- **Exit 2**: a key the parser refuses, a config that is not JSON, or a named dir the list lacks.
  Nothing is synced, and one line names the entry, the field and the reason.
- **Exit 1**: an entry that fails to resolve fails alone, and the rest proceed. That covers an
  unreachable repository, a missing or inexact pin, a clone with local edits the update would
  overwrite, and a directory that is not a clone of its repository; each is left as it is.

## Adding a Reference

`/sdlc-references-add <repository>` adds one. Only the user invokes it. It runs the setup and shows
its lines, then does the parts that need judgment: it names the licence, picks the ref (a branch
head, or a tag or `{name}` when the repository is a dependency of this one), counts the files and
proposes `skip` for the vendored directories, writes `what` and `when`, appends the entry and runs
the Sync for its `dir`. It commits nothing.

The setup makes a repository ready to declare References:

```bash
node <plugin root>/scripts/references-setup.ts [--root <dir>] [--dry-run]
```

- `references/AGENTS.md`, the Router, from `templates/router.md`, with its `CLAUDE.md` symlink: each
  written only when nothing sits at its path, so an edited Router is never overwritten;
- `claudeMdExcludes` in `.claude/settings.json`: the clones' own `CLAUDE.md` and `AGENTS.md`;
- `.gitignore`: `references/*`, then the two exceptions that keep the Router tracked;
- `.ai/agentic.config.json`: an empty `references` key when the config has none, inserted so the
  file keeps its layout.

A list gains only the entries it lacks, and nothing is removed, so a repeat writes nothing. Each
file prints one line: `wrote`, `unchanged` or `refused`, and `would write` on a dry run. A settings
file or a config that is not a JSON object is refused and left as it is, and so is a `.gitignore`
that ignores `references/` itself, since git then tracks nothing under it; the run then exits 1.

## Layout

- `.claude-plugin/plugin.json` — the manifest; its `hooks` key wires the session hook.
- `hooks/session-start.sh` — the session hook.
- `config/references.schema.json` — the JSON Schema of the key.
- `scripts/` — `references-sync.ts` the Sync, `references-key.ts` the parser of the key, `pins.ts`
  the version a ref's `{name}` resolves to, `references-setup.ts` the setup. No dependencies, and no
  import from another plugin.
- `skills/sdlc-references-add/` — the skill that adds a Reference.
- `templates/router.md` — the Router the setup writes.
- `test/` — `harness.ts` builds throwaway repositories apart from the machine's git config and
  spawns a script or a hook the way its caller does; `hooks/session-start.test.ts` feeds the hook a
  `SessionStart` payload, `scripts/references-sync.test.ts` drives the Sync's CLI against upstreams
  served over `file://`, `scripts/references-setup.test.ts` the setup's with `--root`,
  `scripts/references-key.test.ts` runs one case list through the parser and the schema, the latter
  on the guardrails validator in the test only.
