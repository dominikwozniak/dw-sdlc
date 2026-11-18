---
status: accepted
---

# sdlc-research extends research and the model may start it

The engineering skill `research` starts one background agent that writes its findings to a Markdown
file in the repository (ADR 0019). The dev rarely wants that. In about 200 prompts they ask for
subagents in so many words, "research subagents and come back with info", "an independent subagent as
a review", "review the code (subagents) and come back to me", and want the answer in the conversation.
`research` was never invoked by hand for it.

`/sdlc-research [research|review|overview] <question>` fans out two to four independent subagents,
checks what they claim and answers in the conversation. It extends `research` and replaces none of it:
a file of findings in the repository stays `/research`, and `sdlc-research` writes none unless the dev
asks for one.

- **Model-invocable.** The skill carries no `disable-model-invocation`, and its description limits the
  model to the dev's request for subagents in so many words. A plain question never starts it, since
  a fan-out spends several agents' worth of tokens.
- **Independent.** A subagent's brief holds the question, the material and the paths, never this
  session's hypothesis or opinion, since an agent handed a thesis tends to confirm it.
- **Models per agent.** `sonnet` for `research` and `overview`, `opus` for `review`, set on each agent
  call. The skill's frontmatter sets no `model` and no `context: fork`: this session synthesises and
  checks on its own model, with the conversation in view.
- **Checked.** This session opens the `file:line` or the link behind a claim that carries the verdict.
  A claim it did not check is marked `unverified` in the answer.

## Considered Options

- Make `/research` fan out and answer in chat. Rejected: it is an engineering skill, pinned in
  `skills-lock.json`, and its file output is what the dev uses it for.
- Leave the skill user-invoked only. Rejected: the dev asks for subagents in running prose, not by
  typing a slash command.
- Run the skill in a forked context. Rejected: a review takes a plan or a diff from the conversation,
  and the synthesis needs it.

## Consequences

Two skills cover investigation, told apart by where the answer lands: `/research` leaves a file,
`/sdlc-research` answers in chat. A model that reads "research this" without a request for subagents
goes to neither unless the dev asks, and the description holds it there.
