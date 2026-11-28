# kody — how its CLI hands an agent the next step

Read from `R/kody` on 2026-11-28, the clone at `ea80a52`. `R/kody` is `references/kody`; paths below are
relative to it. This extends `docs/research/gate/kody.md` (the gate, the checks, the primitives map),
which says nothing on the CLI's next step. The note the ticket calls `agentic-guardrails/kody.md` does
not exist; `gate/kody.md` is the kody note in this repository.

## What I read

### `nextSteps` is one place only

- A search for `nextSteps` in `packages/` and `docs/` finds three hits: the type
  `nextSteps?: Array<{ text?: string; cli?: string }>` beside `notice?: string`
  (`packages/cli/src/execution-context/client.ts:182-183`), its printing
  (`packages/cli/src/execution-context/commands.ts:429-433`), and one doc line saying the same list is
  in the `connect` success response of the OAuth page (`docs/guides/oauth.md:304-305`).
- It belongs to `kody connect` / `kody context register`, the registration of a machine, not to a
  general agent loop. The server fills it; the CLI only prints it
  (`packages/cli/src/execution-context/commands.ts:395-404` is the call).
- Text shape, one entry per step: `  <text>` and, when `cli` is set, `\n    <cli>` on its own line
  below, indented four spaces. The block is introduced by `Next steps:` and omitted when empty; the
  line before it is `registered.notice` or `Registered <name> (<ecid>).`
  (`commands.ts:429-441`).
- JSON shape: with `--json` the whole `registered` object is printed as is, `nextSteps` array inside,
  each entry `{ text?, cli? }`, both optional (`commands.ts:207-215, 434-444`). Under `--json` with
  no `--install` flag, the command then returns 0 (`commands.ts:445`).
- So kody pairs one line of prose (`text`) with an exact command (`cli`) in one entry. An entry may
  carry only one of the two. There is no field that says which steps are mechanical and which are
  judgement.

### Other places the CLI hands over a step

- **Hint inside an error message.** The CLI words the remedy in the message itself, as prose with the
  command in backticks: `Unknown command "<raw>". Run \`kody --help\` for usage.`
  (`packages/cli/src/cli.ts:355`); the unreachable-API text adds "list recent runs with
  `kody api workflowRunList`first so you do not publish twice" and "This is retryable: run read-only
  commands such as`kody dev check` again" (`packages/cli/src/network-error.ts:78-114`). A wrong
  `--api-url` answers "check --api-url / KODY_API_URL points at the Kody API host"
  (`packages/cli/src/http-error-body.ts:22`). The comment on that function says why it is short: "so
  the error stays readable" (`http-error-body.ts:2-6`).
- **Safe to retry or not, said in the error.** `requestSentStatus` returns `false` for a connect-phase
  failure ("safe to retry the same write") and `"unknown"` otherwise ("do not assume unsent")
  (`network-error.ts:55-72`). The message states "The request was not sent." or "The request may have
  been sent; outcome is unknown." (`network-error.ts:78-114`).
- **Login prints the URL and the wait.** `kody login` prints the sign-in link on every run, then
  "Waiting for you to finish signing in…" (`packages/cli/src/login-notice.ts:1-14`); the device flow
  prints the code, its expiry and "Waiting for approval…" (`login-notice.ts:69`). When the browser
  cannot open it names the next command: "press Ctrl+C and run `kody login --device` instead"
  (`login-notice.ts:16-17`).
