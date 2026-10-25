---
name: sdlc-references-add
description: >-
  Add a Reference to this repository from a repository or a link to a folder on GitHub: name its
  licence, pick its ref, the part of it its clone holds and the paths it skips, write what it is and
  when to reach for it, append the entry to the `references` key of `.ai/agentic.config.json`,
  rewrite the Router's table from the key and sync it; then propose a row for the root agent
  instructions when none points at the Router. The first run sets the repository up: the Router, the
  exclusion of the clones' agent files, the ignore lines and the key. Safe to repeat.
argument-hint: <repository | folder link>
disable-model-invocation: true
---

# sdlc-references-add

`$ARGUMENTS` names the repository: a URL `git` can fetch, `owner/repo` for
`https://github.com/owner/repo`, or a link to a folder on GitHub,
`https://github.com/<owner>/<repo>/tree/<ref>/<path>`, whose repository is
`https://github.com/<owner>/<repo>`. Without one, ask for it. Run every command from the
repository's root. The run commits nothing.

## 1. The setup

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/references-setup.ts"
```

Show its lines. Each file is written only when it would change, so a repository set up before shows
`unchanged` throughout, and an existing Router is never overwritten. A `refused` line ends the run:
show it and stop.

## 2. A look at the repository

When the key already lists the repository, name its `dir` and stop. Otherwise make a directory with
`mktemp -d`, the scout, and clone the repository into it, shallow and without blobs, so the steps
below read its tree without a checkout. Each Bash call starts a new shell, so write the scout's path
out in every command where `<scout>` stands:

```bash
GIT_TERMINAL_PROMPT=0 git clone --quiet --depth 1 --filter=blob:none --no-checkout <url> <scout>
```

`<url>` is the repository's URL, `https://github.com/owner/repo` for `owner/repo`. For a
`https://github.com/` one, add `-c credential.helper= -c 'credential.helper=!gh auth
git-credential'` after `clone`, the credentials the Sync uses: a private repository clones without
a prompt, and every later read through the scout fetches with them. Delete the scout once the entry
is written.

A folder link names a ref and a path after `tree/`. `<rest>` stands for that part of the link,
`main/pstack` for `https://github.com/cursor/plugins/tree/main/pstack`. A branch name may hold a
`/`, so the ref is the longest branch or tag that is all of `<rest>` or leads it up to a `/`:

```bash
git -C <scout> ls-remote --heads --tags --refs origin |
  awk -v rest='<rest>' '{ name = $2; sub(/^refs\/(heads|tags)\//, "", name) }
    (rest == name || index(rest, name "/") == 1) && length(name) > length(ref) { ref = name; full = $2 }
    END { print full }'
```

The line is the ref in full, `refs/heads/main`: a branch under `refs/heads/`, a tag under
`refs/tags/`, and the ref is the name after either. What follows the ref in `<rest>` is the part, the
first `only` path, a directory ending in `/`: `pstack/`. An empty line means no branch or tag leads
the link, as for a link to a commit: say so and stop. A link that ends at the ref,
`https://github.com/cursor/plugins/tree/main`, names the ref and no part.

## 3. The ref

The default is the ref the folder link names, or else the head of the default branch,
`git -C <scout> branch --show-current`.

When the repository is a dependency of this one, the clone sits at the release this repository runs
instead. It is one when the root `package.json` depends on a package it publishes: the `name` of its
`package.json`, or of a workspace package's in a monorepo. Find that version's tag in
`git -C <scout> ls-remote --tags --refs origin` (`v1.2.3`, `1.2.3`, `name@1.2.3`), then:

- an exact pin, direct or `catalog:` through the default catalog of `pnpm-workspace.yaml`: the ref
  names the package, the tag with `{name}` for the version (`v{effect}`, `effect@{effect}`), so the
  clone follows every upgrade;
- a range: the tag of the version installed, `node_modules/<name>/package.json`.

No tag for the version: the default, and say so. Outside Node, the tag of the version the lockfile
pins. A tag in place of the ref a link names is said too.

The steps below read the ref's tree as `<at>`. It is `HEAD` for the head of the default branch. Any
other ref is fetched first: a branch with `git -C <scout> fetch --quiet --depth 1 origin <branch>`,
read as `FETCH_HEAD`, and a tag with `git -C <scout> fetch --quiet --depth 1 origin tag <tag>`,
read as the tag.

## 4. The part

Only a folder link names a part. Without one, `only` stays out of the entry and the clone holds the
whole tree: go on to step 5.

The same part may sit in other directories of the tree too, `harness/pstack/` beside `pstack/`.
List every directory named like the part's last segment, `<name>`, `pstack` for `pstack/`:

```bash
git -C <scout> ls-tree -r -d --name-only <at> | awk -F/ -v name='<name>' '$NF == name { print $0 "/" }'
```

