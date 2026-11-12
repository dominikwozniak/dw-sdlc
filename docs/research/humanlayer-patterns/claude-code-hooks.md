# Claude Code hooks — the Stop payload, hook order and long Bash output

Read on 2026-11-12 from the docs as `.md`: `https://code.claude.com/docs/en/hooks`, `/hooks-guide`,
`/tools-reference`, `/env-vars`, `/settings-reference`. Run the same day on Claude Code 2.1.322 and rtk
0.49.0, with throwaway hooks in a scratch repository under `claude -p --model haiku --setting-sources
project`, which loaded no user plugin ("Registered 0 hooks from 5 plugins" in the debug log). `R/` is
`references/`; `R/humanlayer` is at `f9bd735`. The general hook facts are in
`docs/research/agentic-guardrails/claude-code.md`; this file holds what issue #365 asked. "Ran" marks
a fact observed, not only read.

## 1. The Stop payload

| field                    | what it holds                                                                      | source                      |
| ------------------------ | ---------------------------------------------------------------------------------- | --------------------------- |
| `session_id`             | the session                                                                        | `hooks#common-input-fields` |
| `transcript_path`        | the session JSONL; "written asynchronously and may lag the in-memory conversation" | `hooks#common-input-fields` |
| `cwd`                    | the working directory when the hook runs                                           | `hooks#common-input-fields` |
| `hook_event_name`        | `"Stop"`                                                                           | `hooks#common-input-fields` |
| `prompt_id`              | the user prompt being processed; the same across every Stop of one turn (ran)      | `hooks#common-input-fields` |
| `permission_mode`        | `default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`           | `hooks#common-input-fields` |
| `effort`                 | `{ "level": … }`                                                                   | `hooks#common-input-fields` |
| `stop_hook_active`       | `true` "when Claude Code is already continuing as a result of a stop hook"         | `hooks#stop-input`          |
| `last_assistant_message` | the text of Claude's final response, so no transcript parsing is needed            | `hooks#stop-input`          |
| `background_tasks`       | in-flight shells, subagents, monitors; empty when none                             | `hooks#stop-input`          |
| `session_crons`          | scheduled wakeups from `CronCreate`, `ScheduleWakeup`, `/loop`                     | `hooks#stop-input`          |

Ran: those eleven keys, and no other, reached a Stop hook; `scratchpad_dir` was absent. No field names
the files the turn changed.

- Exit 2 "Prevents Claude from stopping, continues the conversation" (`hooks#exit-code-2-behavior-per-event`).
  "Claude receives the stderr message as the explanation for why it should continue"
  (`hooks#stop-decision-control`). Ran: it arrives as a user message `Stop hook feedback:\n[<command>]: <stderr>`,
  and the transcript records it under `hookErrors`.
- The JSON alternative, on exit 0: `{"decision": "block", "reason": "…"}`; `reason` is required with
  `block`. `hookSpecificOutput.additionalContext` also continues the turn, labelled `Stop hook feedback`,
  "and no hook error notification is shown" (`hooks#stop-decision-control`).
- Stop "fire[s] whenever Claude finishes responding, not only at task completion. They don't fire on
  user interrupts. API errors fire StopFailure instead" (`hooks-guide#limitations`).
- Timeout: default 600 seconds for a `command` hook, 30 for `prompt`, 60 for `agent`; a per-hook
  `timeout` overrides it (`hooks#common-fields`). A timed-out hook's output is discarded
  (`hooks#timeouts`). The docs name no maximum.
- Changed files: the payload has none. Ran: the transcript records a `Write` or `Edit` call with its
  `file_path`, and a Bash write only as command text (`echo sea > c.txt`); it records the command as
  Claude typed it, not as a hook rewrote it. The transcript format is not documented, and it may lag.
  What a hook can read for certain is the working tree.
- SubagentStop adds `agent_id`, `agent_type` (the matcher value), `agent_transcript_path`, and its own
  `last_assistant_message`; `transcript_path` stays the main session's. A block delivers `reason`, or
  exit 2's stderr, "to the subagent as its next instruction". It also fires for Claude Code's internal
  agents (prompt suggestions, `/btw`), with an empty `agent_type`, which a hook with no matcher also
  catches (`hooks#subagentstop-input`).

## 2. Loop avoidance

- Ran: the first Stop of a run carried `stop_hook_active: false`; every later one carried `true`, also
  when Claude ran a tool between two blocks, and all of them the same `prompt_id`.
- The cap: "after stop hooks have continued the turn eight times in a row, Claude Code overrides the
  next block and ends the turn. The count of consecutive continuations resets each time Claude calls a
  tool" (`hooks#stop-input`). `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` sets it, `0` turns it off (`env-vars`).
  Ran: a hook that always blocks ran nine times; the ninth block was overridden with "A hook blocked the
  turn from ending 9 consecutive times — overriding and ending turn".
