# Claude Code 2.1.280 — facts that shape the design

Read from the docs as `.md` on 2026-09-23: `https://code.claude.com/docs/en/hooks`, `/worktrees`, `/permissions`,
`/permission-modes`, `/auto-mode-config`, `/settings`, `/settings-reference`, `/sandboxing`. The decisions
these facts shape are in `docs/specs/agentic-guardrails.md`; what follows from them for the guards is in
`agentic-guardrails.md` beside this file.

## Hooks

- Events include `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`,
  `PermissionDenied`, `UserPromptSubmit`, `SessionStart` (matcher `startup|resume|clear|compact|fork`),
  `SessionEnd`, `Stop`, `SubagentStart/Stop`, `PreCompact`, `ConfigChange`, `WorktreeCreate`,
  `WorktreeRemove`, `CwdChanged`, `FileChanged`.
- "All matching hooks run in parallel. If you define the same handler in more than one settings file,
  it runs once. A plugin's or skill's copy of the same handler stays separate." Hooks from user,
  project, local and plugin scopes therefore all run; one hook's `updatedInput` is not the next hook's
  input.
- `PreToolUse` output: `hookSpecificOutput.permissionDecision` = `allow` | `deny` | `ask` | `defer`;
  `permissionDecisionReason` (shown to the user for allow/ask, to Claude for deny); `updatedInput`
  "replaces the entire input object … Claude Code evaluates permission rules … against the input your
  hook returns"; `additionalContext`. "A hook's `ask` also forces a permission prompt in auto mode"
  (since 2.1.211). The prompt carries a label: `[settings]`, `[plugin:<name>]`, `[skill]`. `defer` is
  `-p` only.
- Exit 2 blocks the call before permission rules run, so it beats an allow rule. Deny and ask rules are
  evaluated regardless of what a hook returns.
- `PermissionRequest` fires only when a prompt is about to show; its `decision.behavior` can allow or
  deny and `updatedInput` can rewrite.
- `SessionStart` gets `CLAUDE_ENV_FILE`; `export` lines appended there are sourced before every later
  Bash command.
- Hooks run "in their own session without a controlling terminal"; the input carries `cwd`,
  `permission_mode`, `session_id`, `tool_input`, `tool_use_id`.
- Workspace trust: in an interactive session "Claude Code holds back hooks from every settings file,
  including your own `~/.claude/settings.json`, until you accept the workspace trust dialog"; a `-p`
  run treats the folder as trusted. `disableAllHooks: true` turns everything off, and a project's
  `false` overrides a user's `true`.

## Permission rules

- Bash rules match "the whole command text, with `*` standing in for any text", per subcommand after
  splitting on `&&`, `||`, `;`, `|`, `|&`, `&` and newlines. Deny and ask rules also match inside
  subshells, substitutions and loop bodies.
- Stripped before matching, not configurable: `timeout`, `time`, `nice`, `nohup`, `stdbuf`,
  `command`, `builtin`, `noglob`, bare `xargs`, and a leading assignment of known-safe variables. Deny
  and ask rules match past any leading assignment. `rtk` is not stripped, so a rule for `git status`
  does not cover `rtk git status`.
- "What a Bash rule doesn't match": `/usr/bin/curl`, `sh -c '…'`, `git -C . push`, `git 'push'` — a
  deny or ask rule "isn't a security boundary around the program".
- `permissions.defaultMode` values `auto` and `bypassPermissions` take effect only from user or
  managed settings. `.claude/settings.local.json` is added to the global git excludes the first time
  Claude Code writes it; created by hand it must be gitignored by the user.
- Read-only built-ins (`ls`, `cat`, `grep`, read-only `git` …) never prompt; a `cd` into another
  directory combined with `git` does.

## Auto mode

