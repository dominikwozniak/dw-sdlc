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
- **Questions and Report, without a Lead.**
  - `on a question outside this Brief, commit nothing more, ask, and end your turn. The answer comes from the dev in this terminal.`
  - `when the work is done, end with /sdlc-recap and stop. A wait from /sdlc-pr-ship is no end: tell the dev what it waits on and end your turn, and the next message from the dev resumes it.`
- **Questions and Report, with a Lead.** When the Brief names its Lead's terminal. A Worker that ends its
  turn looks finished to its Lead, so all it stops on goes to the Lead.
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

The Brief's kind decides, never the size of the change.

| the Brief's kind                                    | model          | effort          |
| --------------------------------------------------- | -------------- | --------------- |
| a clear spec: the work is decided, its proof stated | `worker.model` | `worker.effort` |
| it needs decisions, design or reading unclear code  | `opus`         | `high`          |
| the dev named a model or an effort                  | as they said   | as they said    |

`xhigh`, `max` or `fable` only on the dev's word, which overrides either row, up or down, one value or
both. The reason names the row in a few words and retells nothing: "a clear spec", "needs a design
decision", "unclear code" or "the word of the dev".

## The Worker's name

`worker-<issue>-<slug>`, as `worker-224-brief`: the slug is one to three lowercase words from the goal,
joined by hyphens. With no issue it is `worker-<slug>`.

## The config

`worker.command`, `worker.model`, `worker.effort` and `gate.command` come from the resolved config: the
JSON the `dw-sdlc config` command prints after its two lines of layers, on exit 1 too. Each skill gives the
path it runs that command by. Where it prints no JSON, take `claude`, `sonnet` and `high`, and say so in
one line.

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
  with its Brief as the body, so the Lead reads it as an issue. A model or an effort in the dev's words
  follows the tickets, as `/sdlc-delegate #<n> fable xhigh`.
- **Name.** `lead-<n>-<slug>`, `<n>` the first ticket's issue and the slug a word or two of its title, or
  `lead-<slug>` for a spec: 1-32 of `a-z`, `0-9`, `-` and `_`.
- **Exit 0**: started, and the Lead took its first message. Tell the dev its name and address in one line.
- **Exit 1**: started, but the first message is not confirmed. Run `hc read <address> --lines 60` and tell
  the dev. Never run the command again or send the message twice.
- **Exit 2**: nothing started. Say why, and hand the dev the start line.

The command takes `worker.command` of the config without `--dangerously-skip-permissions` and without
`--worktree`: never add either, or start the Lead any other way. It refuses outside herdr, where
`HC_TERMINAL_ID` is unset, and in a linked worktree, where `git rev-parse --path-format=absolute
--git-dir --git-common-dir` prints two different paths: there the start line is the way.
