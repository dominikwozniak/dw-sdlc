# Agentic guardrails

## Problem

Guard hooks copied into each developer's `~/.claude/hooks/` and each repository's `.claude/hooks/`
drift, and five library functions live in every copy. The policy a guard applies, the commit pattern,
the package manager, the protected branches, sits in prose a hook parses. Every `.env*` path is
refused by name, including a repository's tracked, secret-free `.env`, and a fresh worktree lacks the
ignored files it needs with nothing telling the session so.

## Goal

- `claude plugin install guardrails@dw-sdlc` is the whole install: afterwards `~/.claude/settings.json`
  holds no hook entries and `~/.claude/hooks/` is empty, yet `git reset --hard` is
  refused in every repository.
- A repository declares its rules in `.ai/agentic.config.json`, optionally overridden by
  `.ai/agentic.config.local.json`; both validate against the shipped JSON Schema, an invalid file is
  named at session start, and the guards then run on the strictest set.
- In a repository with nothing committed: `git push --force-with-lease origin <feature>` passes,
  `git push --force` and any force to `main` or `production` is refused, a tracked `.env` is readable
  and an ignored `.env.development` is not.
- A worktree that `claude -w` or `EnterWorktree` opens sits in `.claude/worktrees/`, carries the files
  `.worktreeinclude` names, and the session's first context lists what the fresh checkout still lacks.
- `pnpm guardrails:doctor` prints one PASS / WARN / FAIL line per machine check: `jq`, the plugin,
  rtk, Safe Chain, the pnpm policy, commit signing, the resolved config.
- Every guard has a stdin-payload test asserting its exit code, and `pnpm check` runs them.

## Solution

One Claude Code plugin, `guardrails`, published from this repository's marketplace: bash guards on a
shared library, a JSON Schema for the per-repository config, a TypeScript reader, a setup skill, a
doctor and a session-start report. `plugins/guardrails/README.md` lists the guards and what each
refuses.

## Decisions

- The guards ship as one plugin from this repository's marketplace, not as files copied per
  repository (ADR 0001).
- A repository's rules are a validated `.ai/agentic.config.json` with an optional local layer, never
  prose; the shape borrows `version`, `baseBranch: "auto"` and `validation.commands` from Open Mercato
  and tolerates unknown top-level keys (ADR 0002).
- The local layer may tighten `guardrails.*` and never loosen it; everything else it overrides freely.
- Resolution order is local over committed over inferred; inference reads the package manager from
  the lockfile and sets the `conventional` commit convention, so a repository with nothing committed
  still works.
- An invalid layer is dropped whole, a loosening local file counts as invalid, and the guards then run
  on one fixed strictest set (ADR 0003).
- `commit.convention` names the subject's shape, `ticket-key` or `conventional`, never whose
  repository it is. Inference always gives `conventional`; `ticket-key` comes only from a config
  layer, and a set `commit.pattern` wins over both.
- A commit made outside the agent meets the subject rule through git's `commit-msg` hook,
  `hooks/commit-msg.sh`, on the same resolved config and the same `guard_subject_fits` in `lib.sh`.
  The trailer stays the agent's rule: a commit a person writes has no co-author to name.
- The plugin guards Node repositories and carries no stack-specific guard. `packageManagers.ruby` is
  accepted by the schema and read by nothing.
- Lease pushes pass to unprotected branches; bare force, `+refspec`, `--mirror` and any force to a
  protected branch are refused (ADR 0004). A plain push to a protected branch is refused too, from the
  same guard: the rule reads `guardrails.protectedBranches`.
- Env access is declared in the config, not written into the guard: `guardrails.envFiles` is
  `{policy, allow, deny}`, judged deny list → allow list → policy, where `git` lets a tracked file
  through and refuses one git ignores or does not know, since only a tracked file has the
  repository's word that it is secret-free (ADR 0005). Entries are globs relative to the repository
  root, `**/` for any depth; the defaults keep a repository without a config on the git rule with
  the example names allowed. The local layer may drop `allow` entries and add `deny` entries, never
  the reverse; the strictest set is `policy: deny` with both lists empty.
