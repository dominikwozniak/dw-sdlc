---
name: sdlc-pr-open
description: Open a pull request, or write or rewrite the body of one, with a title from the repository's commit convention and a body that fills its pull request template, or a fixed shape when it has none. Use it whenever you open a pull request or write, rewrite or rework a pull request body, whoever asked for the pull request, and after a review changes what the body says. It never decides to open a pull request, never merges and never starts /sdlc-pr-ship. A request to merge, to review or to check CI is never this skill.
---

# sdlc-pr-open

Open the pull request for the current branch, or rewrite the body of the one it has. The dev, a Brief
or the repository's rules decide that a pull request is wanted; this skill only does it well. It
merges nothing and does not start `/sdlc-pr-ship`, which comes after.

## 1. Read the repository

- The convention: `node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" config` prints two lines of layers,
  then JSON, on exit 1 too. Read `commit.convention` and `commit.pattern` from that JSON. Without any
  JSON, take `conventional`, and say so in one line.
- The template: look for `pull_request_template.md` in `.github/`, the root and `docs/`, in any case,
  and for a `.github/PULL_REQUEST_TEMPLATE/` folder. A folder with several: take the one that fits
  the change, else ask. GitHub applies a template only in the web form, so `--body-file` skips it and
  you fill it yourself.
- `GLOSSARY.md`, when there is one: its words go in the body.
- The base: the repository's default branch (`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`),
  unless the dev or the Brief names another.
- The Primitives block, when the repository has a catalogue of its Primitives, the guards, hooks,
  scripts, config keys and skills it exposes to an agent: the file `gate.checks.primitives.file` of the
  config names, `.ai/primitives.json` by default. Run `git fetch origin <base>`, then:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" primitives --diff origin/<base>
  ```

  It prints the block between `<!-- primitives:start -->` and `<!-- primitives:end -->`: what the
  committed change removes, adds and extends, decided by the script. Take it whole and edit nothing.
  A repository with no catalogue gets no block and no failure. Exit 2 leaves the block out; say why in
  the answer, one line, from what it printed. Never read the catalogue yourself to write it.

## 2. Write the title

The title is the subject the commit convention asks for, since a squash merge turns it into the
commit: `conventional` is `type(scope): subject`, lowercase and imperative; `ticket-key` is
`[KEY-123] type: subject`, the key coming from the branch name or the source. A `commit.pattern`
wins over the preset: the title must match it. When the key is nowhere, ask for it.

## 3. Write the body to a file

Write it to a file outside the repository, in the session's scratchpad directory when the
system prompt names one, else under `mktemp -d`. `gh` reads it with `--body-file`; a heredoc inside
the command is never the way.

**The `Closes` line.** `Closes #<n>` goes first when the work has an issue, and `<n>` is the issue the
kickoff line of a Brief names: `/implement #<n>`, or `Implement #<n>.` where the repository has no
`/implement`. Never take it from a `Source:` line, which may point
at a parent issue, a spec or another issue the work only reads. With no Brief, `<n>` is the issue the
dev names. A kickoff line that names no issue, and no issue named, leave the body without the line. A
rewrite keeps the `Closes` line of the body it replaces.

**With a template**, fill every section of it, in its order, and drop a section only when the
template itself says it is optional. The `Closes` line sits above the template's first heading. The
Primitives block goes in the template's Primitives section when it has one, in place of any block
already there; a template with no such section gets it after its description of the change.

**Without a template**, the body has this shape:

1. The `Closes` line, when there is one.
2. Why the change exists, in one to three sentences.
3. The Primitives block, when there is one.
4. `## Summary`: the smallest view that makes the point: a diff sketch, a call tree, a file tree,
   pseudocode. `references/summary-views.md` shows each, and when to pick it.
5. `## Evidence`: a before and an after from a run, such as the failing test and the passing one,
   as output or pseudocode of the test. Run it when no run exists. When the change cannot be run,
   say that in one line; never write output that was not seen.
6. `## Merge Danger`: **Door**, one-way or two-way: two-way when a revert undoes it, one-way when
   it deletes data or cannot be walked back. **Blast Radius** in one word, such as `none`,
   `consumers` or `layout`. Each gets a line only when it needs one.

Whatever the shape:

- The body is a snapshot in the present tense, as if written from scratch. After a review it is
  rewritten whole from the diff as it stands, the Primitives command run again; never append a
  section, a second block, a changelog or a "review feedback" note. History belongs to git and the
  page timeline.
- It says nothing the diff already says: no list of files, no restated code.
- A change that moves a flow or a sequence gets one small mermaid diagram, as the view of the Summary
  or in the template section that explains the change. Any other change gets none.
- It carries no "Generated with" footer.
- Plain words, short sentences, the terms of `GLOSSARY.md`.

## 4. Push and open

Take the branch name from `git rev-parse --abbrev-ref HEAD`, never `git branch --show-current`: it is
empty on a detached HEAD, which has no pull request to open.

1. Compare `git rev-parse --abbrev-ref @{u}` with `origin/<branch>`. It fails, or names another
   branch, as it does for a branch cut from `origin/main`, which tracks `origin/main`: run
   `git push -u origin <branch>`, naming the branch, so the push never goes to the base. When the
   upstream is `origin/<branch>` and commits are unpushed, `git push`.
2. Look for a pull request of the branch: `gh pr list --head <branch> --state open --json number,url`.
   `gh pr view` without a number resolves through the upstream, which may be the base's.
3. None: `gh pr create --base <base> --head <branch> --title "<title>" --body-file <file>`, with
   `--draft` when `/sdlc-pr-ship` will carry it, as a Brief's Ship line or the dev says: the Ship script
   marks it ready after its Review, so a repository that skips CI on drafts runs it once, on that head.
4. One exists: `gh pr edit <n> --body-file <file>`, and `--title` only when it breaks the convention.
   Open no second pull request.
5. Stop after the answer below. Do not merge, request a review or start `/sdlc-pr-ship`; the dev or the
   Brief decides that.

A guard that refuses a command ends the run: show what it refused.

## The answer

End with this section, in this order:

1. The outcome in one sentence: the pull request's URL, opened or with its body rewritten; when a guard
   refused a command, what it refused.
2. Nothing more: the title and the body are on the pull request.
3. `Next: <command>` in a code span as the last line, the dev's command and never run by this skill. The
   closed list:
   - a pull request opened or rewritten: `/sdlc-pr-ship <n>`, with its number;
   - a guard refused a command: no line.

Write the `Next:` line only when the dev invoked the skill. Run from a Brief, which assigns the Ship to
its next step, or called by another skill such as `implement-spec`, write none, and run nothing the line
would name.
