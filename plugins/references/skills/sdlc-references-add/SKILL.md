---
name: sdlc-references-add
description: >-
  Add a Reference to this repository: name its licence, pick its ref and the paths its clone skips,
  write what it is and when to reach for it, append the entry to the `references` key of
  `.ai/agentic.config.json` and sync it. The first run sets the repository up: the Router, the
  exclusion of the clones' agent files, the ignore lines and the key. Safe to repeat.
argument-hint: <repository>
disable-model-invocation: true
---

# sdlc-references-add

`$ARGUMENTS` names the repository: a URL `git` can fetch, or `owner/repo` for
`https://github.com/owner/repo`. Without one, ask for it. Run every command from the repository's
root. The run commits nothing.

## 1. The setup

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/references-setup.ts"
```

Show its lines. Each file is written only when it would change, so a repository set up before shows
`unchanged` throughout, and an existing Router is never overwritten. A `refused` line ends the run:
show it and stop.

## 2. A look at the repository

When the key already lists the repository, name its `dir` and stop. Otherwise clone it into a new
temporary directory, shallow and without blobs, so the steps below read its tree without a checkout:

```bash
scout="$(mktemp -d)"
GIT_TERMINAL_PROMPT=0 git clone --quiet --depth 1 --filter=blob:none --no-checkout <repository> "$scout"
```

For a `https://github.com/` repository, add `-c credential.helper= -c 'credential.helper=!gh auth
git-credential'` after `clone`, the credentials the Sync uses: a private one clones without a
prompt, and every later read through `$scout` fetches with them. Delete `$scout` once the entry is
written.

## 3. The licence

Find the licence file at the top of the tree (`git -C "$scout" ls-tree --name-only HEAD`), read it
with `git -C "$scout" show HEAD:<file>` and name it by its SPDX id. Without one, say the repository
grants no licence. A Reference is read and never copied in, so the licence never stops the run; the
summary names it.

## 4. The ref

The default is the head of the default branch, `git -C "$scout" branch --show-current`.

When the repository is a dependency of this one, the clone sits at the release this repository runs
instead. It is one when the root `package.json` depends on a package it publishes: the `name` of its
`package.json`, or of a workspace package's in a monorepo. Find that version's tag in
`git -C "$scout" ls-remote --tags --refs origin` (`v1.2.3`, `1.2.3`, `name@1.2.3`), then:

- an exact pin, direct or `catalog:` through the default catalog of `pnpm-workspace.yaml`: the ref
  names the package, the tag with `{name}` for the version (`v{effect}`, `effect@{effect}`), so the
  clone follows every upgrade;
- a range: the tag of the version installed, `node_modules/<name>/package.json`.

No tag for the version: the default branch head, and say so. Outside Node, the tag of the version
the lockfile pins.

## 5. The paths to skip

Count the files, in all and per directory:

```bash
git -C "$scout" ls-tree -r --name-only HEAD | wc -l
git -C "$scout" ls-tree -r --name-only HEAD | awk -F/ 'NF > 1 { print $1 "/" }' | sort | uniq -c | sort -rn
```

Go a level deeper into a large directory. Propose `skip` for directories that are not what a reader
comes for and hold a large share of the files: another project's code copied in (`vendor/`,
`third_party/`, `repos/`), committed dependencies, generated output or fixtures, an app beside the
part worth reading. Give each with its count, `repos/`: 4044 of 4298 files, and ask before writing
it. A path is relative to the clone, a directory ending in `/`. Nothing like that: no `skip`.

## 6. The entry

Read the entries the key holds and write in their style. Read the repository's README
(`git -C "$scout" show HEAD:README.md`) for what it is.

- `dir`: the repository's name, its owner's in front when the name alone says little
  (`mattpocock-skills` for `mattpocock/skills`); unique in the key, and not a directory under
  `references/` that is a clone of another repository.
- `repository`: the URL, as the argument gives it or `https://github.com/owner/repo`.
- `ref` and `skip`: from steps 4 and 5; leave `skip` out when it is empty.
- `what`: what the repository is, in plain words: what it does, what it is built with, what in it is
  worth reading. With `skip`, one sentence says what the clone leaves out and how much of it that
  is: "The clone leaves out `repos/`, where it vendors Effect: 4044 of its 4298 files".
- `when`: the tasks an agent opens this clone for, as a phrase; several joined by "or".

Append the entry as the last item of the key in `.ai/agentic.config.json`, in the file's own layout.

## 7. The Sync

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/references-sync.ts" <dir>
```

Show its line. Exit 2 names the field of the entry the parser refuses: fix it and run again. Exit 1
names why the Reference failed, an unreachable repository or a missing pin; show it, leave the
entry and stop.

End with the `dir`, the licence, the ref, the `skip` with its counts, the Sync's line, and the files
the run changed, for the user to commit.
