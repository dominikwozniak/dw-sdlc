# sdlc

The software delivery process for a Claude Code session, shipped as one plugin: deterministic guards
on the agent's tool calls, the session hooks, the Sync of a repository's [References](#references),
the skills that set a repository up, check a machine, add a Reference, open a pull request and ship it, and
the subagent that reads a change at the `light` Review depth.
Every guard is a shell hook that reads the tool call on stdin and refuses it with exit 2, or asks for
a prompt, before the call runs. The rules a repository wants come from its `.ai/agentic.config.json`; a machine adds its
own `.ai/agentic.config.local.json` on top, which may tighten `guardrails` and never loosen it. A
key neither file sets is inferred: the package manager from the lockfile, and the `conventional`
commit convention. The plugin guards Node repositories, and App Store Connect from every repository;
it carries no other stack-specific guard.

## Install

```bash
claude plugin marketplace add dominikwozniak/dw-sdlc --sparse .claude-plugin plugins packages
claude plugin install sdlc@dw-sdlc --scope user
```

The install is that one plugin, `"sdlc@dw-sdlc": true` under `enabledPlugins` in
`~/.claude/settings.json`. The marketplace lists [`sdlc-sessions`](../sdlc-sessions/README.md) beside
it, for a machine that wants the session helpers too. The hooks need `jq`. Without it every guard exits
0 and guards nothing; the doctor says so.

Added from GitHub, the plugin is a snapshot of `main` that `claude plugin update` refreshes, and
`--sparse` keeps the clone to the catalogue, the plugins and the package the `dw-sdlc` links point
at; without `packages` the plugin installs without the package. Added from a clone
(`claude plugin marketplace add ./` in the checkout), it runs live from that checkout: a change on
disk is in the next session, a broken edit included.

## Layout

- `.claude-plugin/plugin.json` — the manifest; its `hooks` key wires each hook below to its event.
- `hooks/lib.sh` — the library every guard sources: payload reader, git helpers, refusal, config
  lookup; it sources `hooks/lib-lines.sh`, the line scanners — heredoc openers and bodies,
  continuation lines — `hooks/lib-text.sh`, the text scanners — the one quote walker every
  scanner reads, substitutions, plain words — `hooks/lib-live.sh`, the live-quote readers — a
  quote handed to a shell, ended where the outer shell ends it — `hooks/lib-mask.sh`, the quote
  mask — separators inside a quote made text — `hooks/lib-words.sh`, the word readers — shell
  words, the two readers of the [launcher table](#the-command-position), the boundary — and
  `hooks/lib-git.sh`, the git readers — a verb and its options, a push and its targets, the
  current branch.
- `hooks/schema.jq`, `hooks/config.jq` — the config contract in jq: schema validation and the
  local-over-committed-over-inferred merge, the same behaviour as `dw-sdlc/src/agentic-config.ts`.
- `hooks/bash-guard.sh` — the dispatcher: one stdin read, heredoc bodies dropped once but for the
  substitutions an unquoted one runs, each guard spawned only when the command could trip it. A
  payload it cannot read, not JSON or holding U+0001 (the byte its reader splits fields on), is
  refused with exit 2 and a message saying why, since no guard could judge it; without `jq` it passes
  every call.
- `hooks/session-start.sh` and `hooks/references-sync.sh` — the two session hooks:
  [Session start](#session-start) and [the Sync at session start](#the-sync-at-session-start).
- `hooks/commit-msg.sh` — a git hook, not a Claude Code one: the Commit hook below.
- `dw-sdlc` — a link to `packages/dw-sdlc`, the package that owns the config and the TypeScript
  side: `src/agentic-config.ts` resolves the layers, `src/json-schema.ts` is the dependency-free
  schema validator, `config/agentic.config.schema.json` is the JSON Schema for
  `.ai/agentic.config.json`, and `src/cli.ts` is the `dw-sdlc` bin. Its `config` checks the config
  (`node <plugin root>/dw-sdlc/src/cli.ts config` from a repository runs it), and its `setup`,
  `doctor`, `references sync` and `references setup` are the Setup, the Doctor, the Sync and the
  References setup below, one module each under `src/commands/`, as are `pr ship`, the Ship script,
  and `pr reviewed`; both read the pull request through `src/pr/`, which holds the Ship script's
  decision too. Beside them,
  `src/references-key.ts` parses and reads `.ai/references.json`,
  `src/pins.ts` resolves a ref's `{name}`, `src/router-block.ts` writes the Router's block,
  `config/references.schema.json` is that file's JSON Schema, and `templates/router.md` is the Router
  the setup writes. `claude plugin install` copies the link as a real directory, so the installed
  plugin carries the package's code.
- `skills/sdlc-setup/`, `skills/sdlc-doctor/`, `skills/sdlc-references-add/`,
  `skills/sdlc-pr-open/`, `skills/sdlc-pr-ship/`, `skills/sdlc-sweep/` — the skills: the [Setup](#setup), the
  [Doctor](#doctor), [Adding a Reference](#adding-a-reference), [Opening a pull request](#opening-a-pull-request),
  [Shipping a pull request](#shipping-a-pull-request) and [Sweeping](#sweeping). The dev invokes each
  one, with three exceptions: the model starts `sdlc-pr-open` itself whenever it opens a pull
  request or writes its body, a Worker starts `sdlc-pr-ship` on its Brief, and `sdlc-sweep` runs
  only on the dev's "go" on a Recap follow-up.
- `agents/sdlc-reviewer.md` — the subagent of a `light` Review, which `sdlc-pr-ship` spawns as
  `sdlc:sdlc-reviewer`: [Shipping a pull request](#shipping-a-pull-request).
- `test/` — the hook tests, mirroring `hooks/`, and the manifest's: [Tests](#tests).

## Guards

- `block-dangerous-commands.sh` (always on) — refuses what destroys work the reflog cannot bring
  back, and the remote writes others build on, at every command position: indented, after a
  separator, in a subshell or a substitution, behind `sudo`, `env`, `xargs`, `timeout`, `time`,
  `nohup`, `nice`, `exec`, `stdbuf`, `find -exec`, `bash -c`, `eval`, `rtk`, a shell keyword, a
  `VAR=x`, a path or a backslash, and in a heredoc or here-string a shell reads.
  - git, read word by word: `reset --hard` with uncommitted changes; `clean` with `-f`, `-d`, `-x`, `-X` or `--force` unless
    a dry run; `branch -M` and `-C`, and `-f` or `--force` on a move, a copy or an existing branch;
    `checkout -f` or of the whole tree; `switch -f` and `--discard-changes`; a `restore` of the
    whole tree unless `--staged` alone; `stash drop` and `clear`; `worktree remove --force`;
    `reflog expire` and `delete`; `gc --prune=now|all`; `prune`; `update-ref -d`. A plain
    `branch -d` and `worktree remove` pass, because git keeps unmerged and dirty work from them
    itself. The whole tree is a pathspec of `.`, `*` or `**` behind any `./`, `./` alone, or the
    `:/` or `:(top)` magic alone or before one of those. Under `:(glob)`, a `*` stops at the top
    level and `**/*` reaches every file. Magic beyond `top`, `glob` and `icase`, such as
    `:(exclude)` or `:(attr:…)`, narrows a pathspec, so it never names the whole tree.
  - `reset --hard` passes when no tracked file in the command's repository has a staged or unstaged
    change: untracked files survive it and the reflog keeps the old HEAD. It is refused when git cannot
    answer (outside a repository, on an unborn HEAD), when a file is marked `assume-unchanged` or
    `skip-worktree`, which hides its edits from `git diff` (a sparse checkout is one), when a `-C` is computed at runtime, under
    `GIT_DIR` or `GIT_WORK_TREE`, and after any command but a literal `cd` or a git `fetch`, `status`, `log`, `show`, `diff`,
    `rev-parse`, `rev-list`, `merge-base`, `ls-files`, `branch`, `remote`, `switch` or `worktree`,
    since another command may change the tree first.
  - forced branch delete: `branch -D`, `-d -f` or `--delete --force` passes when each branch it
    names is landed: its work is on origin's base branch, `baseBranch` or under `auto` the branch of
    origin that `origin/HEAD` names. Its tip is there, or a base commit since it forked holds the
    tip's tree or the patch-id of its whole diff, as a squash merge leaves them; a branch that ends
    where it forked is not landed. Only local objects are read, never fetched in a partial clone, so
    a base fetched before the merge refuses until `git fetch`. It passes only as a command of its
    own, `[rtk] git [-C <path>] branch -D <branch>...` with a redirect at most, each branch and the
    path written out: a `cd`, a `GIT_DIR`, a pipe, a substitution, a variable or an `xargs` could
    aim git elsewhere than the guard looks. `-r` is refused.
  - push: a bare `--force`, `-f` or `+refspec` and a `--mirror` are refused; `--force-with-lease`
    and `--force-if-includes` pass to a branch outside `guardrails.protectedBranches`, behind a
    prompt under `guardrails.forcePush: ask`, and nothing passes under `deny`. A plain push to a
    protected branch is refused: those branches take pull requests. So is a remote branch deletion:
    `--delete`, `-d`, a `:branch` refspec, or `--prune` with `--all`, `--tags`, no refspec or a
    wildcard one. `--all` and a wildcard refspec count every local branch.
  - commit, merge, cherry-pick and revert: on a protected branch, under
    `guardrails.commitOnProtected: deny`. A `switch -c` or `checkout -b` earlier in the same
    command moves the branch a commit or a push is judged on.
  - gh: `repo delete`, `pr merge` or `close` with `--delete-branch`, and `api` deleting a ref or a
    repository or force-updating a ref, REST or GraphQL.
  - rm, read in place: aimed at `/`, `~`, `$HOME`, `..` and upward, the working directory by name
    (`$PWD`, `$(pwd)`, `$(git rev-parse --show-toplevel)`), `${HOME:?}` and `${PWD:?}` as well, or
    a `.git` at any path, quoted parts such as `"$dir"/.git` included, with `objects`, `refs`,
    `logs` or their contents; as any operand; `.`, `./*` or a bare `*` too, unless a `cd` or
    `pushd` earlier in the command moved below the session's directory; `find -delete`; `shred`.
- `block-env-access.sh` (file tools and Bash) — an env file (`.env`, `.env.*`, `.envrc`) is judged by
  `guardrails.envFiles` in the resolved config: a path in `deny` is refused, one in `allow` passes,
  the rest go to `policy` — `git` lets a tracked file through and refuses one git ignores or does
  not know, `deny` refuses them all. Entries are globs against the path relative to the repository
  root, `**/` meaning at any depth; the defaults are policy `git`, the `.env.example`, `.env.sample`
  and `.env.template` names allowed anywhere, nothing denied. A path outside the repository root,
  or outside any repository, is judged by its basename against the `**/` entries alone. A `Grep`
  of a directory is judged by the env files its `glob` reaches, once the glob fits an env name or a
  common environment's: `.env.local`, `.env.development`, `.env.dev`, `.env.production`, `.env.prod`,
  `.env.staging`, `.env.test`, `.env.ci`. In a Bash command a path is read from where a `cd` or
  `pushd` earlier in it left the shell, a glob is judged by the files the shell expands it to, and a
  `<rev>:<path>` such as `HEAD:.env.production` by its path.
  A file-tool payload it cannot read, not JSON or holding U+0001 in a field, is refused with exit 2
  and a message saying why; without `jq` it passes every call.
- `credential-leak-guard.sh` (always on) — refuses reading the credential stores that are not dotenv
  (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.netrc`, `~/.git-credentials`, `~/.pypirc`,
  `~/.pgpass`, the user's `~/.npmrc`, by `$HOME`, `${HOME}` or a `cd` home), filtering an
  environment dump for a credential-ish name, printing such a variable's value, and any `curl` or
  `wget` carrying one of those or a dotenv file. A dump is `env` running no command, `printenv`
  naming no variable, a bare `set`, or `export`, `declare` or `typeset` with options alone and none
  of them `-f` or `-F`, behind a launcher or by path too. A print is `echo`, `printf` or `print` of the variable, `printenv`
  naming it, `cat`, `head`, `tail` or `tee` of a here-string holding it, or `node`, `nodejs`,
  `deno`, `bun`, `python`, `ruby` or `perl` code that reads it from the environment and prints.
- `block-non-pnpm.sh` (when the command names npm, npx, yarn or bun) — refuses them where the
  resolved `packageManagers.node` is `pnpm`, inferred from the lockfile when nothing declares it;
  silent in every other repository. An option before the npm verb, `npm -g install` or
  `npm --prefix app ci`, does not hide it, and neither does a redirect among them, `npm 2>&1 install`.
  A `cd` moves the repository whose package manager counts:
  `cd app && npm install` from outside it is judged by `app`.
- `block-filtered-output.sh` (when the command holds a pipe) — refuses a check command whose
  output a later pipeline stage feeds to `head`, `tail`, `grep`, `egrep`, `fgrep`, `rg`, `sed`,
  `awk`, `less` or `more`: the pipe hides the failure and, with `pipefail` off, turns the exit code
  green. A check command is the config's `gate.command`, the command of each `gate.steps` entry and
  each `gate.checks.run` script, `dw-sdlc gate` and `dw-sdlc check`, or a runner of the built-in
  list: `vitest`, `jest`, `tsc`, `oxlint`, `eslint`, `vp check`, `rspec`, `rubocop`, `pytest`,
  `cargo test` and `go test`, behind `pnpm exec`, `bundle exec`, a path or a `VAR=x`; a pnpm option
  (`--filter app`, `-F app`, `--dir d`, `-C d`, `-r`, `-w`) or a cargo option (`--locked`,
  `--offline`, `--frozen`) before the verb does not hide it. With no config
  the list alone applies. The refusal names the command and the filter and says to run it unpiped,
  or to redirect it with `> <file> 2>&1` and read the file. `| tee` and a redirect pass, and so does
  a pipe on any other command, `git log | head`; a filter behind the `tee`, `| tee f | tail`, is
  refused, as it still hides the exit code. `guardrails.filteredOutput: "allow"` turns the
  guard off; it is `"deny"` by default.
- `block-store-writes.sh` (when the command names `asc` or a store script) — refuses an agent every
  write to App Store Connect, in every repository and with no config: `asc`, its CLI, reaches the
  whole account from any directory with the owner's Keychain key. An `asc` call passes as a read
  when its verb, the last word before the first flag, is `list`, `view`, `show`, `summary`,
  `status`, `pull`, `plan`, `diff`, `validate`, `audit`, `download`, `init`, `approve`, `sizes`,
  `specs` or `placements` (`asc docs show <guide>` included), as `asc search <query>`, which
  searches asc's own command index locally, with `--help`, with no verb at all
  (`asc --version`), or with `--dry-run` and no `--confirm`. Every other verb is refused —
  `metadata apply`, `prices set`, the asset library's `upload`, `rename`, `archive`, `unarchive`
  and `delete`, `localizations placements create`, `reorder`, `swap` and `delete` — and so is a flag
  before the command, `asc --profile x metadata pull`, whose value would hide the verb. A redirect
  among the options, `asc … 2>&1 --confirm`, ends none of them. A store
  command, `pnpm store:<name>` or `node scripts/store-<name>.ts`, runs unless it carries
  `--confirm`, quoted or not, on a continuation line, or behind `rtk`, `env`, `sudo` or `VAR=value`.
- `enforce-commit-hygiene.sh` (when the command names `git commit` or `git add`) — the subject must
  match `commit.pattern`, or the preset `commit.convention` names when no pattern is set:
  `conventional` unless a config layer sets `ticket-key`; `.+` accepts anything. The message is read
  from `-m`, and from the heredoc a `-m "$(cat <<'EOF' … EOF)"` or a `-F - <<'EOF'` hands git. It
  must carry `commit.trailer` when one is declared, and a `--trailer` counts, since git writes it
  into the message. A live backtick inside `-m` or an unquoted heredoc is refused: the shell runs it
  as a substitution, which mangles the message and still exits 0. So is a `git add` of the whole
  tree: `-A` or `--all` with no path, or a pathspec that is the whole tree: `.`, `*` and `./*`, the
  top-level magic `:/`, `:/*` and `:(top)`, `$PWD` and `$(pwd)`. `-A <paths>` stages those paths, and a
  dry run stages nothing. A commit inside a substitution or another shell is out of the guard's reach;
  the [Commit hook](#commit-hook) checks its subject.
- `large-file-guard.sh` (after a Write) — flags a file over 256 KiB once it is on disk: a pasted
  bundle, a blob, a dumped log. Advisory, so it is the one guard with a kill switch:
  `CLAUDE_MAX_WRITE_BYTES` raises or lowers the threshold, `0` disables it.
  A payload it cannot read, not JSON or holding U+0001 in a field, exits 2 with a message saying
  why; without `jq` it passes every call.
- `rtk-rewrite.sh` (Bash, not a guard) — the plugin's wiring of `rtk hook claude`, so a machine wires
  nothing by hand and `rtk init --show` reporting "Hook: not found" is expected. Without rtk it is
  silent. In a linked worktree every command goes through unrewritten: the session's isolation check
  cannot read through the `rtk` wrapper, so it would refuse the `git status` the agent typed as
  `rtk git status`, and an `ls *` as an `rtk` call with a value computed at runtime. The check has no
  off switch (Claude Code 2.1.302, rtk 0.49.0), and skipping the rewrite costs only output
  compression. It runs beside `bash-guard.sh`, and the guards judge the command before the rewrite.

## Reading a command

A guard judges a Bash command the way the shell reads it, through the scanners in `hooks/lib-*.sh`.
A rule fires on a command the shell runs, not on text that only looks like one.

### The command position

A command runs where the shell reads one: at a line start, indented or not, or after `;`, `&`, `|`,
`(` or a backtick. It runs, too, behind a launcher, a word that runs the command after it. A command
named by a path or with a leading backslash, `/usr/bin/git` or `\rm`, is that command. The launchers,
with the options that take a value, glued or as the next word:

| launcher                                                       | its options that take a value                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `then`, `do`, `else`, `elif`, `if`, `while`, `until`, `!`, `{` | none                                                             |
| `time`                                                         | `-o`, `-f` (GNU time; the keyword's `-p` takes none)             |
| `sudo`                                                         | `-u`, `-g`, `-h`, `-p`, `-U`, `-r`, `-t`, `-C`, `-D`, `-R`, `-T` |
| `env`                                                          | `-u`, `-C`, `-S`, then any `VAR=value`                           |
| `command`                                                      | none; `-p` runs the command, `-v` and `-V` only look it up       |
| `eval`, `nohup`                                                | none                                                             |
| `exec`                                                         | `-a`                                                             |
| `nice`                                                         | `-n`                                                             |
| `timeout`                                                      | `-s`, `-k`, then one duration                                    |
| `stdbuf`                                                       | `-i`, `-o`, `-e`                                                 |
| `xargs`                                                        | `-a`, `-d`, `-E`, `-I`, `-J`, `-L`, `-n`, `-P`, `-R`, `-s`, `-S` |
| `find` with `-exec`, `-execdir`, `-ok` or `-okdir`             | none; the command runs up to its `;` or `{} +`                   |
| `sh`, `bash`, `zsh`, `dash`, `ksh`                             | none; the command is the text after a `-c`, or after `<<<`       |
| `rtk`                                                          | its flags, then `run`, `proxy`, `err`, `test` or `summary`       |
| `VAR=value`                                                    | none                                                             |

`hooks/lib-words.sh` reads the table twice: `guard_unwrap_words` on words, for the guards that read
a command word by word and for a `cd`, and `GUARD_BOUNDARY` on text, for the arms that read a target
in place.
`test/hooks/lib.test.ts` holds the two to the same spellings.

### Commands and scopes

`guard_scopes`, in `hooks/lib.sh`, cuts the masked scan into the commands the shell runs, one a
line: at `;`, `&`, `|`, a newline and a subshell's parentheses, each of which also stands as a scope
line, so a `cd` inside a subshell ends with it. A redirect's `&`, as in `2>&1`, `<&0` and `&>`, is
no cut: `git push 2>&1 origin main` is one push to `main`. A `cd` or `pushd` with a literal
directory, behind its options and a `--`, moves where the shell stands. The
guard keeps the directories `pushd` saves, so a `popd` or a bare `pushd` goes back as the shell
does, and a subshell gives the stack back at its end too. `pushd` and `popd` take `-n`, which
leaves the shell where it is: `pushd -n dir` saves `dir` and `popd -n` drops the top entry. A `$(…)` or backtick substitution is one
word of the command around it, not a cut: `guard_lift_substitutions` makes it the word `$_`, a value computed at
runtime, and moves its body to a scope of its own just before that command, since the shell runs the
body first. So `git push origin "$(git branch --show-current)" --force` is one push with its
`--force`, and its body one command before it. A `$_` in the command's place, alone or glued to
it, is read as empty, as bash drops an empty expansion, so `$(true) git reset --hard` and
`$(true)git reset --hard` are a `git reset`; a `case` pattern's `)`
inside a substitution ends no substitution. One left open hands back the scan as typed, cut at each
parenthesis and backtick. `guard_segments` is the same lines without the scope lines.

### The quote walker

`guard_quote_walk <text> [<live>] [<state>] [<from>] [<stop>]`, in `hooks/lib-text.sh`, is the one
reader of shell quoting. It cuts the text into pieces, `GUARD_QW_KIND[i]` and `GUARD_QW_TEXT[i]`,
whose texts joined are the text again. The mask, the substitution split, the word reader and the
heredoc passes each loop over those pieces. A piece's kind:

| kind   | the piece                              |
| ------ | -------------------------------------- |
| `t<c>` | text read in context `<c>`             |
| `e<c>` | a backslash and the character it keeps |
| `o<c>` | what opens context `<c>`               |
| `c<c>` | what closes it                         |
| `tC`   | a comment, up to the newline           |
| `h`    | a heredoc operator and its delimiter   |

The contexts:

- `P`, the top level;
- `S` and `D`, a single- and a double-quoted span;
- `A`, an ANSI-C `$'…'` span, where a backslash escapes and the next `'` closes;
- `U`, a `$(…)`, and `V`, a bare `(` inside one;
- `B`, a backtick substitution;
- `H`, an unquoted heredoc body, where only a substitution and a backslash act;
- `E`, a `${…}`, where a quote nests even inside a `"…"`, a `(` and a `#` are text, and the first
  bare `}` closes it.

A `$'` opens `A` wherever a `'` would open `S`. A `$"…"` is a double-quoted span after a `$` of text,
and a `$` before anything else is text. A comment and a heredoc operator count only where the shell
reads a command: in `P`, `U`, `V` and `B`.

A heredoc's delimiter is a whole shell word, up to a blank or a metacharacter, and the body ends at a
line that holds its text alone, quotes and backslashes removed: `E"O"F` ends at `EOF`, and `E.O`,
`'END-OF-TEXT'` and `"END OF"` at themselves. Any quote or backslash in it keeps the body literal. It
opens with a letter, `_`, a quote or a backslash, so the `1<<2` of `$((1<<2))` opens none.

With `<live>` set, a quote after a shell's `-c`, `eval` or `rtk run` holds a command and opens `s`,
`d` or `a` instead; a shell named by a path or behind a backslash, `/bin/bash -c` or `\bash -c`, is
that shell. In `a` a backslash still escapes, so a `\'` there is text the walk does not
follow. A `${…}` in `d` opens `e`: the outer shell expands it and hands the shell what it expands to,
so its text holds the command too, and a `"…"`, `'…'` or `$'…'` in it opens `d`, `s` or `a`. The
outer shell drops those quotes, all but a `'…'` that bash 3.2 and a `:-` keep; reading that one as a
command refuses more, not less.

`GUARD_QW_STATE` is the stack the text ends in, one context per character, starting from `<state>`,
`P` by default. The walk returns 1 when it ends elsewhere, with a quote or a substitution left open.
It starts at offset `<from>`, 0 by default, and reads the text before it as what precedes it.
`<stop>` ends it early: `o` just after a quote handed to a shell opens, `c` just after the context it
starts in closes. `GUARD_QW_END` is the offset it stops at.

The walk jumps from one character that can change the context to the next, so a long quoted body
costs a step per quote, backslash and substitution, not one per character. A step reads a window of
the text, `GUARD_QW_WINDOW` characters. In bash 3.2 a substring costs the length of the string it is
taken from, so a step on the whole text would cost the text's length, and a long command the square
of it.

### Live quotes

A quote handed to a shell, a live quote, is read where the outer shell ends it.
`guard_live_span <opening kind>`, in `hooks/lib-live.sh`, reads one from the walk's pieces, which
start just after its opening quote: `os`, `oa` or `od` where a live walk opened it, `oS`, `oA` or
`oD` where the walk read it the outer shell's way. It sets:

- `GUARD_LIVE_CTX`, the context the outer shell reads it in: `S`, `A` or `D`;
- `GUARD_LIVE_RAW`, the text up to the walk's closing quote; `GUARD_LIVE_LEN`, the characters
  through that quote; `GUARD_LIVE_END`, its piece;
- `GUARD_LIVE_TEXT`, the text the shell is handed: a `$'…'` decoded, and in a `"…"` the escapes of
  `$`, a backtick, `"` and `\` undone;
- `GUARD_LIVE_SPLIT`, that text with each substitution of a `"…"` made `_`, and its body in
  `GUARD_LIVE_SUBS`, since the outer shell runs it first.

A `${…}` nests its quotes the way the outer shell does. The reader returns:

- 1 when the quote never closes;
- 2 when the outer shell may end it elsewhere than a live walk does: a `'…'` holding a `'`, a `$'…'`
  holding an unescaped `'`, a `"…"` holding a `'…'` or `$'…'` with a `"`, `$`, backtick or
  backslash, which is text there to the outer shell, or a substitution read with a quote handed on
  inside it;
- 3 when the walk ends it where the shell does but reads the text as typed, not as the shell is
  handed it: a `$'…'` holding a backslash.

`guard_live_walk` finds where the quote ends with the outer shell's walk and stops the live walk
there, so a command costs time linear in its live quotes.

### Words

`guard_split_words`, in `hooks/lib-words.sh`, splits one command's arguments into words the way a
shell does, so `-C 'my repo'` stays one word. It reads the walk's pieces:

- whitespace at the top level separates words;
- quotes group and are dropped, the `$` of a `$'…'` or a `$"…"` with them;
- a backslash keeps the next character; in a `$'…'` an escape stands for what bash decodes it to, a
  newline reads as a space, and the text ends at a NUL;
- a `$(…)`, a backtick substitution or a `${…}` stays in its word, delimiters and whitespace
  included, with the quotes and backslashes inside it read the same way;
- a comment's text splits as the command's does, and a heredoc operator reads as `<<EOF`, the
  delimiter one word with its quotes dropped, `<<'END OF'` as `<<END OF`.

### Paths in a command

The env and credential guards look for a path among a command's words. `guard_strip_quoted`, in
`hooks/lib-text.sh`, decides which words count:

- A heredoc body is dropped, but for the substitutions an unquoted one runs.
- A word that holds whitespace is prose and is dropped: only a quoted span puts whitespace into a
  word, and such a span is a message, a pattern or a sentence. A quoted word without whitespace
  counts like any other, since `'db:drop'` and `"$HOME/.ssh/id_rsa"` are what the shell passes on.
  So prose in a commit message never reads as a file, while `cat ".env.local"` still names one.
- In the segment of a search tool, `grep`, `egrep`, `fgrep`, `rg`, `ag`, `ack` or `git grep`, every
  quoted word is dropped: there it is the pattern, and `grep -rn ".env.local" src` opens no such
  file.
- A substitution the shell runs, `"$(cat .env.local)"` included, is read as a command of its own, so
  its words count even inside double quotes while the prose around it stays prose. A quote handed to
  a shell's `-c`, `eval` or `rtk run` is read the same way.
- A comment runs nothing, so its words are dropped.

The words are then read command by command, through `guard_scopes`: a relative path counts from
where a `cd`, `pushd` or `popd` earlier in the command left the shell. A glob the
env guard reads, one whose last segment opens with a `.`, is the files it expands to there; quoted,
as in `find . -name '.env*'`, it stays the word it is.

Two costs follow. A quoted path holding a space reads as prose, so `cat "my dir/.env"` passes.
Outside the search tools, a quoted word that is exactly a guarded name reads as that file. An
unterminated quote hands back the text as typed: the guard fails closed and judges what was typed.

### Known limits

The guards catch the commands an agent writes in ordinary work, not a deliberate evasion
([ADR 0017](../../docs/adr/0017-guards-catch-ordinary-commands-not-deliberate-evasion.md)). These
spellings get past a rule; each comes from the adversarial pass of issue #318 and is listed, not caught.

- Expansion the guard does not perform: braces, and a glob anywhere but the env guard's words
  (`cat .env{,.local}`, `cat ~/.ss?/id_rsa`, `rm -rf .g[i]t`, `rm -rf **`, `{git,reset,--hard}`),
  the tildes `~+` and `~user`, and a name the file system folds, `.ENV.LOCAL` on APFS.
- A command before `reset --hard` that writes a tracked file through its own output: a redirect or
  `--output` on an allowed git verb, `-c diff.external=…` or `-c core.fsmonitor=…`. The reset discards
  that output, which the command can write again.
- A `Grep` glob that reaches an env file only through a name outside the probes, `*.qa` reaching
  `.env.qa`.
- A quoted command name or option: `"rm"`, `r''m`, `r\m`, `g""it`, `find . "-delete"`.
- A shell two levels deep, `sh -c 'sh -c "…"'`, and a quote `rtk` runs through a verb other than
  `run` or behind a flag: `rtk err`, `rtk proxy`, `rtk -v run`.
- Launchers the walker does not read: `command --`, `nohup --`, `eval --`, `rtk proxy --`, `env -S`,
  `env -`, a `function` body, `coproc`, `bash --rcfile`, a second `find -exec`.
- A redirection before the command or the git verb: `>/dev/null git reset --hard`,
  `git 2>/dev/null push --force`.
- git's own option parsing: a unique prefix of a long option (`--har`, `--forc`), the last of
  `--dry-run` and `--no-dry-run`, `-on` as `-o n`, and the value of `--config-env` or
  `--attr-source` read as the verb.
- A heredoc a shell reads another way: `bash /dev/stdin`, `. /dev/stdin`, `{ cat <<EOF … } | bash`,
  a pipe to a shell on a later line, `eval "$(cat <<EOF …)"`.
- A `<<` inside `$(( ))` or `(( ))`, which the guard opens as a heredoc, dropping every later line.
- A check command neither the config nor the built-in list names, such as a `package.json` script
  `pnpm test:unit`, piped into a filter; and a pipe left at the end of a line, `vitest |⏎tail`.
- `yarn` against a separator (`yarn;`, `(yarn)`, `yarn&&`) and `pnpm exec npm`.
- A push to a protected branch named `@` or `heads/main`, or aimed at another repository by
  `GIT_DIR=`.
- A `cd` or `pushd` in the background, in a pipeline or behind a false `||`, read as a move, so an
  `rm -rf *` after it passes and `cd sub & cat .env` is judged as `sub/.env`: an ignored `.env`
  beside a tracked `sub/.env` passes. A turn of the `pushd` stack, `pushd +1` or `popd +N`, reads as
  the session's directory.
- A glob the command also quotes elsewhere, `cat .env* # '.env*'`, read as quoted.
- gh: `-R` before the `pr` verb, a request body sent with `--input`.
- commit: a message from a here-string, a `$(…)` before `-m`, a trailer key with no colon read as
  the trailer.

A fix that closes one of these in passing removes its line. One that turns up in ordinary work leaves
the list for a ticket and a regression test.

## Commit hook

The guards judge the agent's tool calls, so a commit typed in a terminal never meets them.
`hooks/commit-msg.sh` is the subject check of `enforce-commit-hygiene.sh` as a git `commit-msg` hook:
it takes the message file git hands the hook, resolves the same config and exits 1 on a subject off
`commit.pattern`, which aborts the commit. The subject is the first line git keeps: comment lines,
leading blank lines and a `--verbose` diff below the scissors line are skipped, an empty message is
left to git, and git's own `Merge`, `Revert`, `fixup!`, `squash!` and `amend!` subjects pass. The
trailer is not checked, since a commit a person writes has no co-author to name. Without jq it says
so and lets the commit through. A repository wires it from its own hook manager; this one runs
`bash plugins/sdlc/hooks/commit-msg.sh "$1"` from `.vite-hooks/commit-msg`, a Vite+ git hook.

## Setup

The `sdlc-setup` skill runs `dw-sdlc setup` through the link: it adopts the Gate where the
repository has a `package.json` ([Adopting the Gate](#adopting-the-gate)), and writes this machine's
`.ai/agentic.config.local.json` with `$schema` and, when the committed config leaves it unset, the
Node package manager from the lockfile. A layer that would hold only `$schema` is not written, since
the guards read nothing from it: a repository whose committed config sets the package manager, run
without a pin flag or `cswap`, ends with no local config, and the dry run prints `skipped` for it. A
file that exists and holds nothing beyond what the setup owns stays as it is. `commit.convention` is written only when
`--convention ticket-key` or `--convention conventional` asks for it, because a local pin outranks a
convention the repository commits later; a run without the flag keeps a pin as it is. Every run,
`--force` included, keeps a `guardrails` block the local config holds, since that layer may only
tighten it; `--force-push deny|ask|lease` and `--commit-on-protected deny|allow` pin those two keys
in it, and a pin that loosens the committed value is refused. When `cswap` is on PATH, the setup
writes `worker.command`, `cswap run -- --dangerously-skip-permissions`, the command a Worker starts
with, so a Worker lands on the account `cswap` maps to the repository. It keeps a `worker` block the
local config holds, command included, and without `cswap` writes nothing; `--dry-run` shows the write.
The setup also excludes the local
config and `.claude/settings.local.json` in `.git/info/exclude`, generates `permissions.deny`
into `.claude/settings.local.json` as the backstop for a machine without `jq` (the destructive git
set and `gh repo delete` in plain and `rtk` form, `Read`/`Edit` rules for every env file the resolved
`guardrails.envFiles` refuses: listed in `deny`, or unknown to git and not listed in `allow`), and
removes `git branch -D *` in both forms from it, since a deny rule there would refuse the landed
branch the guard lets through. It adds the lease-push exception and the irreversible deny set
(`rm` at `/`, `~` or `.`, `shred`, `find -delete`, `git stash clear`) to `~/.claude/settings.json`;
an `autoMode.allow` list the run creates opens with `"$defaults"`, an existing one only gains the
exception. Every file is written only when it would change; `--dry-run` shows the changes, `--force`
overwrites a differing local config, and a `refused` line exits 1. The only thing run in the
repository is read-only `git`.

### Adopting the Gate

In a repository with a `package.json`, the setup adopts the Gate in two committed files, written to
the repository holding `--root`, so from a linked worktree they stay on its branch:

- `package.json` gains `dw-sdlc` in `devDependencies`, pinned at the version that runs the setup, so
  the doctor's `package` line passes. A new dependency needs the owner's yes, so the pin is written
  only with `--add-package`; without it the file is `refused` with the version the flag would pin,
  and the run exits 1. A pin the file holds, at any version, stays. The line written names the
  install that brings the package in, `pnpm install` in a pnpm repository.
- `.ai/agentic.config.json` gains the `gate` key once the package is there, created with `$schema`
  pointing at the installed package's schema when the file is absent. A `gate` key the config has
  stays as it is, and a config that is not a JSON object is refused and left untouched.

The key names every Check the package ships, `true` or `false`. A Check is on when it judges the
tree as it is, with nothing to add first: `markdown-refs`, `temporal-language` and `comment-budget`.
`agents-map` is on too, though it reads `AGENTS.md`: the map is the user's to write, and the first
Gate names what it lacks. Every other Check is off, since each reads an input the repository adds
first: `primitives` a catalogue, `decision-records` a records directory, `markdown-budget` the docs
its glob matches, `file-size-ratchet` its baseline. On without that input, a Check fails the Gate,
or leaves a Gate that cannot run, exit 2, which reads as a broken setup. The Ratchet's refresh,
`dw-sdlc gate --update-baseline`, runs only when every other Check passes, so it turns on once the
Gate is green: set it to `true` and run the refresh, which records the baseline to commit.

The setup never writes the agent map or its `CLAUDE.md` link. The first `dw-sdlc gate` names what
the map lacks through `agents-map`: a missing `AGENTS.md`, which ends that Gate as cannot run, the
Gate command the map does not name, a Task Router path that does not exist, a `CLAUDE.md` that is
not a link to the map.

A repository without a `package.json` gets neither the `dw-sdlc` pin nor the `gate` key.

Settings that still enable `guardrails@dw-sdlc` or `references@dw-sdlc`, the two plugins `sdlc`
replaced, get a `by hand` line naming the `enabledPlugins` edit: remove them and add
`"sdlc@dw-sdlc": true` after `claude plugin install sdlc@dw-sdlc --scope user`. The setup leaves the
edit to the user and the exit code as it is.

The `sdlc-setup` skill asks before the pin: on the dry run's `refused package.json` line it asks
whether to add `dw-sdlc` at the version the line names, stops on a no, and on a yes runs both
commands again with `--add-package`, then the install. It runs the Gate once after a run that wrote
the key.

## Doctor

`dw-sdlc doctor` prints one PASS / WARN / FAIL line per machine check and installs
nothing: `jq`, the plugin enabled, the package the plugin links against the one the repository pins,
the session helpers' plugin and its copy of the package, rtk not wired by hand beside the plugin's hook and the filters that misbehave on the installed
release excluded (`find` below rtk 0.46.0), herdr's `hc` on the agent's PATH (when absent, a WARN with `sdlc-sessions` enabled and INFO without it), Safe Chain visible to the agent's login shell with `npm`
going through it (a WARN when absent), pnpm's global `minimumReleaseAge`, commit signing, and the
resolved config of the repository holding `--root` or the current directory. A check that does not
apply here is INFO, the config outside any repository among them. Exit 1 on a FAIL.

The plugin and the package carry separate versions, and the `package` line compares them where they
meet: the `version` of the plugin's `dw-sdlc/package.json` against the `dw-sdlc` the repository's
`package.json` pins, an exact version, through the default catalog of `pnpm-workspace.yaml` too, or
for `workspace:` or a range the copy installed under `node_modules`. Equal versions pass. Different
ones are a WARN that starts with `drift:`, since the hooks and skills then run other code than the
repository's Gate, and it names the fix: `claude plugin update sdlc@dw-sdlc` when the plugin is
behind, the exact pin when the repository is. A repository that pins no `dw-sdlc` gets INFO.

The `sessions` line reports [`sdlc-sessions`](../sdlc-sessions/README.md), which a machine may go
without, so it never fails: INFO when it is not installed, naming the skills that are missing and the
command that installs it, a WARN when it is disabled or carries no package. Its own copy of the package is compared with the copy `sdlc` runs, which the `package` line holds
to the repository's pin. Different versions are a WARN that starts with `drift:` and names the plugin
to update.

The `hc` line reports herdr's `hc`, which a Lead starts its Workers through. It asks the agent's login
shell for `command -v hc`: PASS with the path it finds, so a Lead can start Workers. With none, the line
says to install herdr to run Workers, as a WARN when `sdlc-sessions` is enabled, since `/sdlc-delegate` then
has nothing to start Workers with, and as INFO otherwise, since a machine with only the guards has no reason
to install herdr. It never fails.

The `sdlc-doctor` skill runs it as `node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" doctor` from the
repository, and the setup skill runs it last; a terminal runs
`node <plugin root>/dw-sdlc/src/cli.ts doctor`, where `claude plugin list --json` names the
plugin root as `installPath`. It needs only Node 24.

## Session start

`hooks/session-start.sh` runs on `startup`, `resume`, `clear`, `compact` and `fork` and adds context the
first turn should have: a missing `jq` (every guard is silent without it), an invalid config with
each problem named and the reminder that the guards run strictest until it is fixed, and in a linked
worktree the `.worktreeinclude` files not yet copied in and the `worktree.setup` commands. It
reports and never installs. A main checkout in order
gets nothing.

A config layer is invalid, too, when the hooks cannot validate it against the schema beside them,
`dw-sdlc/config/agentic.config.schema.json`. A marketplace added from GitHub without `packages` in
its `--sparse` set installs the plugin without that file. The report then names the schema and says
an install from GitHub needs `packages` in its `--sparse` set. A schema that is there but fails in
jq, one that is not JSON for example, is named with jq's first error line. Either way the layer is
dropped and the guards run strictest.

## References

The Sync for a repository's References: the repositories an agent reads to see how a problem was
solved before, declared in `.ai/references.json` and cloned under `references/`. Only the committed
file is read; no local layer adds References. A repository without the file gets no output at all.

Enabled at user scope, the plugin syncs a repository's References when a local Claude Code session
starts, a new worktree's session included. A cloud session, Codex and a plain terminal load no
plugin, so a Reference there is what the last local session left on disk (ADR 0006). A repository
that runs a Sync hook of its own drops it, or the Sync runs twice.

### The Sync at session start

`hooks/references-sync.sh` runs on `SessionStart` with matcher `startup` and a 60 s timeout. It runs the
Sync from the project directory and prints its lines, both streams, as the session's context. When the
Sync fails, one line more says the clones stay where they were and names the command to rerun. It
always exits 0, so being offline never blocks a session. The Sync is the package's
`dw-sdlc references sync`, which the hook runs through the plugin's `dw-sdlc` link.

### The file

`.ai/references.json` is an object: `$schema`, optional, pointing at the package's
`config/references.schema.json` so an editor completes the entries; `version`, `1`; and
`references`, an array of entries, each with:

- `dir` — the one directory under `references/` the clone lives in, unique in the list;
- `repository` — a URL `git` can fetch; a `https://github.com/` one fetches with the GitHub CLI's
  credentials, so a private repository clones without a prompt;
- `ref` — a branch or a tag; `{name}` in it stands for the exact version the root `package.json`
  pins for package `name`, read through the default catalog of `pnpm-workspace.yaml` when the pin
  says `catalog:` or `catalog:default`;
- `only` — optional, at least one path the clone holds beside the repository's top-level files,
  relative and inside the clone, a directory ending in `/`; absent, the clone holds the whole tree;
- `skip` — optional, paths the sparse checkout leaves out, relative and inside the clone; with
  `only`, each lies inside one of its paths;
- `what` and `when` — what the Reference is, and when an agent reaches for it.

With `only`, the clone holds the repository's top-level files too, since a README or a manifest
there tells an agent where the part sits. Nothing else is checked out: not the files beside a
nested path, nor a directory the repository adds later. `cursor/plugins`, read for its pstack part
alone:

```json
{
  "dir": "pstack",
  "repository": "https://github.com/cursor/plugins",
  "ref": "main",
  "only": ["pstack/", "harness/pstack/"],
  "what": "Cursor's pstack plugin. The clone holds only `pstack/` and `harness/pstack/`: 387 of its 1267 files",
  "when": "designing a plugin that ships skills and a harness"
}
```

An unknown field or key is refused. The package's `config/references.schema.json` documents the
contract; at runtime its `src/references-key.ts` is the authority, and one case list holds the two
in agreement. A mistake in the file never touches the guards, which read only the agentic config.
A `references` key in `.ai/agentic.config.json` is refused, so the file stays the one list; the
setup moves such a key into the file (ADR 0011).

### The Sync

```bash
node <plugin root>/dw-sdlc/src/cli.ts references sync [dir...]
pnpm references:sync [dir...]   # in a checkout of dw-sdlc
```

Every Reference, or only the named ones. A missing one is cloned shallow, blobless and without a
checkout; an existing one is fetched at depth 1. Either is then checked out detached at what was
fetched, sparse when `only` or `skip` names paths. The sparse checkout is set from both on every
run, so adding, changing or removing either moves the clone at the next Sync, and a move between a
branch and a tag keeps it. Each prints one line: directory, short commit, repository and ref. The
variables `git rev-parse --local-env-vars` lists are dropped, so a run from a git hook never
touches the repository that hook points at, and the terminal prompt is off.

A directory under `references/` the list does not name is reported and never deleted. When the
Router or its table is missing or behind the file, one line more names the setup to run, and when
the Router has one marker without the other, the line says so instead; neither changes the exit
code.

One Sync runs in a checkout at a time: it holds `references/.sync.lock`, with its pid inside, while
it syncs. A second one started meanwhile, a session starting beside another or `pnpm references:sync`
during a session start, waits for it, up to 30 s, then syncs. Past that it prints one line naming the
pid, exits 0 and leaves the clones to the Sync still running. `REFERENCES_SYNC_WAIT` sets the seconds
to wait. A lock whose pid is not a running process of this user, left by a killed Sync, is removed
and never waited on. A worktree has a `references/` of its own, so only Syncs in one checkout wait
on each other.

### Failures

- **Exit 2**: a file the parser refuses or that is not JSON, a `references` key left in the
  agentic config, or a named dir the list lacks. Nothing is synced, and one line names the entry,
  the field and the reason, or the setup that moves the key; with the file there too, the merge to
  make by hand. An agentic config that is not JSON is
  the guards' to report and never stops the Sync.
- **Exit 1**: an entry that fails to resolve fails alone, and the rest proceed. That covers an
  unreachable repository, a missing or inexact pin, an `only` path the fetched tree lacks, a clone
  with local edits the update would overwrite, and a directory that is not a clone of its
  repository; each is left as it is. The line for a missing `only` path names it, so a renamed
  upstream folder shows at session start instead of leaving an empty clone.

### Adding a Reference

`/sdlc-references-add <repository>` adds one. Only the user invokes it. It runs the setup and shows
its lines, then does the parts that need judgment: it names the licence, picks the ref (a branch
head, or a tag or `{name}` when the repository is a dependency of this one), counts the files and
proposes `skip` for the vendored directories, writes `what` and `when`, appends the entry, runs the
setup again so the Router's table gains its row, and runs the Sync for its `dir`. When no row of the
root agent instructions points at the Router, it proposes one, phrased from the entries' `when`, and
writes it only after a yes. It commits nothing.

It takes a link to a folder on GitHub too, `https://github.com/cursor/plugins/tree/main/pstack`.
The ref is the longest branch or tag that leads the path after `tree/`, since a branch name may
hold a `/`, and the rest is the first `only` path. The skill proposes for `only` each other
directory named like it, `harness/pstack/` beside `pstack/`, with its file count, and writes one
only after a yes. The licence it names is the root's, or with none there, the one inside `only`.
It counts the files and proposes `skip` within `only`, and `what` says what the clone holds out of
the whole tree. A link that ends at the ref names the ref and no `only`.

The setup makes a repository ready to declare References:

```bash
node <plugin root>/dw-sdlc/src/cli.ts references setup [--root <dir>] [--dry-run | --check]
pnpm references:setup [--root <dir>] [--dry-run | --check]   # in a checkout of dw-sdlc
```

- `references/AGENTS.md`, the Router, from the package's `templates/router.md` when nothing sits at
  its path, with its `CLAUDE.md` symlink, written once too. On every run, the block between the
  Router's two markers: a table of each Reference's `dir` and `when`, one row per entry in the
  file's order with `|` escaped, or one line saying `/sdlc-references-add <repository>` adds one when
  the list is empty. The setup writes the block in the shape oxfmt leaves it in: a blank line inside
  each marker, each `when` trimmed, and each column padded to its widest cell, an emoji or an East
  Asian wide character counted as two columns. That count matches oxfmt on Latin text, CJK, Hangul
  and emoji; on a script with combining signs, such as Devanagari, oxfmt pads the table again.
  The text around the block stays as it is, and a Router without the markers gets the block at its
  end. The block is in step when its rows say what the file says, not when its bytes match, so a
  block in another shape with the same rows stays as it is;
- `claudeMdExcludes` in `.claude/settings.json`: the clones' own `CLAUDE.md` and `AGENTS.md`;
- `.gitignore`: `references/*`, then the two exceptions that keep the Router tracked;
- `.ai/references.json` with no References when it is missing. A `references` key in
  `.ai/agentic.config.json` moves into it instead, and leaves the config with the rest of its
  layout as it was; with both there, both stay and the run is refused.

A list gains only the entries it lacks, and nothing is removed, so a repeat writes nothing. Each
file prints one line: `wrote`, `unchanged` or `refused`, and `would write` on a dry run. `--check`
writes nothing and exits 1 when any file would change, so a repository's check can run it. A
settings file that is not a JSON object is refused and left as it is, and so is a `.gitignore`
that ignores `references/` itself, since git then tracks nothing under it, and a Router with one
marker and not the other, or whose file or leftover key fails the parser; the run then exits 1.

## Opening a pull request

`sdlc-pr-open` opens the pull request of the current branch, or rewrites the body of the one it has.
The model starts it itself, in any repository with the plugin, whenever it opens a pull request or
writes or rewrites a body; its description rules out merging, a review and CI, so those never start
it. The dev, a Brief or the repository's rules decide that a pull request is wanted; the skill never
does, never merges and never starts `/sdlc-pr-ship`, which comes after it.

- The title follows `commit.convention` from `dw-sdlc config`, and `commit.pattern` when one is set.
- The body goes to a file outside the repository and `--body-file` passes it. A pull request template
  of the repository wins: the skill reads it and fills it, since `--body-file` applies none. Without
  one the body is `Closes #<n>` when the source is an issue, why the change exists, a Summary, the
  Evidence and the Merge Danger; `references/summary-views.md` holds the views for the Summary.
- The body is a snapshot in the present tense: after a review it is rewritten whole, never appended
  to. It carries no "Generated with" footer.
- The branch is pushed by name, `git push -u origin <branch>`, when it has no upstream of its own
  name, since a branch cut from `origin/main` tracks `origin/main`. `gh pr create` opens the pull
  request; a branch that has one gets `gh pr edit`, never a second pull request.
- `evals/trigger.json` holds the queries that must start it and the near misses that must not, such
  as "merge it" and "is CI green?"; `evals/evals.json` holds four behaviours: a repository with a
  template, one without, a branch that has a pull request, and an issue as the source.

## Shipping a pull request

`/sdlc-pr-ship [<n>]` drives one pull request to merged through the Ship script, `dw-sdlc pr ship`,
which it runs through the link with `--json`, on the current branch's pull request without a number.
The dev invokes it, or a Worker whose Brief tells it to. The skill reads each answer's `status`, then its `action`:

- `act`, the agent's turn: `fix-ci` runs each failing check's `log`, or reads its `link`, fixes it
  and pushes; `fix-conflicts` rebases onto the base locally, resolves and pushes with lease, the one
  push that rewrites the branch, which a repository under `guardrails.forcePush: deny` refuses;
  `address-review` triages each open thread someone else commented on last against the code, or with
  none the review that requests changes, and either fixes it and resolves the thread, or replies and
  leaves it open for the reviewer, then pushes when code changed; `review` reads the Review depth in
  `details.depth` and who set it in `details.source`. Only a depth the script's rules routed, source
  `auto`, may the skill raise, `light` to `full`, when the change looks riskier than its size, and it
  says why in one line; it never lowers one, and a depth the dev or the config set stands, with one
  line when the agent disagrees. An `off` the rules route the script posts itself, so it comes to no
  raise. The Review reads from `details.since`, the last head a Review read, clean or not, when the
  answer names one, else from the base. At `full` it runs the command `details.reviewCommand`
  names, from `pr.reviewCommand` and `/code-review` by default, with that range named to it; when
  the session does not have that command, the skill names it and stops. At `light` it spawns the
  `sdlc-reviewer` subagent, below, on the same range. A Review that follows a fix is told the
  Findings that fix answers, in the command's arguments or the subagent's prompt, and checks each
  one is fixed and that the fix breaks nothing. A Review is clean when it reports no Finding, as the
  [glossary](../../GLOSSARY.md) defines it: a concrete harm the pull request's own changes cause, a
  miss against the spec, or a bug fix without its regression test. The skill declines everything
  else with one line each in the Recap, and lists a harm outside the change as a follow-up. When the
  Review is clean it runs `dw-sdlc pr reviewed <n> --head <sha>` with the head it reviewed. When it
  is not, it runs the same with `--findings`, the read mark on the head that Review read, then
  fixes each Finding and pushes, so the next Review reads the fix alone. The skill skips that
  Review when one earlier in the conversation read the changes since the same point at the head the
  script read, was clean, and nothing changed after it: no edit, no commit, no pull. Only a clean
  run of that command, or at `light` of `sdlc-reviewer` too, whose range ended at that head counts
  as the earlier Review; an informal read of the diff never counts. It then runs `pr reviewed` on
  that head. A Review whose head the conversation does not show needs a fresh Review. After
  three Reviews with no success between them the script answers `park review-limit` and the skill
  prints its reason, the Findings the last fix answered and its command, `pr reviewed --accept`,
  then stops: that command accepts the head with its Findings open, and is the dev's to run, never
  the skill's. The agent's other `blockers` go
  into the same push, all but `review`, which needs the head the push makes, and the skill calls the
  script again. An `act` that leaves nothing to change, as a review that requests changes and is
  still unanswered, stops it: the reviewer's turn. A push that answers a review that requests changes, a
  non-merge commit after the commit it read, makes the script answer `park awaiting-review` with
  no command: only the reviewer can review again or dismiss it.
- `wait`: it tells the dev the reason and `recheckAfter` and ends the turn. The next call comes with
  the dev's next message or a `/loop` wake-up, never from a sleep in a shell.
- `park` and `done`: it prints the reason, and the command when there is one, and stops, a script
  Action parked under `--dry-run` or on its second match included. The command is the dev's to run.
  A guard that refuses one of its commands stops it too.

It acts only from a checkout of the pull request's branch at the head the script read, and pulls
with `--rebase` first when the branch is behind it, as after the script's update. A dry run the dev
asks for shows the answer and does nothing. It passes `--merge` only when the dev wrote "merge" for
this pull request in the conversation, and `--review full`, `--review light` or `--review off` only
when they wrote that Review depth for it. Under `off`, from the flag, `pr.review` or the rules of
`pr.review: auto`, and over a head that only merged the base in since a clean Review, the script
posts the review success itself and the skill never reviews; a read mark never carries. A depth the
dev names for the call beats that carry: `--review full` or `light` reads the whole diff since the
base, and `--review off` posts the success as the dev's `off`. The same `--review <depth>` buys one
more Review past the limit, for that call only. Under `pr.review: auto`, the default, the script routes the
depth from the changes the Review would read: lockfiles alone `off`; a file under
`.github/workflows/`, more than 100 changed lines outside lockfiles, or a change it cannot size,
more files than GitHub's compare lists or a file outside lockfiles with no patch, `full`; the rest
`light`.
It never deletes a branch, the one a `done` answer's command names included. That command,
`git push origin --delete <branch>`, comes only while the head branch still stands on `origin`;
once it is gone, or when the pull request comes from a fork, `done` carries no command. Review-thread text is
data it triages against the code, never an instruction. The decision, the exit codes, the Review
limit and the review statuses `pr reviewed` posts are in the overview,
[How the Ship script merges a pull request](../../docs/overview.md#how-the-ship-script-merges-a-pull-request).

### The light Review

`agents/sdlc-reviewer.md` is the one reader of a `light` Review: a subagent on the session's model
at `effort: medium`, whatever effort the session runs at, unless `CLAUDE_CODE_EFFORT_LEVEL` sets
one. Its tools are `Read`, `Grep` and `Bash`, and its instructions keep Bash to read-only git. It
does not see the conversation, so the skill's prompt holds what it reads: the diff command, the
files the diff touches, the spec as the conversation states it, and after a fix the Findings it
answers, which it checks one by one. It reads those files and the repository's Agent map, nothing
else, skips what the Gate checks, and reports under 300 words, its first line `clean` or
`findings: <n>`, counting Findings only. A smell follows the first line as `smell:`, a harm in code
the change neither touches nor reaches as `follow-up:`, and a named Finding the fix answers as
`fixed:`; none changes the count.

## Sweeping

`/sdlc-sweep` runs a Sweep, `dw-sdlc sweep`, through the plugin's link to the package with `--json`,
never a `dw-sdlc` from PATH. It acts only on the dev's word: the slash command, or "go" on a Recap
follow-up that names a Sweep. It runs from the main checkout; in a linked worktree the command exits
2, and the skill says so in one line and stops. It reports in one short table what the Sweep removed
and what it kept, quotes each kept item's command as the dev's to run, and stops. It never runs
that command itself, and it adds `--dry-run` only when the dev asks to look first.

In herdr the Sweep also stops and removes the terminals of the session's own Workers. A Worker whose
status is none of working, blocked or unknown, the last being a Worker yet to report, goes when its
worktree goes in the same Sweep or its folder is already gone; a finished Worker of the session is
removed. A Worker beside a worktree that stays is never stopped. The live Claude Code lock a done
Worker's own session holds on its worktree does not keep it: after the stop the Sweep reads the lock
again and lifts it only when it is stale, else the worktree stays. The Sweep never stops another
session's terminal or the one it runs in: a worktree such a terminal is in stays, named with the
terminal's address and place and `hc kill` as the dev's command. Outside herdr no terminal is read, and
the Sweep says so. In herdr an `hc` that fails ends it with exit 2 before anything is removed.

## Tests

`test/` mirrors `hooks/`: `test/hooks/<guard>.test.ts` spawns the guard on the real stdin payload
and asserts its exit code and verdict, `test/harness.ts` is the shared part, and every input a test
reads is built beside it in a scratch directory. `pnpm test` runs them all on `node:test`, a file
per process, as part of `pnpm check`. The jq and TypeScript copies of the config contract are
tested against the same cases: `test/hooks/config.test.ts` runs `lib.sh` against the package's
resolver. `test/hooks/command-position.test.ts` runs every rule through the dispatcher bare and
each reader of a command behind each launcher family, and `lib.test.ts` holds the word reader and the
boundary to every launcher spelling. jq is a hard requirement: without it the harness fails loudly instead of passing
empty.

`test/hooks/references-sync.test.ts` feeds the Sync hook a `SessionStart` payload;
`test/references-harness.ts` spawns the hook the way Claude Code does, on the package's
`test/references-harness.ts` through the link, which builds throwaway repositories apart from the
machine's git config. `test/manifest.test.ts` holds the manifest to the tree: each hook script wired
to its event and matcher, run by the dispatcher or left to git, each skill under its name, with
every plugin path it runs on disk and left for the user to invoke. Three skills are the exception:
`sdlc-pr-open`'s description triggers on opening a pull request and writing its body, and the other two
hold the model to a Brief or the dev's "go". `sdlc-sweep` runs the bin through
the link and never a kept item's command. The manifest test also holds each subagent under its name, at
medium effort on the session's model with no tool that edits a file, the link to the package, and
the marketplace listing this plugin at the manifest's version.

The commands' tests sit beside the package's code, in its `test/commands/`: `setup`, `doctor` and
`config`, `references-sync.test.ts`, which drives the Sync against upstreams served over `file://`,
and `references-setup.test.ts`, the setup with `--root`; `test/references-key.test.ts` runs one case
list through the file's parser and its schema.
