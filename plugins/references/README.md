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
- `only` — optional, at least one path the clone holds beside the repository's top-level files,
  relative and inside the clone, a directory ending in `/`; absent, the clone holds the whole tree;
- `skip` — optional, paths the sparse checkout leaves out, relative and inside the clone; with
  `only`, each lies inside one of its paths;
- `what` and `when` — what the Reference is, and when an agent reaches for it.

With `only`, the clone holds the repository's top-level files too, since a README or a manifest
there tells an agent where the part sits. Nothing else is checked out: not the files beside a
nested path, nor a directory the repository adds later. `cursor/plugins`, read for its pstack part
alone:

```json
{
  "dir": "pstack",
  "repository": "https://github.com/cursor/plugins",
  "ref": "main",
  "only": ["pstack/", "harness/pstack/"],
  "what": "Cursor's pstack plugin. The clone holds only `pstack/` and `harness/pstack/`: 387 of its 1267 files",
  "when": "designing a plugin that ships skills and a harness"
}
```

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
fetched, sparse when `only` or `skip` names paths. The sparse checkout is set from both on every
run, so adding, changing or removing either moves the clone at the next Sync, and a move between a
branch and a tag keeps it. Each prints one line: directory, short commit, repository and ref. The
variables `git rev-parse --local-env-vars` lists are dropped, so a run from a git hook never
touches the repository that hook points at, and the terminal prompt is off.

A directory under `references/` the list does not name is reported and never deleted. When the
Router or its table is missing or behind the key, one line more names the setup to run, and when
the Router has one marker without the other, the line says so instead; neither changes the exit
code.

One Sync runs in a checkout at a time: it holds `references/.sync.lock`, with its pid inside, while
it syncs. A second one started meanwhile, a session starting beside another or `pnpm references:sync`
during a session start, waits for it, up to 30 s, then syncs. Past that it prints one line naming the
pid, exits 0 and leaves the clones to the Sync still running. `REFERENCES_SYNC_WAIT` sets the seconds
to wait. A lock whose pid is not a running process of this user, left by a killed Sync, is removed
and never waited on. A worktree has a `references/` of its own, so only Syncs in one checkout wait
on each other.

## Failures

- **Exit 2**: a key the parser refuses, a config that is not JSON, or a named dir the list lacks.
  Nothing is synced, and one line names the entry, the field and the reason.
- **Exit 1**: an entry that fails to resolve fails alone, and the rest proceed. That covers an
  unreachable repository, a missing or inexact pin, an `only` path the fetched tree lacks, a clone
  with local edits the update would overwrite, and a directory that is not a clone of its
  repository; each is left as it is. The line for a missing `only` path names it, so a renamed
  upstream folder shows at session start instead of leaving an empty clone.

## Adding a Reference

`/sdlc-references-add <repository>` adds one. Only the user invokes it. It runs the setup and shows
its lines, then does the parts that need judgment: it names the licence, picks the ref (a branch
head, or a tag or `{name}` when the repository is a dependency of this one), counts the files and
proposes `skip` for the vendored directories, writes `what` and `when`, appends the entry, runs the
setup again so the Router's table gains its row, and runs the Sync for its `dir`. When no row of the
root agent instructions points at the Router, it proposes one, phrased from the entries' `when`, and
writes it only after a yes. It commits nothing.

It takes a link to a folder on GitHub too, `https://github.com/cursor/plugins/tree/main/pstack`.
The ref is the longest branch or tag that leads the path after `tree/`, since a branch name may
hold a `/`, and the rest is the first `only` path. The skill proposes for `only` each other
directory named like it, `harness/pstack/` beside `pstack/`, with its file count, and writes one
only after a yes. The licence it names is the root's, or with none there, the one inside `only`.
It counts the files and proposes `skip` within `only`, and `what` says what the clone holds out of
the whole tree. A link that ends at the ref names the ref and no `only`.

The setup makes a repository ready to declare References:

```bash
node <plugin root>/scripts/references-setup.ts [--root <dir>] [--dry-run | --check]
```

- `references/AGENTS.md`, the Router, from `templates/router.md` when nothing sits at its path, with
  its `CLAUDE.md` symlink, written once too. On every run, the block between the Router's two
  markers: a table of each Reference's `dir` and `when`, one row per entry in the key's order with
  `|` escaped, or one line saying `/sdlc-references-add <repository>` adds one when the key is empty.
  The text around the block stays as it is, and a Router without the markers gets the block at its
  end. A formatter may pad the table and space the block, so the block is in step when its rows say
  what the key says, not when its bytes match;
- `claudeMdExcludes` in `.claude/settings.json`: the clones' own `CLAUDE.md` and `AGENTS.md`;
- `.gitignore`: `references/*`, then the two exceptions that keep the Router tracked;
- `.ai/agentic.config.json`: an empty `references` key when the config has none, inserted so the
  file keeps its layout.

A list gains only the entries it lacks, and nothing is removed, so a repeat writes nothing. Each
file prints one line: `wrote`, `unchanged` or `refused`, and `would write` on a dry run. `--check`
writes nothing and exits 1 when any file would change, so a repository's check can run it. A
settings file or a config that is not a JSON object is refused and left as it is, and so is a
`.gitignore` that ignores `references/` itself, since git then tracks nothing under it, and a Router
with one marker and not the other, or whose key fails the parser; the run then exits 1.

## Layout

- `.claude-plugin/plugin.json` — the manifest; its `hooks` key wires the session hook.
- `hooks/session-start.sh` — the session hook.
- `config/references.schema.json` — the JSON Schema of the key.
- `scripts/` — `references-sync.ts` the Sync, `references-key.ts` the parser of the key and the
  reader of the config that holds it, `pins.ts` the version a ref's `{name}` resolves to,
  `router-block.ts` the Router's block, `references-setup.ts` the setup. No dependencies, and no
  import from another plugin.
- `skills/sdlc-references-add/` — the skill that adds a Reference.
- `templates/router.md` — the Router the setup writes.
- `test/` — `harness.ts` builds throwaway repositories apart from the machine's git config and
  spawns a script or a hook the way its caller does; `hooks/session-start.test.ts` feeds the hook a
  `SessionStart` payload, `scripts/references-sync.test.ts` drives the Sync's CLI against upstreams
  served over `file://`, `scripts/references-setup.test.ts` the setup's with `--root`,
  `scripts/references-key.test.ts` runs one case list through the parser and the schema, the latter
  on the guardrails validator in the test only.