- So the cap bounds only a hook that blocks while Claude does nothing. A Gate that keeps failing while
  Claude keeps editing resets the count on every tool call and is never capped.
- The guide's fix: "Parse the `stop_hook_active` field … and exit early if it's `true`"
  (`hooks-guide#stop-hook-hits-the-block-cap`).

`R/humanlayer/.claude/hooks/stop-checks.sh`, against those facts:

| line  | what it does                                                   | what it lacks                                                                    |
| ----- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 2     | `cd "$CLAUDE_PROJECT_DIR"`                                     | it never reads stdin, so it never sees `stop_hook_active` or `cwd` (a worktree)  |
| 5-8   | exits 2 while `.git/MERGE_HEAD` exists                         | it blocks every Stop of a merge; a rebase or a cherry-pick is not checked        |
| 10-15 | `bun --bun run prebuild`, exit 2 on failure                    | `R/humanlayer/package.json` defines no `prebuild`, so it would block every Stop  |
| 17-23 | `hook:quality` (`package.json:83`), then `turbo run typecheck` | the whole repository on every turn, a question with no edit included; no timeout |

It is wired nowhere: `R/humanlayer/.claude/settings.json:1-13` holds `env` and `permissions` and no
`hooks` key, and the only tracked `hooks.json`, `R/humanlayer/apps/riptide-claude-code-plugin/hooks/hooks.json`,
loads a module, not this script.

## 3. PreToolUse order

`plugins/sdlc/.claude-plugin/plugin.json:10-25` lists `bash-guard.sh`, then `rtk-rewrite.sh`, under
one `Bash` matcher. `bash-guard.sh:46-62` runs every guard itself, in sequence, on `GUARD_COMMAND`;
`rtk-rewrite.sh:10-18` pipes the payload to `rtk hook claude` and prints its answer.

- "When an event fires, its matching hooks run in parallel" (`hooks#hook-handler-fields`). "every hook's
  command runs to completion before Claude Code merges the results. One hook returning `deny` doesn't
  stop sibling hooks from executing" (`hooks-guide#combine-results-from-multiple-hooks`). The order in
  the array is no order.
- Ran: three hooks in one group started within 6 ms of each other; the two beside the one that
  rewrote the command saw `echo MARKER one`, as typed, and the tool ran the rewrite.
- `updatedInput` "Replaces the entire input object"; "Claude Code evaluates permission rules … against
  the input your hook returns, not the input Claude sent" (`hooks#pretooluse-decision-control`).
- Several rewrites: "Claude Code doesn't merge the rewrites or guarantee which rewrite the tool runs
  with. Avoid having more than one hook rewrite the same tool's input" (`hooks-guide#limitations`).
  Ran: of two rewriting hooks, the same one won both calls; that is no guarantee.
- Decisions: "precedence is `deny` > `defer` > `ask` > `allow`", and exit 2 "routes the same way as
  `deny`" (`hooks#pretooluse-decision-control`). Ran: one hook exiting 2 while a sibling returned an
  `updatedInput` blocked the call; neither command ran, and Claude saw
  `PreToolUse:Bash hook error: [<command>]: <stderr>`.
- Ran: Claude never sees the rewritten command; the transcript's `tool_use` holds the command as typed,
  the rewrite sits only in the hook's own record. This settles Still open 4 of
  `docs/research/agentic-guardrails/agentic-guardrails.md`.
- rtk 0.49.0, `rtk rewrite`: `pnpm test`, `pnpm check` and `pnpm test 2>&1 | tail -50` stay as typed;
  `pnpm exec vp check` → `rtk pnpm exec vp check`; `pnpm vitest run` → `rtk vitest`; `cargo test | head`
  → `rtk cargo test | head`; `pnpm exec dw-sdlc gate | grep FAIL` → `pnpm exec dw-sdlc gate | rtk grep FAIL`.

## 4. Long Bash output

- Claude Code "streams a command's output to a working file as the command runs" and reads it back,
  30,000 characters by default (`tools-reference#output-limits`).
- A valid result over about 30,000 characters arrives as "the path of a file saved to the session
  directory and truncated past 64 MiB, plus a preview of up to the first 2,000 characters"
  (`tools-reference#output-limits`). Ran with `seq 1 20000` (108,894 bytes):

  ```
  <persisted-output>
  Output too large (106.3KB). Full output saved to: <config dir>/projects/<project>/<session_id>/tool-results/<id>.txt

  Preview (first 2KB):
  1 … 526
  ...
  </persisted-output>
  ```

  The file held all 108,894 bytes. The tag is `<persisted-output>`, with a hyphen;
  `R/humanlayer/.claude/hooks/block-test-output-filtering.sh:40` and `R/humanlayer/CLAUDE.md:204` write
  `<persisted_output>`.