- `permissions.deny` is generated per repository into `.claude/settings.local.json`, in plain and
  `rtk` form, as the backstop for a machine without `jq`; `~/.claude/settings.json` gets only the
  irreversible non-git set (`rm` at `/`, `~` or `.`, `shred`, `find -delete`, `git stash clear`) and
  the one `autoMode.allow` exception for lease pushes.
- The setup writes what inference cannot get wrong later, plus the one pin the command line asks
  for: the local layer holds `$schema`, the Node package manager when the committed config leaves it
  unset, and `commit.convention` only when `--convention` names one, because a local value overrides
  a convention the repository commits later. A run without the flag keeps the pin the file holds,
  `--force` included, so the setup stays safe to repeat.
- Guards are bash 3.2 plus jq, setup and doctor are TypeScript: a hook runs on every Bash call and
  needs nothing but bash and jq. Every guard gets a payload test, because the dispatcher's trigger
  list is what a guard's own self-test cannot see.
- RTK stays and the plugin carries its hook, `rtk-rewrite.sh`, so the plugin is the one hook layer
  on a machine: it runs `rtk hook claude` and, in a linked worktree, passes a command naming `git`
  through unrewritten, because the isolation check refuses `rtk git …` and has no off switch
  (Claude Code 2.1.282, rtk 0.49.0). Hooks of one event run in parallel, so the guards judge the
  original command and never see the rewrite; permission rules see the rewritten command, so the
  setup writes every rule in both forms. Disabling the plugin disables RTK with it; the doctor fails a
  machine that wires rtk by hand as well.
- Worktrees live in `.claude/worktrees/` with `.worktreeinclude` carrying the ignored files; the
  session-start hook reports what a fresh checkout lacks and installs nothing.
- Supply chain on the machine is checked, not built: the doctor reports Safe Chain and the pnpm
  policy. Socket's Claude Code hook is out: fail-open, OAuth, and one external call per install.
- The one kill switch is on the advisory guard, `large-file-guard.sh` (`CLAUDE_MAX_WRITE_BYTES`): an
  environment variable is a bypass reachable from the very command a guard judges.
- Sandbox (Seatbelt) is a later phase: `docker` is incompatible and `gh` fails TLS under it.
- Every test runs on `node:test`, a file per process; a guard's test spawns the real hook on the real
  stdin payload and asserts the exit code and the verdict, so the subject under test is unchanged.

## Testing

- `plugins/guardrails/test/harness.ts` spawns `bash hooks/<guard>.sh` with the JSON payload on stdin;
  every input a test reads is built beside it in a scratch directory.
- The jq and TypeScript copies of the config contract run on one case list, so a change to either
  side fails there first.
- The hook tests spawn `/bin/bash`, bash 3.2 on macOS, so a bash 4 construct fails in the suite.
- The env rules are proven on scratch repositories (a tracked `.env`, an ignored `.env.development`),
  not by running the plugin inside a real one; the env lists on the same shape with a committed config
  that allows the ignored file and denies the tracked one, plus a local layer that loosens and one
  that tightens.
- A new case is confirmed by mutating the code back to the broken behaviour and watching exactly that
  case fail.

## Tasks

- [x] Task: Config contract
  - Verify: `pnpm agentic:check` passes here; `test/scripts/agentic-config.test.ts` fails a document
    that allows a force push
  - Files: `plugins/guardrails/config/agentic.config.schema.json`, `plugins/guardrails/scripts/agentic-config.ts`
- [x] Task: Plugin skeleton and shared library
  - Verify: `claude plugin validate plugins/guardrails --strict` passes; after
    `claude plugin marketplace add ./` and the install, `claude plugin list` shows `guardrails@dw-sdlc`
  - Files: `.claude-plugin/marketplace.json`, `plugins/guardrails/.claude-plugin/plugin.json`,
    `plugins/guardrails/hooks/lib.sh`