- The classifier blocks by default, among others: force push; `git reset --hard`, `checkout -- .`,
  `restore .`, `clean -fd`, `stash drop`, `stash clear`; `--amend` on a commit not made in the session;
  production deploys and migrations; `curl | bash`; printing a live credential; accessing a listed
  sensitive data location; `--dangerously-skip-permissions` loops. It allows by default: pushing to
  any branch of the working repository, installing declared dependencies, and "reading `.env` and
  sending credentials to their matching API" — so `.env` protection has to come from a hook or a deny
  rule, not from the classifier's defaults.
- `autoMode.allow`, `soft_deny`, `hard_deny` are arrays of prose rules. "Setting any of … without
  `"$defaults"` replaces the entire default list for that section." Force push is a `soft_deny`, so an
  `allow` exception can clear it.
- Boundaries stated in conversation are re-read from the transcript, not stored; "for a hard guarantee,
  add a deny rule instead".

## Worktrees

- `claude --worktree <name>` creates `.claude/worktrees/<name>/` on branch `worktree-<name>`;
  `EnterWorktree` does the same from inside a session. Entering a path outside `.claude/worktrees/`
  prompts for approval since 2.1.206; no permission rule suppresses it.
- `.worktreeinclude` at the project root, `.gitignore` syntax: "Only files that match a pattern and are
  also gitignored are copied." Applies to `--worktree`, subagent and desktop worktrees, never to
  `git worktree add`, and not when a `WorktreeCreate` hook replaces creation.
- Observed on 2.1.289, 2026-10-04: a pattern matching a nested git repository (`references/*/`, each a
  clone) copies nothing into a worktree `EnterWorktree` creates; the plain ignored files beside it are
  copied.
- Four isolation checks in an isolated session: file edits into the main checkout, command working
  directory in the main checkout, git redirected into it (`-C`, `--git-dir`, `GIT_DIR`, `cd`), and
  "command shape" — a command whose git use cannot be verified from its text is refused. "You can't
  turn this check off." This is what refuses `rtk git status` and why the plugin's `rtk-rewrite.sh` skips the rewrite in a linked worktree.
- "`${CLAUDE_PROJECT_DIR}` stays put … `cwd` follows Claude": a hook path keeps pointing at the main
  checkout, the input's `cwd` is the worktree.
- Approvals granted in a worktree are saved to the main checkout's `.claude/settings.local.json`.
  Untracked `.claude/skills`, `agents`, `commands` of the main checkout load in a worktree that has
  none.
- Observed on 2.1.302, 2026-10-18: a session in a linked worktree, under `.claude/worktrees/` or
  outside it, applies the `permissions.deny` of the main checkout's `.claude/settings.local.json`,
  with no copy of the file in the worktree and with an older one.
- Settings: `worktree.baseRef` (`fresh` = `origin/<default>`, `head`), `worktree.symlinkDirectories`
  (e.g. `node_modules`), `worktree.sparsePaths`, `worktree.bgIsolation` (`worktree` | `none`).
- `WorktreeCreate` "replaces that default git behavior"; the hook prints the path as the last stdout
  line; `.worktreeinclude` is then not processed. `WorktreeRemove` receives `worktree_path`; a
  non-zero exit with the directory still present fails the removal. Cleanup of git worktrees is
  automatic; unchanged unnamed worktrees are removed at exit, a periodic sweep removes subagent and
  background worktrees older than `cleanupPeriodDays` when they hold no work.

## Sandbox

- macOS uses Seatbelt, nothing to install. Keys: `sandbox.enabled`, `autoAllowBashIfSandboxed`,
  `allowUnsandboxedCommands`, `excludedCommands`, `filesystem.allowWrite|denyWrite|denyRead|allowRead`,
  `credentials.files` (`mode: deny|mask`; on macOS `mask` behaves as `deny`), `credentials.envVars`,
  `network.allowedDomains`. Writes to the main repository's shared `.git` are allowed from a linked
  worktree; `.git/hooks` and `.git/config` stay denied.
- Caveats on macOS: `docker` is incompatible (`excludedCommands`); Go-based CLIs such as `gh` may fail
  TLS verification under Seatbelt; Apple Events blocked by default.