The part is one of them. When it is not, the tree at the ref holds no such directory, and the Sync
would fail the Reference: say so and stop. Count the files of the part and of each other directory
outside it:

```bash
git -C <scout> ls-tree -r --name-only <at>:<path> | wc -l
```

Propose each other directory for `only` with its count, `harness/pstack/`: 187 files, and add it
only after a yes. `only` holds the part and the directories accepted.

## 5. The licence

Find the licence file at the top of the tree, `git -C <scout> ls-tree --name-only <at>`, and at the
top of each `only` path, `git -C <scout> ls-tree --name-only <at> <path>`. Read each with
`git -C <scout> show <at>:<file>`. Name the one that covers the clone by its SPDX id and its file:
the root's, or with none there, the one inside `only`, MIT from `pstack/LICENSE`. When the root and
an `only` path, or two `only` paths, hold different ones, name each with the path it covers. Without
any, say the repository grants no licence. A Reference is read and never copied in, so the licence
never stops the run; the summary names it.

## 6. The paths to skip

Count the files of the tree at the ref:

```bash
git -C <scout> ls-tree -r --name-only <at> | wc -l
```

Then count the files per directory of what the clone holds: the whole tree, or with `only`, each of
its paths, read as `<at>:<path>` in place of `<at>`, so a line `skills/` stands for
`pstack/skills/`:

```bash
git -C <scout> ls-tree -r --name-only <at> | awk -F/ 'NF > 1 { print $1 "/" }' | sort | uniq -c | sort -rn
```

Go a level deeper into a large directory. Propose `skip` for directories that are not what a reader
comes for and hold a large share of the files: another project's code copied in (`vendor/`,
`third_party/`, `repos/`), committed dependencies, generated output or fixtures, an app beside the
part worth reading. Give each with its count, `repos/`: 4044 of 4298 files, and ask before writing
it. A path is relative to the clone, a directory ending in `/`. With `only`, propose `skip` only
inside its paths, counted out of the files they hold, since the parser refuses a `skip` path outside
them. Nothing like that: no `skip`.

## 7. The entry

Read the entries the key holds and write in their style. Read the repository's README
(`git -C <scout> show <at>:README.md`) for what it is, and with `only`, the README of each of its
paths.

- `dir`: the repository's name, or the part's when the link names one (`pstack` for
  `cursor/plugins/tree/main/pstack`), its owner's in front when the name alone says little
  (`mattpocock-skills` for `mattpocock/skills`); unique in the key, and not a directory under
  `references/` that is a clone of another repository.
- `repository`: the URL, as the argument gives it, or `https://github.com/owner/repo` for
  `owner/repo` and for any link with `tree/` in it.
- `ref`, `only` and `skip`: from steps 3, 4 and 6; leave `only` and `skip` out when they are empty.
- `what`: what the repository is, or with `only`, the part the clone holds, in plain words: what it
  does, what it is built with, what in it is worth reading. With `skip`, one sentence says what the
  clone leaves out and how much of it that is: "The clone leaves out `repos/`, where it vendors
  Effect: 4044 of its 4298 files". With `only`, the sentence says what the clone holds and how much
  of the repository that is, the files of its paths less `skip` out of the whole tree: "The clone
  holds only `pstack/` and `harness/pstack/`: 387 of its 1267 files". A `skip` then joins it after
  the paths: "less `pstack/assets/`".
- `when`: the tasks an agent opens this clone for, as a phrase; several joined by "or".

Append the entry as the last item of the key in `.ai/agentic.config.json`, in the file's own layout.

## 8. The table

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/references-setup.ts"
```

The setup again: it rewrites the Router's table from the key, the new entry's row included, and
touches nothing else in the Router. Show its line for `references/AGENTS.md`. A `refused` line
there names the field of the entry the parser refuses: fix the entry and run again.

## 9. The Sync

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/references-sync.ts" <dir>
```

Show its line. Exit 1 names why the Reference failed: an unreachable repository, a missing pin or
an `only` path the fetched tree lacks. Show it, leave the entry and stop.

## 10. The row in the root agent instructions

Read the repository's root agent instructions: `AGENTS.md`, or `CLAUDE.md` when there is no
`AGENTS.md`. When no line in them points at `references/AGENTS.md`, propose one: a row for their task
table, or one line when they have no table, with the tasks on the left phrased from the `when` of
every entry the key holds and the Router on the right, as
`| how others built a skill, hook or plugin, before designing one | references/AGENTS.md |`. Write
it only after a yes, and never rewrite a row or a line that is already there.

End with the `dir`, the licence, the ref, the `only` and the `skip` with their counts, the Sync's
line, and the files the run changed, for the user to commit.
