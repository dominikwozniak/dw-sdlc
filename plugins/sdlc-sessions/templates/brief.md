# The Brief

What a Worker starts from. Every skill that writes a Brief reads this file, fills the form and follows
these rules, so a Brief has one shape wherever it comes from.

## The form

Fill each `<...>`, keep the words around it, and leave out a line the note below lets you drop.

```text
<kickoff line>

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

- **Kickoff line.** `/implement #<n>` when the source is an issue, `/implement <path>` when it is a spec in
  a file, and for anything else `/implement` alone, the Goal being its work.
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

In an issue's body, leave out the kickoff line: `/implement #<that issue>` starts it, and it cannot name its
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
