# Skill triggers — how a test proves a skill loads, and how one skill starts another

Read on 2026-11-28 from the Claude Code docs as `.md`: `https://code.claude.com/docs/en/plugin-evals.md`
(`§` names its headings), `/skills.md`, `/sub-agents.md`, `/headless.md`, `/plugins/cli-reference.md`; and
from this repository at `origin/main` (`7eda0f69`), Claude Code 2.1.332 on the machine. Answers issue #514.
Nothing here was run: `claude plugin eval` costs model calls, and a guard of the research session refused
to run `claude plugin eval --help`. "Read" marks a fact in a source, "Inferred" what follows from it.

## 1. What `claude plugin eval` can assert (read)

- It needs Claude Code 2.1.269 or later and git 2.31 or later (`plugin-evals` §Requirements). Every run
  and every judge grader is a real model call on the dev's account (`plugin-evals`, the note at the top).
- A suite is `evals/<case>/prompt.md` (frontmatter `max_turns`, `timeout_seconds`, `model`, `tags`,
  `allowed_tools`; the body is the prompt, sent as written) plus `graders/*.md`, optionally `case.yaml`
  (§Write and refine cases). A case with no grader fails to load.
- Six grader types: `regex`, `tool_used`, `tool_order`, `file_exists` (computed from the transcript and
  files, free) and `llm`, `baseline` (judge model, extra cost) (§Choose and weight graders). No custom-code
  graders.
- The grader that shows a skill loaded is `tool_used` with `tool: Skill` and an `input_match` regex over
  the call's JSON input. The docs' own example:
  `input_match: '"skill"\s*:\s*"(?:[\w-]+:)?your-skill-name"'`; it passes when the skill was invoked "at
  least once", also in the `plugin:skill` form (§Write a case manually). `min: 0` with `max: 0` asserts a
  tool was never called (§Grader types). For a near miss that must not load the skill, set `arm: both`
  on that grader (§Score against the no-plugin baseline).
- The docs name this use: a case "that checks whether the skill triggers"; a failing `tool_used: Skill`
  with `Δ` near zero "usually" means the description does not match the prompt's phrasing
  (§Troubleshooting, "The baseline arm shows no plugin, or delta is zero"; the Skills link in §See also).
- `tool_used: Skill` graders are `scored: false` in a two-arm run: shown as a pass/fail "plugin-fired
  indicator", out of the score, since they cannot pass without the plugin. With `--ablation none` nothing
  is excluded. If every grader of a case is excluded, they score normally (§Score against the baseline).
  So a trigger case scores on the Skill grader alone only under `--ablation none`, or with
  `arm: both` on it.
- Default: 3 runs per case per arm, with-plugin and without-plugin, so one case is 6 agent runs;
  `--ablation none --runs 1` makes it 1. Score is the mean of the runs; a case passes at
  `--threshold` (default `1.0`) (§How a case is scored, §Command options).
- Cost: reported as a list-price estimate in the summary and in `results.json` (`costUsd`);
  `--max-cost-usd` stops new runs once spent and exits 2. The docs give no per-case price.
  Exit codes: 0 pass, 1 a case below threshold or a load or run failure, 2 partial (§Run evals in CI).
- Report: a summary table (`CASE WITH W/OUT Δ RUNS COST NOTES`), `report.html` under
  `evals/results/<timestamp>/`, with each grader's verdict and explanation, and `--json` for
  `results.json` (§Create your first eval suite, §Read the report).
- Isolation: each run is a `claude -p` child with a temporary home and workspace and "only your plugin
  loaded". User settings, hooks, `CLAUDE.md`, other plugins, memory and skills are absent; no
  project-level `.claude/` loads even from a scaffold (§How runs are isolated). `Skill` is in the
  read-only tool set a case may list in `allowed_tools`; `Agent` too. `Bash`, `Write`, `Edit` need
  `--allow-tools`. Subagent types of the plugin under test load with it.
- The eval directory defaults to `evals/`; "if `evals/` is already taken by another tool", set
  `"experimental": { "evals": "quality/evals" }` in `plugin.json` or pass `--eval-dir` (§Use a different
  eval directory). The target is a path such as `./plugins/sdlc`, or an installed plugin name
  (§Choose what to evaluate).
