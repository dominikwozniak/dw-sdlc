---
name: sdlc-session
description: Name this herdr session as a Lead or a Worker, or list the live sessions. Invoke it when the dev types /sdlc-session, or asks in their own words to name or rename this session or to give it a role, such as "rename this session to lead-x", "this session is the lead", "this is the orchestrator" or "name me as a worker". Not for starting Workers, which is /sdlc-delegate.
argument-hint: "[lead [topic] | worker [name] | ls]"
model: haiku
effort: low
---

# sdlc-session

A helper, never a required step: it names this session in herdr, the terminal manager, or lists the live
sessions. A Lead is a session that coordinates Workers; a Worker is one that carries a ticket itself.

Every subcommand acts on this session alone, the terminal `$HC_TERMINAL_ID`. Run the bin as
`node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts"`. Outside herdr (`printenv HC_TERMINAL_ID` prints nothing)
refuse in one line, as `/sdlc-delegate` does, and stop.

## No arguments

`/sdlc-session` alone prints this table and nothing else:

| subcommand      | what it does                                     | when to use it                                |
| --------------- | ------------------------------------------------ | --------------------------------------------- |
| `lead [topic]`  | names this session `lead-<topic>`, a Lead        | this session will hand work to Workers        |
| `worker [name]` | names this session `worker-<name>`, a Worker     | you started this session by hand for a ticket |
| `ls`            | lists every live session, its role, name, status | you lost track of which terminal is which     |

Examples: `/sdlc-session lead release-notes`, `/sdlc-session worker 12-fix-links`, `/sdlc-session ls`.

## `lead [topic]`

1. Find the name. With a topic, the name is `lead-<topic>`. Without one, take the topic from the current
   work, in this order: the issue number and a short slug (`lead-489-session-helper`), else the branch
   name, else the topic of this conversation. A topic is 1-32 characters of `a-z`, `0-9`, `-` and `_`,
   the name included: lowercase and shorten it.
2. Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" session name <name> --role lead
   ```

3. Answer in one line with the name and where it came from, such as `named lead-489-session-helper, from
   issue #489`, so the dev can correct it.

Then this session is a Lead for the rest of the conversation, with these habits:

- It writes no code and commits nothing. It turns work into tickets or Briefs, and keeps one thing at a
  time with the dev.
- Once tickets exist it offers `/sdlc-delegate` in one line and waits for the dev's go.
- The dev lifts it in their own words, such as "do it here". Then this session codes,
  and the name stays.

This is a habit, not a rule: no guard enforces it. A label alone makes no Workers this Lead's children.
When the dev asks it to take over Workers another session started, say it cannot, since herdr gives a
terminal its parent when it starts and `hc` cannot change it, and offer `/sdlc-delegate` for new work.

## `worker [name]`

For a session the dev started by hand for one ticket. The name is `worker-<name>`, or the name as given
when it already starts with `worker-`; without one, `worker-<issue>-<slug>` from the current work, as the
Lead form above finds a topic. Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" session name <name> --role worker
```

Answer in one line with the name and where it came from. This session keeps coding; no Lead lists it in
`worker ls`, since it has no parent.

## `ls`

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" session ls
```

Show the table as it is printed: role, name, address, status and folder of every live session, not only the
Workers of one Lead as `worker ls` does.

## A session that already has a name

Read it first with `hc get "$HC_TERMINAL_ID" --json`: `name` is the name herdr holds. When the dev asks for
the name it already has, say so and run nothing. A different name is a rename, and the dev's request is
the go.

## Words

The dev may say "orchestrator" for a Lead: understand it, and answer with Lead.
