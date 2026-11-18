# The Brief

What a Worker starts from. Every skill that writes a Brief reads this file, fills the form and follows
these rules, so a Brief has one shape wherever it comes from.

## The form

Fill each `<...>`, keep the words around it, and leave out a line the note below lets you drop.

```text
<implement line>

Goal: <one or two sentences: what is true when this is done>
Source: <the pointer>. Read it with `<the command that reads it>`.
You are the Worker: do it yourself, start no other session. A subagent a skill runs is fine.
May write: <the paths or areas>.
Must not: <what the source or the dev rules out>, or change anything outside May write.
Proof: <what shows it is done: the checks to run and their result>.
Commit before `/code-review`: it reads `HEAD`.
Ship: open the pull request with `/sdlc-pr-open` and carry it through `/sdlc-pr-ship`. `pr.merge` in the config decides whether you end at merged or parked for the dev.
Questions: <the questions instruction>
Report: <the report instruction>
Model and effort: `<model>`, `<effort>`: <the reason, one clause>.
```

- **Implement line.** `/implement #<n>` when the source is an issue, `/implement <path>` when it is a spec in
  a file, and for anything else `/implement` alone, the Goal being its work. `/implement` and `code-review`
  are skills of the engineering skills, `mattpocock/skills`, which a Brief runs beside. When this session
  lists no `implement` skill, the implement line is `Implement #<n>.`, `Implement <path>.` or nothing, and
  with no `code-review` skill the Commit line drops `/code-review` and keeps the commit.
- **Goal.** What the work achieves, never how. It holds no acceptance criteria, design or background.
- **Source.** A Brief points at its source and never retells it, so the Worker reads the source itself and
  the Brief stays short. What only this conversation holds is no source, because a Worker cannot read it,
  so an idea or a follow-up with nothing filed has no Source line: its Goal says all it needs to.
- **May write.** Directories or areas, named from the source and the Agent map.
- **Proof.** Every acceptance criterion of the source checked, and the config's `gate.command` green, when
  they exist, named as "every acceptance criterion of #<n>" and never copied. Otherwise the check that
  shows the goal is met.
- **Commit line.** `implement` runs `code-review` before it commits, and `code-review` reads the diff from its
  fixed point to `HEAD`. With the commit first, the Review reads the change, and `/sdlc-pr-ship` skips a
  second `full` Review of a clean, unchanged head. Drop this line for read-only work.
- **Ship.** Drop this line for read-only work. The skill `/sdlc-pr-open` writes the pull request body, so the
  Brief states no rule of it.