- [x] Task: Dispatcher and git guard with the lease policy
  - Verify: `test/hooks/block-dangerous-commands.test.ts` exits 2 for `git push --force`,
    `git -C sub push -f`, `git push --force-with-lease origin master` and `RTK_DISABLED=1 git push --force`,
    0 for `git push --force-with-lease --force-if-includes origin feat`
  - Files: `plugins/guardrails/hooks/bash-guard.sh`, `plugins/guardrails/hooks/block-dangerous-commands.sh`
- [x] Task: Env and credential guards decided by git
  - Verify: `test/hooks/block-env-access.test.ts` on a scratch repo with a tracked `.env` and an ignored
    `.env.local`: Read of `.env` exits 0, of `.env.local` 2, a `cp` of `.env.local` 2, `cat .env.example` 0
  - Files: `plugins/guardrails/hooks/block-env-access.sh`, `plugins/guardrails/hooks/credential-leak-guard.sh`
- [x] Task: Config-driven package-manager and commit guards
  - Verify: `test/hooks/block-non-pnpm.test.ts` lets `yarn install` through where the resolved package
    manager is not pnpm and refuses `npm install` under `packageManagers.node: pnpm`;
    `test/hooks/enforce-commit-hygiene.test.ts` accepts a subject on the convention, refuses one off it
    and refuses `git add -A`
  - Files: `plugins/guardrails/hooks/block-non-pnpm.sh`, `plugins/guardrails/hooks/enforce-commit-hygiene.sh`
- [x] Task: Session-start report
  - Verify: `test/hooks/session-start.test.ts` prints the include and setup lines from a scratch linked
    worktree and nothing from the main checkout
  - Files: `plugins/guardrails/hooks/session-start.sh`
- [x] Task: Setup skill
  - Verify: `test/scripts/guardrails-setup.test.ts`: a run against a scratch repo writes the local
    config, the exclude entries and the deny rules; a second run changes nothing; `--convention`
    pins the named preset in the local config and a repeat with or without the flag changes nothing
  - Files: `plugins/guardrails/skills/guardrails-setup/SKILL.md`, `plugins/guardrails/scripts/guardrails-setup.ts`
- [x] Task: Doctor
  - Verify: `test/scripts/guardrails-doctor.test.ts` fakes each probe and asserts its PASS / WARN /
    FAIL line; `pnpm guardrails:doctor` lists every check here
  - Files: `plugins/guardrails/scripts/guardrails-doctor.ts`
- [x] Task: RTK verification
  - Verify: `docs/research/agentic-guardrails/agentic-guardrails.md` records a source line or a run for
    each rtk question; the doctor's rtk check reflects the excluded filters
  - Files: `docs/research/agentic-guardrails/rtk.md`, `plugins/guardrails/scripts/guardrails-doctor.ts`
- [x] Task: The rtk hook ships in the plugin
  - Acceptance: `~/.claude/settings.json` wires no hook and `~/.claude/hooks/` is empty; a linked
    worktree runs `git status --short` and a main checkout still gets the rewrite. Probed on Claude
    Code 2.1.282 with rtk 0.49.0: a project `settings.json` wiring `rtk hook claude` directly makes
    `claude -p -w` refuse `git status --short` with "runs rtk with a git command among its operands",
    and the same session with no hook runs it
  - Verify: `test/hooks/rtk-rewrite.test.ts` against a fake rtk on PATH; the doctor test fails a
    user settings file that wires `rtk-hook-guard.sh` or `rtk hook claude`
  - Files: `plugins/guardrails/hooks/rtk-rewrite.sh`, `plugins/guardrails/.claude-plugin/plugin.json`,
    `plugins/guardrails/scripts/guardrails-doctor.ts`
- [x] Task: Every spelling of a whole-tree discard is refused
  - Verify: `test/hooks/block-dangerous-commands.test.ts` refuses `git checkout HEAD -- .`,
    `git checkout -f master`, `git switch --discard-changes main` and `git restore --worktree .`, and
    lets `git restore --staged .` through
  - Files: `plugins/guardrails/hooks/block-dangerous-commands.sh`
