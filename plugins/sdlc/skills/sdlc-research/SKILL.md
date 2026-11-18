---
name: sdlc-research
description: Fan out independent subagents to research, review or map something, check what they claim and answer in the conversation. Use it only when the dev asks for subagents in so many words, such as "research subagents", "an independent subagent as a review" or "review the code (subagents) and come back to me", or types /sdlc-research. It writes no file. A question without a request for subagents is never this skill, and a file of findings in the repository is /research.
argument-hint: "[research|review|overview] <question>"
---

# sdlc-research

Fan out independent subagents on one question, check what they claim, and answer in the conversation.
It runs at the start of a prompt or in the middle of a conversation, and takes the plan or the diff
the conversation holds. It writes no file: findings kept in the repository are `/research`, which
stays.

## 1. Pick the mode and the material

The first word of the arguments names the mode; the rest is the question. With no mode, pick the one
the question fits.

| mode       | the question                                                       | the subagent                                             |
| ---------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| `research` | outside facts: a library, an API, a standard, how others solved it | reads primary sources: official docs, source code, specs |
| `review`   | is this plan, pull request or code right, and is it worth doing    | judges the material on its own                           |
| `overview` | where does this live in the code, how does it connect, before work | maps the code and cites what it finds                    |

Gather the material the question needs before you spawn: the plan or the decision from this
conversation, the diff as a command (`gh pr diff <n>`, `git diff origin/<base>...HEAD`), the paths of
the files and directories, the links.

## 2. Fan out

Spawn two to four subagents in one message, so they run in parallel. Spawn more only when the dev says
how many. Cut the work so no agent needs another's result: for `research` and `overview` by sub-question
or area of the code, for `review` one agent per lens (correctness, fit to the spec or the plan, risk and
the cost of doing it), each over the whole material.

Set `model` on each agent call, never in this skill's frontmatter: `sonnet` for `research` and
`overview`, `opus` for `review`. Use the `general-purpose` agent type, or `Explore` for `overview`.

Each brief holds:

- the question, in the dev's words;
- the material and the paths: the plan, the diff command, the files, the links;
- the form of the return: each claim with its `file:line` or its link, and what the agent read apart
  from what it inferred;
- that it changes nothing and writes no file.

A brief holds the material, never this session's hypothesis, its guess at the answer or its opinion of
the plan, and never another agent's result: an agent handed a thesis tends to confirm it.

## 3. Check what they claim

This session checks every claim that carries the verdict or an answer before it goes in: open the
`file:line`, open the link, run the quick command. A claim you did not check yourself stays in the
answer, marked `unverified`. Where two agents disagree, check that point first and say who was right.
A claim that fails the check is dropped, with a line saying the agent was wrong.

## The answer

Answer in the conversation, in this order, and write no file.

**The verdict**, first, in one or two sentences: the answer to the question, or for `review` whether the
plan, the pull request or the code stands, needs a change or should not go ahead.

**The findings.** One line each, most important first, each with its `file:line` or its link; a claim
this session did not check ends in `unverified`.

**The effort**, only when the question is whether something is worth doing: a size in files and
hours or days, and what it replaces or risks.

**Open questions**, last: what the agents could not settle and the dev can.

**Next.** `Next: <command>` in a code span as the last line, the dev's command and never run by this
skill. The closed list:

- an `unverified` finding that decides the verdict: `/sdlc-research <mode> <that claim as a question>`;
- anything else: no line.

Write the `Next:` line only when the dev invoked the skill. Called by another skill, or run from a
Brief, write none.