- **A grilling.** A Brief that needs one takes the lines of [A grilling](#a-grilling) too.
- **Questions and Report, without a Lead.**
  - `on a question outside this Brief, commit nothing more, ask, and end your turn. The answer comes from the dev in this terminal.`
  - `when the work is done, end with /sdlc-recap and stop. A wait from /sdlc-pr-ship is no end: tell the dev what it waits on and end your turn, and the next message from the dev resumes it.`
- **Questions and Report, with a Lead.** When the Brief names its Lead's terminal. A Worker that ends its
  turn looks finished to its Lead, so all it stops on goes to the Lead, except a round of a grilling.
  - In the lines, replace `dw-sdlc` with the command the skill runs it by, such as
    `node "<path>/dw-sdlc/src/cli.ts"`, since a Worker may have no `dw-sdlc` on PATH.
  - `on a question outside this Brief, commit nothing more, deliver it to the Lead the way Report says, and end your turn. The answer comes from the Lead, which relays the word of the dev, or from the dev in this terminal.`
  - `end with /sdlc-recap, write it to a file and deliver it to the Lead in terminal <terminal> with dw-sdlc worker report --to <terminal> --recap <file>. When /sdlc-pr-ship answers wait, deliver its reason and its recheckAfter seconds the same way and end your turn: the Lead wakes you.`

A Brief is in English whatever the conversation's language, since an issue's body can be one. It holds no
single quote, so the start line can quote it whole: write "do not", never "don't".

In an issue's body, leave out the implement line: `/implement #<that issue>` starts it, and it cannot name its
own number before it is filed. Its Source line points at the source issue when there is one. Its Questions
and Report lines take the form without a Lead, since a filed Brief outlives a Lead and this machine's paths.

## Model and effort

The Brief's kind decides, never the size of the change. The dev's word comes before any row. Otherwise take
the first row that fits, top to bottom, except the risk row, which wins over every row above it.

| the Brief's kind                                                    | model          | effort          |
| ------------------------------------------------------------------- | -------------- | --------------- |
| mechanical, its proof a command: translation keys, a bump, a rename | `sonnet`       | `medium`        |
| a clear spec with an existing pattern to copy                       | `sonnet`       | `medium`        |
| a clear spec: the work is decided, its proof stated                 | `worker.model` | `worker.effort` |
| read-only, across many files or repositories, no decisions          | `opus`         | `medium`        |
| it needs decisions, design or reading unclear code                  | `opus`         | `high`          |
| it needs a grilling: the dev decides open questions                 | `opus`         | `high`          |
| risk: security, payments, a data migration                          | `opus`         | `xhigh`         |
| the dev named a model or an effort                                  | as they said   | as they said    |

`xhigh`, `max` or `fable` only on the dev's word, which overrides any row, up or down, one value or
both. The one exception is the risk row, which sets `xhigh` itself. The reason names the row in a few
words and retells nothing: "mechanical", "a pattern to copy", "a clear spec", "read-only, no decisions",
"needs a design decision", "unclear code", "needs a grilling", "risk" or "the word of the dev".

The Lead itself is never routed: it starts on the dev's default model, and the dev changes it in the
session.

### The dev's word

A model or an effort written with no ticket applies to every Worker of the delegation. After a ticket,
`#<n>:<model>/<effort>` applies to that ticket alone: `/sdlc-delegate #12 #13:opus/medium` runs #12 by the
table and #13 on `opus`, `medium`. Either half may be left out, as `#13:opus` or `#13:/medium`, and the
half left out comes from the word with no ticket, else from the row. The word after a ticket wins over
the word with no ticket. The plan table of the Lead shows each ticket's model and effort.

## A grilling

A Brief needs a grilling when its source holds open questions for the dev, as a section of them in an
issue, or when the dev asks for one. Decisions the Worker may take alone keep the routing's row "it needs
decisions". Its Worker settles the open questions with the dev, in its own terminal, before any code:

- **Must not** opens with
  `decide the open questions alone: before any code, grill the dev in this terminal with /grill-with-docs, questions in <the conversation's language>;`.
  `grill-with-docs` is a skill of the engineering skills. Where this session lists none, the line names
  `/grilling`, and with neither, no skill.
- **Proof** opens with `every decision of the grilling carried out`.
- **Questions**, with a Lead, ends with
  `The grilling itself is with the dev in this terminal, not through the Lead.`
- **Open questions only this conversation holds**, for an idea or a Recap follow-up, go into the issue the
  work is filed as, after the Brief, under `## Open questions, for the grilling`. The Worker and its Lead
  read them there.

A Worker carries one pull request. Work that needs a grilling and may land as several pull requests, as the
source or the dev says, gets no Brief. The session that holds it grills it, as the Must not line names the
skill, and cuts it into tickets with `/to-tickets`, or files each ticket by hand where it lists no such
skill, then kicks off the tickets. A Recap lists such work as an `issue` follow-up, its body the open
questions and no Brief. Work already cut, as an issue with open sub-issues, is no such work.

## The Worker's name

`worker-<issue>-<slug>`, as `worker-224-brief`: the slug is one to three lowercase words from the goal,
joined by hyphens. With no issue it is `worker-<slug>`.

## The config

`worker.command`, `worker.model`, `worker.effort`, `gate.command` and `footprint` come from the resolved
config: the JSON the `dw-sdlc config` command prints after its two lines of layers, on exit 1 too. Each
skill gives the path it runs that command by. Where it prints no JSON, take `claude`, `sonnet`, `high` and
`github`, and say so in one line. Under `footprint` `local`, [Footprint local](#footprint-local) decides
where every Brief goes.

## The start line

One shell command the dev pastes into a new terminal, from the repository's main checkout, the first path
`git worktree list --porcelain` prints, and with the Brief as the first message in single quotes:

```bash
cd <main checkout> && <worker.command> --worktree <name> --model <model> --effort <effort> '<the Brief>'
```

The flags are always there, because they win over the account's settings.

## The new Lead

A session that starts work hands its care to a new Lead: a session in a herdr terminal of its own, in the
main checkout, whose first message is `/sdlc-delegate` with the tickets. The Lead writes each Worker's
Brief by these rules, starts it and stays with it to the end, so the session that started it can close.
Run, from the repository, with the path the skill runs `dw-sdlc` by:

```bash
dw-sdlc lead start --name <name> --prompt "/sdlc-delegate <tickets>" --json
```

- **Tickets.** `#<n>` for each issue, or a spec's path. Work with no source is filed first as an issue,
  with its Brief as the body, so the Lead reads it as an issue; under footprint local it is a Brief file,
  named by its path. A model and an effort follow the tickets, as `/sdlc-delegate #<n> fable xhigh`, and
  the Lead runs every Worker on them, except one whose ticket carries its own: `#<n>:fable/xhigh` sets
  them for that ticket alone, as [The dev's word](#the-devs-word) says.
- **Name.** The first ticket names the Lead, the whole name 1-32 of `a-z`, `0-9`, `-` and `_`:
  - an issue: `lead-<n>-<slug>`, `<n>` its number and the slug a word or two of its title;
  - a Brief file: its file name with `lead-` in the place of `worker-` and no `.md`, as
    `lead-release-tag-links` for `worker-release-tag-links.md`, cut to its first words to fit;
  - a spec: `lead-<slug>`, the slug a word or two of its title.
- **Exit 0**: started, and the Lead took its first message. Tell the dev its name and address in one line.
- **Exit 1**: started, but the first message is not confirmed. Run `hc read <address> --lines 60` and tell
  the dev. Never run the command again or send the message twice.
- **Exit 2**: nothing started. Say why, and hand the dev the first message, `/sdlc-delegate <tickets>`, to
  type into a session they start in herdr, in the main checkout.

The command takes `worker.command` of the config without `--dangerously-skip-permissions` and without
`--worktree`: never add either, or start the Lead any other way. It refuses outside herdr, where
`HC_TERMINAL_ID` is unset, and in a linked worktree, where `git rev-parse --path-format=absolute
--git-dir --git-common-dir` prints two different paths: there the start line is the way.

## Footprint local

When the config's `footprint` is `local`, nothing on GitHub names dw-sdlc, so no Brief is filed as an issue.
Reading an issue that already exists, such as a source, stays as it is.

- **A Brief file.** Every rule or skill that files a Brief as an issue, or the open questions of work that
  needs a grilling, writes the same text to a file instead: `<git common dir>/dw-sdlc/briefs/<name>.md`,
  the common dir being the second path `git rev-parse --path-format=absolute --git-dir --git-common-dir`
  prints, so a Worker's worktree and the main checkout read one folder that git never commits. `<name>` is
  the Worker's name. The file keeps its implement line, since no issue number starts it, and its Questions
  and Report lines take the form without a Lead.
- **The new Lead.** Its tickets name the Brief file by its path in the place of the issue it would be
  filed as: `/sdlc-delegate <path>`.
- **The issue way.** It is gone: a session that would offer to file the work for later offers the start
  line, and a Recap's `issue` follow-up becomes a Brief file whose path the dev starts later with
  `/implement <path>`.