- **Skill install is a command line in the skill.** The stub skill's whole job is two commands to
  run and a conditional ("If the CLI is not signed in and you already have Kody MCP: call `api` with
  `cliCredentialBootstrap`, then run the returned `cli_command`")
  (`packages/cli/skills/kody/SKILL.md:16-27`). `cli_command` is the same idea as `cli`: the server
  returns the exact command and the skill tells the agent to run it.

### Done, wait and error in the ship-pr loop

- The loop is a tick the agent calls again. The skill gives the command, then one rule:
  "Follow what it returns, re-ticking until `exit.done`"
  (`packages/cli/.agents/skills/ship-pr/SKILL.md:20-21`; the same line at
  `.agents/skills/ship-pr/SKILL.md:27-28`).
- The tick is `kody:@kody/kody-factory/ship-pr/tick`, a package published on the Kody platform, not
  code in this clone. A search of the clone for `exit.done` finds only the two ship-pr skills and
  four docs that use the word `done` for other things. So the shape of `exit`, of the "focused step"
  and of a wait is not in the source I could read (see Unverified).
- What the skills say about the answer, all the clone offers:
  - the root skill's description: "tick the PR, read the focused step, fix / reply / decide, and tick
    again until done (merge or park, deploy, leftover friction, Discord summary)"
    (`.agents/skills/ship-pr/SKILL.md:3-8`). One step at a time, and `done` covers both merged and
    parked.
  - "Run every follow-up tick suggests (`decide`, `reply-review`, `reply-comment`, `review-sort`,
    `merge`) from `kody:@kody/kody-factory/ship-pr/*` with `--org kody`"
    (`.agents/skills/ship-pr/SKILL.md:30-32`). The tick suggests follow-up commands, so the answer
    carries commands for the mechanical steps and the skill does not restate them.
  - failure path: "If the factory tick errors, the old `kody:@kentcdodds/ship-pr/*` ... still works:
    run the whole loop there, and file friction" (`.agents/skills/ship-pr/SKILL.md:36-38`). An error
    is a fallback to another loop, with a record of the friction, not a retry.
  - a login error is named by its text: "If the CLI says `No login stored for org "kody"`, add a
    kody org login ..." (`.agents/skills/ship-pr/SKILL.md:20-25`).
- No wait in the tick is visible. The only waits in the CLI are inside a command that blocks:
  `followPackageRun` polls `packageRunResult` every 1.5 s until the run stores a result, reports
  progress only when it changes, and rejects with a typed error when the run ended without a result
  (`packages/cli/src/package-run.ts:107-172`); the login flows wait on a callback or a device-code
  poll (`login-notice.ts:13, 69`; `packages/cli/src/oauth-browser.ts:230`).
- The hosted execute does not block past the client's deadline: it returns `inProgress: true` with
  `runId` and `idempotencyKey`, and the agent polls `runGet` with the `runId`, or retries with the same
  key; "Do not start a second mutation" (`docs/use/execute.md:238-244`). This is kody's shape for "not
  done yet, here is the handle", and it is a response, not a command that waits.

### How the error is shaped

- Text: a message on stderr, exit 1 (`packages/cli/src/cli.ts:449-458`). Exit 1 is the only failure
  code `runCli` returns on this path.
- With `--json`, stdout also gets one compact line, `{"error":true,"message":...}` plus optional
  `status`, `code`, `sent` (`false` or `"unknown"`), `runId`, `idempotencyKey`
  (`cli.ts:466-507`). The fields are additive: present only when the cause has them.
- A tool result under `--json` is `{ isError, structuredContent, content }`, and the exit code is
  `result.isError ? 1 : 0` (`packages/cli/src/tool-result.ts:7-21`; `cli.ts:1537-1538`).
- The error never embeds the usage text: "Never embed full usage here: git credential helpers treat any
  unexpected stdout as protocol data" (`cli.ts:350-353`). `runCli` writes errors to stderr only.