- [x] Task: `rm` at a directory's contents is refused like the directory
  - Verify: the same file refuses `rm -rf ./*`, `~/*`, `$HOME/*` and a bare `*`, and lets `rm -rf tmp/*`
    and `rm -rf *.log` through
  - Files: `plugins/guardrails/hooks/block-dangerous-commands.sh`
- [x] Task: The written local config points at a schema an editor can open
  - Acceptance: `$schema` is a `file://` URL to the schema in the marketplace's clone, whose path
    survives a plugin update; without a registered clone holding it, the `$id`. A local file that
    differs only in `$schema` is rewritten, not refused
  - Verify: `test/scripts/guardrails-setup.test.ts`
  - Files: `plugins/guardrails/scripts/guardrails-setup.ts`, `plugins/guardrails/scripts/agentic-config.ts`
- [x] Task: A subshell or a substitution is the same command
  - Verify: the guard test refuses `(rm -rf /)`, `(find . -name '*.pyc' -delete)`, `echo $(rm -rf .)`
    and `(git checkout .)`
  - Files: `plugins/guardrails/hooks/block-dangerous-commands.sh`
- [x] Task: The env guard judges a directory `Grep` whose `glob` names an env file
  - Acceptance: a `Grep` with `path` on a directory and `glob: ".env*"` is refused like a Read of each
    env file the glob reaches there, so a tracked `.env` alone passes and an ignored `.env.local` refuses
  - Verify: cases in `test/hooks/block-env-access.test.ts` and `test/hooks/lib.test.ts`
  - Files: `plugins/guardrails/hooks/block-env-access.sh`, `plugins/guardrails/hooks/lib.sh`
- [x] Task: A commit subject in single quotes with a `$` is still checked
  - Acceptance: `git commit -m 'bad subject with $X'` is refused like `git commit -m 'bad subject'`,
    and so is a double-quoted `"\$X"`; a double-quoted `"$X"` still passes as unknowable
  - Verify: cases in `test/hooks/enforce-commit-hygiene.test.ts`
  - Files: `plugins/guardrails/hooks/enforce-commit-hygiene.sh`
- [x] Task: A heredoc opener inside quotes or a comment opens nothing
  - Acceptance: `echo "a << EOF"` or `# see << EOF` on one line followed by `git reset --hard` on the
    next is refused like the bare command, and `git commit -m "docs: use <<EOF"` keeps its subject
    intact; a real opener still drops its body to the terminator, or to the end when there is none,
    which is what bash runs
  - Verify: cases in `test/hooks/lib.test.ts`, `test/hooks/bash-guard.test.ts`,
    `test/hooks/enforce-commit-hygiene.test.ts` and `test/hooks/block-env-access.test.ts`
  - Files: `plugins/guardrails/hooks/lib-text.sh`, `plugins/guardrails/hooks/enforce-commit-hygiene.sh`
- [x] Task: A commit from a terminal meets the subject rule
  - Acceptance: a `commit-msg` hook refuses a subject off the resolved `commit.pattern` and reads the
    same config as the guards; comment lines, leading blank lines and a `--verbose` diff are skipped,
    and an empty message is left to git
  - Verify: `test/hooks/commit-msg.test.ts`, the message file alone and real commits through
    `core.hooksPath`
  - Files: `plugins/guardrails/hooks/commit-msg.sh`, `plugins/guardrails/hooks/lib.sh`, `.husky/commit-msg`

Open work on the plugin is tracked in GitHub Issues.

## Out of scope

- Sandbox: a later phase.
- Stack-specific guards: the plugin guards Node repositories only.
- Socket's Claude Code hook: fail-open and OAuth.
- Paid supply-chain tiers (Aikido Device Protection, Socket Enterprise): only if more ecosystems or
  fleet enforcement become a requirement.
- Codex sessions and `~/.codex/worktrees/`: hooks are a Claude Code mechanism.
- hookify rules: advisory only; guards stay shell.
- Running `worktree.setup` automatically: reporting first, installing once the timings are known.
- Resolving the config once in the dispatcher instead of in each guard: about 0.2 s saved on a
  `git commit`, at the price of every guard's standalone interface.
