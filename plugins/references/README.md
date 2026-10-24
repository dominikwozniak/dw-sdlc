# references

The Sync for a repository's References, shipped as a plugin: the repositories an agent reads to see
how a problem was solved before, declared as the `references` key of `.ai/agentic.config.json` and
cloned under `references/`. Only the committed file is read; the local layer adds no References. A
repository without the key gets no output at all. The marketplace does not list the plugin yet, so
dw-sdlc runs its script from the checkout.

## The key

An array of entries, each with:

- `dir` — the one directory under `references/` the clone lives in, unique in the list;
- `repository` — a URL `git` can fetch; a `https://github.com/` one fetches with the GitHub CLI's
  credentials, so a private repository clones without a prompt;
- `ref` — a branch or a tag; `{name}` in it stands for the exact version the root `package.json`
  pins for package `name`, read through the default catalog of `pnpm-workspace.yaml` when the pin
  says `catalog:`;
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

## Failures

- **Exit 2**: a key the parser refuses, a config that is not JSON, or a named dir the list lacks.
  Nothing is synced, and one line names the entry, the field and the reason.
- **Exit 1**: an entry that fails to resolve fails alone, and the rest proceed. That covers an
  unreachable repository, a missing or inexact pin, a clone with local edits the update would
  overwrite, and a directory that is not a clone of its repository; each is left as it is.

## Layout

- `.claude-plugin/plugin.json` — the manifest.
- `config/references.schema.json` — the JSON Schema of the key.
- `scripts/` — `references-sync.ts` the Sync, `references-key.ts` the parser of the key, `pins.ts`
  the version a ref's `{name}` resolves to. No dependencies, and no import from another plugin.
- `test/` — `harness.ts` builds throwaway repositories apart from the machine's git config and
  spawns a script the way its caller does; `scripts/references-sync.test.ts` drives the Sync's CLI
  against upstreams served over `file://`, `scripts/references-key.test.ts` runs one case list
  through the parser and the schema, the latter on the guardrails validator in the test only.