- `skill-creator`'s evals use "its own `evals/evals.json` format, and neither tool reads the other's case
  files" (`plugin-evals`, intro; `skills.md` §Run evals with skill-creator).

## 2. What the repository has (read)

- `plugins/sdlc/evals/` holds only `sdlc-reviewer/` with an `evals.json` of the skill-creator shape
  (`plugins/sdlc/evals/sdlc-reviewer/evals.json`); no `prompt.md` anywhere. The page
  `docs/contributing/evals.md` says four skills keep evals (`:4`) and run through `/skill-creator` or
  `claude -p --plugin-dir`, outside `pnpm test` and the Gate. Those skills keep `evals/evals.json` and a
  `trigger.json` of `{ "query", "should_trigger" }` rows, for example
  `plugins/sdlc/skills/sdlc-pr-open/evals/trigger.json`, with English and Polish queries and near misses
  ("merge it", "is CI green on #88?"). `docs/contributing/evals.md:125`: a trigger set runs with
  `--plugin-dir`. No `claude plugin eval` case exists in the repository.
- `sdlc-research` has no `evals/` directory today. Its description
  (`plugins/sdlc/skills/sdlc-research/SKILL.md:3`) limits the model to a request for subagents in so many
  words, and `plugins/sdlc/test/manifest.test.ts:227-240` pins its words, including
  `/Use it only when the dev asks for subagents in so many words/`. ADR 0028 settles the same: "its
  description limiting the model to the dev's request for subagents in so many words"
  (`docs/adr/0028-sdlc-research-extends-research-and-the-model-may-start-it.md`). A new description that
  matches "research na wielu subagentach" and "zbadaj, nie implementuj, wróć z podsumowaniem" changes
  that test and that ADR in the same commit.
- `.agents/skills/grilling/SKILL.md:1-4`: no `disable-model-invocation`; the model may load it.
  `.agents/skills/grill-with-docs/SKILL.md:4`: `disable-model-invocation: true`. Its line 7 is a skill
  telling the model "Call the Skill tool twice, for "grilling" and "domain-modeling"", so a skill that
  names another skill for the Skill tool is a pattern the repository already ships.

## 3. A skill loading another skill, and a slash in mid-message (read)