- Quoting the typed command instead of the heredoc-stripped scan in a refusal: the model reads either.

## Notes

- The guards judge the commands that edit them: a test string such as `npm install`, a file named
  `.env*` or a `cp` of one is refused at Write or Bash time. Build such strings at runtime
  (`N=".en""v"`).
- Schema validation is a dependency-free subset interpreter, `plugins/guardrails/scripts/json-schema.ts`;
  a keyword outside its subset throws. `ajv` would replace it at the cost of a pinned dependency.
- The bash guards re-implement the merge in jq (`lib.sh`, `config.jq`): two enums ordered strict-first
  (`STRICTNESS`), one superset list, any invalid layer → `STRICTEST_GUARDRAILS`. The TypeScript reader
  and `test/scripts/agentic-config.test.ts` are the reference behaviour.
- The plugin is self-contained: its TypeScript lives in `plugins/guardrails/scripts/`, because a
  marketplace install copies `plugins/guardrails/` alone. The repository's `scripts/` keeps repo
  tooling only.
- `hooks/schema.jq` and `hooks/config.jq` are the jq twins of the TypeScript contract.
- The hooks' shebang is `/bin/bash`, bash 3.2 on macOS; the guards stay free of bash 4 (`${var,,}`,
  `declare -A`, `mapfile`) and the hook tests, which spawn that bash, prove it.
- `git push` is parsed word by word (`guard_words`, `guard_unwrap_words` in `lib-words.sh`, `check_push` in
  the guard), not regex-matched: a new push spelling gets a `case` arm there. The other destructive
  commands stay regex arms over the wrapper boundary.
- The env guard asks git per candidate token (`ls-files --error-unmatch`, then `check-ignore` for the
  reason) with an absolute path, so a path outside the work tree fails as untracked; the config and
  the repository root are resolved once, and only when a token looks like an env file.
- A repository that wants no subject check sets `commit.pattern: ".+"`; there is no `none` value: the
  inferred pattern is the default, the config the override.
- For `SessionStart` plain stdout reaches Claude as context; the report uses the JSON
  `additionalContext` form anyway, and plain text only for the jq-missing line, which has no jq to
  build JSON with. Silence is no output, not empty JSON.
- The include list and the setup commands are worktree-only. A linked worktree is `--git-dir`
  differing from `--git-common-dir`, both `--path-format=absolute` (git 2.31+).
- An ask is a verdict: a guard prints the JSON and exits 0, the dispatcher stops the chain at the
  first non-empty stdout, and the always-on guards run first so a refusal beats a later ask. Inside
  one guard asks are collected and returned once, after every segment was judged.
- The git helpers in `lib.sh` (`guard_git_verb`, `guard_parse_push`, `guard_push_targets`,
  `guard_protected`, `guard_worktree_main`, `guard_segments`) set globals and never print, because a
  caller capturing stdout runs them in a subshell and loses the words.
- The generated `permissions.deny` uses exact or end-anchored spellings only: a prefix rule such as
  `Bash(git push --force *)` would also match `--force-with-lease`, the one form the plugin lets
  through, and a permission rule sees the rtk-rewritten command, so every git rule ships twice.
- `"$defaults"` is added only to an `autoMode.allow` the setup creates: a list the user wrote without
  it replaced the built-ins on purpose. In a linked worktree the local config goes to the worktree and
  the exclude and the local settings to the main checkout.
- The doctor probes the shell the agent gets, `$SHELL -l -c 'command -v …'`, a login shell that is not
  interactive, so an alias-only Safe Chain shows as `npm` resolving to a function, the `--ci` shims as
  a path under `.safe-chain`. A check that does not apply here gives INFO, never a false WARN. It
  exits 1 on a FAIL.
- `marketplace.json` and `plugin.json` carry one version; `claude plugin update` refreshes a cache copy
  by version only, so a change ships with a bump.
- The `ticket-key` preset takes a short type list: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`,
  `perf`, `ci`. The `conventional` preset adds `build`, `revert` and `style`, and an optional scope.