- A failure gets "Inline up to roughly 10,000 characters; past that, a head-and-tail excerpt of that size
  cut from the read-back window, with no file path". Exit 1 counts as valid only for `grep`, `rg`,
  `egrep`, `fgrep`, `find`, `diff`, `test`, `[`, `git diff` and `git grep` (`tools-reference#output-limits`). Ran with
  `seq 1 20000; exit 1`: 10,041 characters, the first 4,988 and those up to 29,998, joined by
  `... [20012 characters truncated] ...`; nothing past the 30,000th character reached Claude, and no
  file path. A test runner's summary, printed last, is what a long failure loses.
- `BASH_MAX_OUTPUT_LENGTH` widens the read-back window up to 150,000 and leaves the inline ceilings;
  `bashOutputMaxChars`, up to 128,000, sizes both (`tools-reference#output-limits`, `settings-reference#bashoutputmaxchars`).
- A pipeline exits with its last stage: the Bash tool's zsh runs with `pipefail` off (ran), so
  `pnpm test | tail -50` is a valid result even when the tests fail.
- `R/humanlayer/.claude/hooks/block-test-output-filtering.sh:24-43` exits 2 when a test, typecheck,
  `oxlint` or `oxfmt` command is piped to `head`, `tail`, `grep`, `egrep`, `fgrep`, `rg`, `sed`, `awk`,
  `less` or `more`. Its test, `R/humanlayer/src/test/learning/bash-output-spooling-hook.test.ts:35-61`,
  spawns the script on a payload: it blocks `bun run test | tail -n 50` and a turbo typecheck piped to
  `rg`, and allows the unpiped check and `grep` on a log file. It runs in CI through `test:scripts`
  (`R/humanlayer/vitest.config.ts:8`, `.github/workflows/ci.yml:173-174`); no test checks the hook is
  wired, and it is not. `R/humanlayer/package.json:56,65` wraps `test` and `typecheck` in
  `scripts/run-silent.ts`, which prints one line on success and everything on failure.
- rtk, `src/core/tee.rs` and `tee_file.rs` at `v0.49.0`, and `docs/guide/getting-started/configuration.md`:
  a filtered command that fails with 500 bytes or more of output (`MIN_FAILURE_BYTES`, `retriever.rs:18`)
  is stored whole and rtk prints `[full output: rtk recall <hash>]` (`mode = "sqlite"`, the default) or
  `[full output: <path>]` (`mode = "tee"`, files under `~/Library/Application Support/rtk/tee/` on
  macOS, 1 MiB each, 20 kept). A successful run is stored only with `tee_on_success`. A trimmed list
  prints `[see remaining: tail -n +N <path>]`. rtk acts only on the commands it rewrites.

## What it means

For a light Gate in a Stop hook:

- Stop fires on every turn, a question included, so the hook first asks whether anything changed. The
  payload cannot say; `git status --porcelain` against a mark set earlier in the turn can, and the
  transcript's `Write` and `Edit` paths miss what Bash wrote.
- `stop_hook_active` cannot end the loop alone: it stays `true` across Claude's fixes, and the cap
  resets on each tool call. The hook bounds its own retries, per `prompt_id`, and lets Claude stop with
  the failure named once they run out.
- Exit 2 with the failing Step's last lines on stderr is the message Claude acts on. The docs cap a
  hook's stdout and `additionalContext` at 10,000 characters (`hooks#json-output`); keep stderr below it.
- The 600-second default is the bound to set below; a Gate Step that needs minutes belongs to CI.
- It reads `cwd` from the payload, not `$CLAUDE_PROJECT_DIR`, so a worktree session checks its worktree.
- A SubagentStop copy needs a matcher, or it runs for internal agents too.

For a guard that refuses check output piped into `head`, `tail`, `grep`, `sed`, `awk`, `less`, `more`:

- It runs as one more guard under `bash-guard.sh`, which sees the command as typed; rtk's rewrite of the
  last stage to `rtk grep` never reaches it, and its exit 2 beats rtk's `updatedInput`.
- Its message cannot promise a `<persisted-output>` file: a failing check gets a 10,000-character excerpt
  from the first 30,000 characters and no path. It names a redirect to a file instead, then a read or a
  grep of that file.
- The pipe hides a failure from the exit code as well as the output, with `pipefail` off.
- Its tests cover the wiring too: `plugin.json` registers the dispatcher, and the dispatcher spawns
  the guard.

## Still open

- The largest `timeout` a hook may set: the docs give defaults and no maximum.
- Whether the Bash working file of a failed command stays on disk where a hook could read it.
- SubagentStop was read, not run.
- Which of two `updatedInput`s wins: documented as unguaranteed, seen as the same one twice.
- Whether the 10,000-character cap applies to a hook's stderr: the docs name stdout and JSON fields only.
