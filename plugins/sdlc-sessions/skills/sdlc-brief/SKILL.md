---
name: sdlc-brief
description: Turn an issue, a spec, a Recap's follow-up or an idea from the conversation into a Brief, the fixed-shape start of a Worker session, with the model and effort it runs on and three ways out.
argument-hint: "[#issue | spec path | follow-up | idea] [model or effort]"
disable-model-invocation: true
---

# sdlc-brief

The dev wants a new session to take this work, and a Brief gives them its start in one shape. It runs in
any terminal, and it starts nothing itself.

## Read

1. `${CLAUDE_PLUGIN_ROOT}/templates/brief.md`: the form and its rules, the routing of model and effort, the
   Worker's name, where the config comes from and the start line. Follow it.
2. The source `$ARGUMENTS` names, or the conversation's current work when it names none: an issue with
   `gh issue view <n> --comments`, a spec from its file, a follow-up from the Recap above. Read it to judge
   its kind and scope; a Brief points at it and retells none of it.
3. The config, as the template says: `node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" config`.

When you cannot tell what the work is, ask one question and stop. A model or an effort in the dev's words,
in `$ARGUMENTS` or the conversation, is their word on the routing. A Lead's terminal in their words makes
the Brief one for that Lead: its Questions and Report lines take the template's Lead form.

## Answer

Write it in the conversation's language around the Brief; the Brief itself stays English. A line naming the
Worker, its model and effort with the reason, then the three ways out, recommending the lightest that fits:
the start line, unless the dev said not now, when it is the issue, or they named a Lead or the Brief is one
of several to run together, when it is a Lead.

1. **Start line.** The block the template describes, at the left margin, since an indent would enter the
   Brief. The Brief is inside it, printed once, so the dev pastes one block and reads the Brief there.
2. **Issue.** A new issue whose body is the Brief, startable later with `/implement #N`. When the source is
   already an issue, the new one points at it.
3. **Lead.** The dev pastes the Brief, the text between the quotes, into a Lead's session, in herdr, and the
   Lead starts the Worker. A Brief that names no Lead yet would have its Worker report to no one, so this way
   asks for the Lead's terminal and gives the Brief again in the Lead form.

End with one line: which word picks each way.

## Then stop

Nothing runs before the dev's word. On "issue", file it with `gh issue create --title <title> --body-file
<file>`, using the Brief as the template says for an issue's body, then give the `/implement #N` line and a
start line whose first message is that line. The start line and the Lead are theirs to run: this session
starts no other session.