- The model's route to a skill is the Skill tool: "Claude can invoke any skill that doesn't have
  `disable-model-invocation: true`" (`skills.md` §Control who invokes a skill, `Skill(...)` permission
  rules). A skill with `disable-model-invocation: true` is out of the model's context, and "`Claude can't
  invoke the skill on its own`"; to keep Claude off a skill through the Skill tool, set it
  (`skills.md`, the callout under `user-invocable: false`). So `grilling` and `domain-modeling` can be
  loaded from `sdlc-research`; `grill-with-docs` cannot.
- When a skill is invoked, its rendered content "enters the conversation as a single message and stays
  there"; an `allowed-tools` grant clears at the next user message (`skills.md` §Skill content lifecycle).
  A second skill loaded by the model enters the same way.
- Plugin skills are namespaced `plugin:skill`; the bare name also works unless another command has it
  (`skills.md`, the name table). The eval example matches both forms.
- The docs have no sentence about a skill's body telling the model to call the Skill tool for another
  skill; what exists is the Skill tool, the permission and the invocation rules above.
- Slash commands (`skills.md` §Where you write the skill's name):

  | where                                                            | example                           | what happens                                                                                                                                              |
  | ---------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | start of the message                                             | `/deploy staging`                 | Claude Code runs the skill directly                                                                                                                       |
  | after plain text, "a separate word with no punctuation attached" | `go ahead and /deploy to staging` | nothing runs directly; the name is the dev's permission for that message, Claude may run the skill and "judges from your wording whether you asked it to" |

  A name with punctuation attached, or outside a separate word, gives no permission: "If Claude tries
  when your message doesn't include `/deploy` as a separate word with no punctuation attached, Claude
  Code blocks the call." That sentence sits under `disable-model-invocation`, so a mid-message
  `/grill-with-docs` as a separate word lets the model load it.

- Stacking (`skills.md` §Stack several skills in one message): at the terminal prompt several skills at
  the start of one message all load, up to the first plus five; "Through the Agent SDK or `claude -p`,
  Claude Code loads only the first skill, with the rest of the line as its arguments". Expansion stops at
  a forked skill or one such as `/loop`; that token and the rest become the arguments.
- Subagents: the `skills` field preloads full skill content; subagents "can still invoke unlisted
  project, user, and plugin skills through the Skill tool"; a `disable-model-invocation` skill cannot be
  preloaded (`sub-agents.md` §Preload skills into subagents).

## 4. Inferred

- To prove the skill loads on the dev's own ask: a `claude plugin eval` case per prompt, with
  `prompt.md` set to the ask in the dev's words ("research na wielu subagentach: jak X robi Y", "zbadaj,
  nie implementuj, wróć z podsumowaniem") and no skill name, `allowed_tools: [Skill]` (plus `Agent` if
  the run should reach the fan-out), and one grader
  `type: tool_used, tool: Skill, input_match: '"skill"\s*:\s*"(?:sdlc:)?sdlc-research"'`.
  Near misses ("what is a rate limiter?", "write the findings to a file in docs/research") take the same
  grader with `min: 0`, `max: 0`, `arm: both`. Run with `--ablation none --runs 3`, as that is where the
  Skill grader is scored, and `--threshold 1.0` or a lower value the dev picks for a noisy model.
- Because `plugins/sdlc/evals/` is taken by the skill-creator layout, a `claude plugin eval` suite needs
  `--eval-dir` or `experimental.evals` pointing elsewhere; the plugin manifest would change for it. The
  skill-creator `trigger.json` the repository uses today is the other route, run with `--plugin-dir` and
  read by eye; it asserts nothing by itself.
- In an eval run only `sdlc` is loaded (§1 isolation). The engineering skills (`research`, `grilling`,
  `domain-modeling`) live in `.agents/skills/` and are absent. Two consequences: the case cannot show
  `sdlc-research` winning against `/research` for the same ask, since `research` is not there; and a
  "load `grilling`" step shows only as a `Skill` call in the transcript, which `tool_used` counts, while
  the load itself would fail as an unknown skill. A grader on the call (`input_match` on `grilling`) tests
  that `sdlc-research` asked for it, not that the skill ran.
- Checking against `research` needs a run with the real skill set: `claude -p --plugin-dir
  plugins/sdlc` in the repository, with the transcript read for the first Skill call. `claude -p` sees
  `.claude/skills/`, since the isolation above is of the eval command, not of `claude -p`.
- The "`Next: /grilling`" ending is text the dev types later, at the start of a new message, so it
  expands; the docs' leading-position rule makes that the working form. A `/grilling` in the middle of
  the skill's own answer is read as prose by the model. Inside one `sdlc-research` run, loading
  `grilling` goes through the Skill tool, and `grilling` is model-invocable, so it works; naming
  `grill-with-docs` there would not.
- For "the dev's message asks for grilling": a mid-message word `/grilling` as a separate word is the
  dev's permission; "grilluj" or "grill me" in words is only the description's match. Which of the two
  `sdlc-research` should accept is a design choice for the skill, not a doc fact.
- Whether `grilling` triggers on a Polish ask is the description of `grilling`, which this repository
  does not own (pinned in `skills-lock.json`); `sdlc-research` loading it by name sidesteps that.

## Unverified

- Cost of one `claude plugin eval` case on a real model: not stated by the docs, not run.
- `claude plugin eval --help` on 2.1.332 (flag spelling): not run; a guard refused the command.
- Whether `claude plugin eval` accepts `plugins/sdlc` as a target while `evals/sdlc-reviewer/` holds
  non-case files (the docs say a directory with neither `prompt.md` nor `case.yaml` is a grouping
  directory, so it should be skipped; not run).
- Whether the model, in a run with only `sdlc` loaded, loads `sdlc-research` on the two Polish and
  English asks of the context: that is what the eval measures; nothing was run.
- Whether `Skill` calls to a skill absent from the session fail loudly or only return an error result.
- Whether a Skill call from the model in `claude -p` for a skill named `grilling` is recorded in the
  transcript the `tool_used` grader reads when the skill is unknown.