- A run that fails before starting keeps stdout machine-readable under `--json`: "keep stdout
  machine-readable with a stable code instead of leaving it empty (kody#4067)" (`cli.ts:1541-1555`).
  A failure that leaves no stdout is a bug kody fixed.
- The JSON mode keeps stdout one document: install progress goes to stderr (`commands.ts:456-464`).

### How the skills follow the CLI

| skill                                              | lines | keeps                                                                                                            | restates `--help`? |
| -------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- | ------------------ |
| `packages/cli/skills/kody/SKILL.md`                | 30    | two commands, one sign-in branch, links to the hosted copy                                                       | no                 |
| `packages/cli/.agents/skills/ship-pr/SKILL.md`     | 36    | one command with params, "follow what it returns, re-ticking until `exit.done`", the follow-up names, a fallback | no flags listed    |
| `.agents/skills/ship-pr/SKILL.md` (root)           | 49    | the same, plus the login error and a migrations check                                                            | no                 |
| `packages/cli/.agents/skills/orchestrate/SKILL.md` | 52    | defaults, role, fan-out; no CLI command                                                                          | n/a                |

- Judgement kept in ship-pr: pick the `risk` ("pick `low`, `medium`, or `high` yourself. High means
  auth, secrets, billing, data migrations, destructive changes, or anything hard to undo") and the
  merge rule ("auto-merge low and medium once CI is green and valid reviewer feedback is handled. High
  waits for Kent unless he explicitly said to merge") (`packages/cli/.agents/skills/ship-pr/SKILL.md:33-36`).
  The root copy adds a pre-merge check no tick performs (`.agents/skills/ship-pr/SKILL.md:44-49`).
- The skill holds no table of the tick's answers. The one place it names answers is the list of
  follow-up commands, in parentheses (`...ship-pr/SKILL.md:23-24`).
- Orchestrate is prose only: "Close loops yourself", "One CI wait path — parent `gh pr checks` _or_ a
  ci-watcher, not both" (`packages/cli/.agents/skills/orchestrate/SKILL.md:27-30`). The agent waits
  with `gh`, not through a kody command.
- Stale-copy rule: the skill stub is refreshed from a hosted copy by digest ("Later CLI runs refresh
  local copies when the hosted digest changes") (`packages/cli/skills/kody/SKILL.md:29-30`), so the
  text of the loop lives with the tick, not in the installed skill.

## What I infer

- kody puts the instruction in the data the CLI returns and keeps the skill to the loop rule plus the
  judgement. This matches the planned `next`: the skill says "follow what it returns", the answer
  carries the step. The skill length is 36 lines against our `plugins/sdlc/skills/sdlc-pr-ship/SKILL.md`
  at 133.
- kody's `{ text, cli }` is a flat pair with no marker for mechanical or judgement. Our planned split
  (a command for a mechanical step, one line plus data for a judgement step) is stricter than what
  `nextSteps` encodes. An entry with only `text` is the nearest kody has to a judgement step.
- The error wording carries the retry fact (`sent: false | "unknown"`) in both text and JSON. That is
  the nearest kody has to our `performed` and `remedy` on an interrupted call
  (`packages/dw-sdlc/src/commands/pr-ship.ts:336-343`).
- kody never blocks in the tick: it returns a step and the agent ticks again. Its blocking waits are
  commands that poll a run to a result. A `--wait` that blocks until the answer leaves `wait` follows
  `followPackageRun`, not the tick.

## Compared with the Ship script today

- Ours: one `Answer` with `status` (`act | wait | park | done`), `action`, `actor`, `reason`, optional
  `command` and `recheckAfter`, and `blockers` (`packages/dw-sdlc/src/pr/decide.ts:79-88`); a
  line `<label>: <reason>[, recheck in N s][ — <command>]` (`decide.ts:474-478`); exit codes 0 done, 10
  act, 20 wait, 30 park, 2 cannot run (`packages/dw-sdlc/src/commands/pr-ship.ts:82-87`); an
  interrupted call prints `{ error, remedy, performed }` under `--json` (`pr-ship.ts:336-343`).
- Done: kody says `exit.done` inside the answer; ours is `status: "done"` and exit 0. Both name done
  as a state of the answer. Ours is richer: kody's `done` covers merged and parked, ours splits `done`
  from `park` and gives the dev's turn its own exit code.
- Wait: kody's tick has no visible wait; ours carries `recheckAfter` and ADR 0020 has the skill start a
  background `gh pr checks <n> --watch --fail-fast` or `sleep <recheckAfter>` and call again
  (`docs/adr/0020*.md:8-13`). The planned `--wait` moves that loop into the script.
- Error: kody's `--json` error is `{ error: true, message, status?, code?, sent?, runId?,
  idempotencyKey? }` with exit 1; ours is `{ error, remedy, performed }` with exit 2. Ours has a
  `remedy` field; kody puts the remedy in the message.

## Unverified

- The `exit` object, the "focused step" and any wait or error of the factory tick: the package
  `@kody/kody-factory` is published on the platform and absent from this clone, so I could not read
  what `ship-pr/tick` returns. Only the skills' words about it are cited.
- Whether the server fills `nextSteps` with prose-only entries (no `cli`) and for which commands: only
  the client type and printer are in the clone.
- Whether any tick answer is a command string or a structured object, and how it words a judgement step.
- That the hosted `kody-cli` skill body matches the 30-line stub: it is fetched by URL
  (`packages/cli/skills/kody/SKILL.md:11-14`), which I did not fetch.
- The `exit` semantics for a parked pull request ("merge or park" is the root skill's description).
