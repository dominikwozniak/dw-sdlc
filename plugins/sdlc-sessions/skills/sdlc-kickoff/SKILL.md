---
name: sdlc-kickoff
description: Kick off new work in a session of its own. Turn an issue, a spec, a Recap's follow-up or an idea from the conversation into a Brief, then on the dev's word start a new Lead that carries it to the end, file it as an issue, or hand back a start line. Work this conversation holds, carried on as it is, goes with /handoff.
argument-hint: "[#issue | spec path | follow-up | idea] [model or effort]"
disable-model-invocation: true
---

# sdlc-kickoff

The dev wants new work to run in a session of its own, cared for by a session other than this one.
Kickoff writes its Brief and, on the dev's word, starts a new Lead in herdr that hands the Brief's work to a
Worker and stays with it to the end. Caring for the work is the Lead's: this session can close.

## Read

1. `${CLAUDE_PLUGIN_ROOT}/templates/brief.md`: the form and its rules, the routing of model and effort, the
   Worker's name, where the config comes from, the start line and the new Lead. Follow it.
2. The source `$ARGUMENTS` names, or the conversation's current work when it names none: an issue with
   `gh issue view <n> --comments`, a spec from its file, a follow-up from the Recap above. Read it to judge
   its kind and scope; a Brief points at it and retells none of it.
3. The config, as the template says: `node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" config`.
4. Where this session runs, from the repository:

   ```bash
   printenv HC_TERMINAL_ID
   git rev-parse --path-format=absolute --git-dir --git-common-dir
   ```

   It can start a Lead only when `HC_TERMINAL_ID` is set and the two git paths are the same.

When you cannot tell what the work is, ask one question and stop. A model or an effort in the dev's words,
in `$ARGUMENTS` or the conversation, is their word on the routing.

## The answer

Write it in the conversation's language around the Brief; the Brief itself stays English. A line naming the
Worker, its model and effort with the reason, then the three ways out. Recommend the lightest that fits:

- the issue, when the dev said not now;
- the start line, when this session cannot start a Lead;
- the Lead otherwise.

1. **Lead.** A new Lead, named and started as the template's new Lead says, its ticket the source: an issue
   or a spec as it is, and an idea or a follow-up filed first as an issue whose body is the Brief. The
   model and effort of this Brief follow the ticket, so the Worker runs on what the dev saw. Say the Lead's
   name and that it takes the work from here. An issue with open sub-issues runs as its sub-issues, a
   Worker each: say so.
2. **Issue.** A new issue whose body is the Brief, startable later with `/implement #N`, the implement line
   the template names. When the source is already an issue, the new one points at it.
3. **Start line.** The block the template describes, at the left margin, since an indent would enter the
   Brief. The Brief is inside it, printed once, so the dev pastes one block and reads the Brief there.

Then one line: which word picks each way, `start`, `issue` or `line`.

Then stop. Nothing runs before the dev's word. On "start", file the issue the Lead needs, if any, then
start the Lead and report it by the template's exit codes. On "issue", file it with `gh issue create
--title <title> --body-file <file>`, using the Brief as the template says for an issue's body, then give
the `/implement #N` line and a start line whose first message is that line. On "line", the start line is
theirs to run.

End with `Next: <word>` in a code span as the last line, the word that picks the way you recommended.
The closed list:

- the way you recommended: its word;
- a question asked because the work is unclear: no line.
