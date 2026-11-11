# dw-sdlc

## 0.15.2

### Patch Changes

- af184cc: A tool the package stops at its time limit takes every child it started with it: each tool runs in a session of its own, and the limit stops that whole process group. The tool has no controlling terminal, so a prompt on `/dev/tty`, as ssh's for a host key or a passphrase, fails at once. Ctrl-C on the terminal stops the package, not the tool, which runs on to its own end.
- 68e8ca2: `dw-sdlc pr ship` names `git push origin --delete <branch>` in `done` only while the head branch still stands on the remote; once GitHub has deleted it, `done` carries no command.
- fc29902: `dw-sdlc setup` writes no local config layer that would hold only `$schema`, and prints `skipped` for it. A pin flag, a package manager the committed config leaves unset and the lockfile names, or `cswap` on PATH still gets the layer written.
- 358ce87: `dw-sdlc worker start` fetches origin's default branch before it starts the Worker, so the Worker's worktree begins from origin's tip, not from the ref the clone last fetched. A failed fetch starts no Worker and exits 2.

## 0.15.1

### Patch Changes

- c1bb505: `dw-sdlc pr ship` waits for the run a draft's `ready` starts: a ready head whose every check was skipped is unverified, and parks for the dev when no run comes within the grace.

## 0.15.0

### Minor Changes

- e503767: `dw-sdlc pr ship` parks a pull request whose changes-requested review a push has answered as the reviewer's turn: `park awaiting-review`, actor `dev`, no command, the reason naming each reviewer. A review is answered when a non-merge commit follows the commit it read, which the one GraphQL query reads from `latestReviews` and finds in the commit history; dates are never compared, since the script's own `update-branch` merges the base after a review. A review whose commit has left the history, after a force-push or past the last 100 commits, counts as unanswered, and so does the pull request while any one of several reviewers asking for changes is. The new row sits right after `awaiting-reply`, so the pull request's own Review and CI run first, and `awaiting-review` rides in `blockers` of any earlier Action. A review still unanswered answers `act address-review`.

### Patch Changes

- 379c730: `dw-sdlc` exits 2 with one line on stderr when a command throws what it has no answer for, such as a config path that is a directory or a `TMPDIR` it cannot write to. Exit 1 stays what a command answers once it reaches a verdict.
- c0e19e0: `dw-sdlc doctor` warns on its `hc` line when `hc` is absent and `sdlc-sessions` is enabled, since `/sdlc-delegate` then has nothing to start Workers with; without that plugin the line stays INFO. The `sessions` line of a machine without the plugin names all three of its skills and the command that installs it.
- 379c730: Every short-lived child process `dw-sdlc` runs has a time limit, 2 minutes, and 10 for a clone, a fetch or a scan of a repository's history. A tool that hangs stops the command with exit 2 and names the tool, where it used to hang forever; `dw-sdlc doctor` reports it on its own line and carries on. git never waits on a credential prompt, and every call has room for 64 MiB of output.
- efc15f4: `dw-sdlc pr ship` no longer merges a pull request with more checks or review threads than its one read holds. A failure past the first 50 checks, or an open thread past the first 100, showed in no row of the decision; the pull request now parks as `partial-read` with the merge command for the dev.

## 0.14.0

### Minor Changes

- 241f723: In herdr `dw-sdlc sweep` stops and removes the terminals of the sweeping session's own Workers. It reads them as `worker ls` does, the terminals whose parent is its own, finished ones included, and every other live terminal with the folder it works in. A Worker whose status is none of working, blocked or unknown is stopped (`hc kill`) and then removed (`hc rm`) when its worktree goes in the same run, before the stale lock, the worktree and its branch; the worktree is judged whole first, so a Worker beside a dirty worktree is never stopped. A live Claude Code lock on that worktree that names the Worker's own program, the pid `hc get` reports, does not keep it: after the stop the lock is read again and lifted only when it is stale then, else the worktree stays and the line says so. Any other live lock keeps the worktree. A Worker whose folder is gone, with no worktree around it, goes under the same status rule, and a finished Worker is removed without a stop. Another session's terminal in a worktree keeps that worktree, named with the terminal's address and place and `hc kill` as the dev's command; the sweeping session's own terminal is never stopped. Terminals are items of kind `terminal`, `--json` gains `terminalsRead`, and outside herdr the output says no terminal was read. An `hc` that fails in herdr ends the Sweep with exit 2 before any removal; a stop that fails keeps the Worker's worktree with `hc`'s words and the Sweep goes on.

## 0.13.0

### Minor Changes

- 8780b76: `dw-sdlc pr ship` counts the read marks on the pull request's last 100 commits after the last review success of any kind, and at 3 or more with no success on the head answers `park review-limit`, actor `dev`, in the place of `act review`, under `--dry-run` too and at `full` and `light` alike. Its command is `dw-sdlc pr reviewed <n> -R <owner/name> --head <head> --accept`. The dev's `--review <depth>` answers `act review` past the limit, for that call only. `dw-sdlc pr reviewed --accept` posts `dw-sdlc/review` in state success, described "accepted by the dev, findings open"; with `--findings` it exits 2. The state `--verbose` adds under `facts` carries the count as `marks`.
- ed29eb2: `dw-sdlc pr reviewed --findings` posts `dw-sdlc/review` in state failure, described "read, findings open", on the head a Review read when it left a Finding open: the read mark. `dw-sdlc pr ship` takes the last commit before the head with a review success not under off or a read mark as `details.since`, and routes `pr.review: auto` on the changes from it, so the Review after a fix reads the fix alone. Only a success carries over a head that only merged the base in. A read mark with only merges after it is passed over, so the Review reads from the read before it and finds its open Findings again. The state `--verbose` adds under `facts` names that commit `lastRead`.
- a8114ef: `dw-sdlc sweep` removes a worktree locked by a Claude Code session whose process is gone. Claude Code's lock reason is `claude session <name> (pid <N> start <time>)`; the lock is stale when no process N runs or N started at another time, as a reused pid does. The Sweep lifts it just before it removes the worktree, only when the rest of the set passes, and puts it back if git then refuses the removal. A lifted lock is an item of kind `lock` in `removed`, before its worktree; `--dry-run` lifts nothing and says it would. A live lock keeps the worktree, named by its pid. A lock with any other reason keeps it, with the reason and `git worktree unlock` as the dev's command.
- ebdc270: `dw-sdlc sweep` also removes every linked worktree of the repository, wherever it lies, whose whole set passes: no modified or untracked file (ignored files aside), no paused rebase, merge, cherry-pick, revert or bisect, no lock, and its HEAD Landed, on a branch or detached. It removes the worktree without force, then deletes the branch it had checked out in the same run. A worktree it keeps is named with its reason: the files that hold it with the forced removal as the dev's command, the paused operation, the lock's reason, a HEAD that is not Landed, or git's own words when git refuses. The main checkout is never removed. `--dry-run` and `--json` cover worktrees; the exit code is 0 when only the default, the base or a protected branch is kept, and 1 when anything else is.
- 126f93c: `dw-sdlc sweep [--dry-run] [--json]` deletes every Landed local branch, run from the main checkout. It fetches origin, reads the base as the guard does (`baseBranch` of the config, else the branch `origin/HEAD` names) and judges Landed by the guard's rule: the tip is on the base, or a base commit since the fork holds the tip's tree or the verbatim patch-id of its whole diff. It keeps the default branch, a protected branch and a branch any worktree has checked out, and names each kept branch with its reason; a branch whose work is on no commit of the base stays with the forced delete as the command for the dev to run. It never forces and never writes to a remote. One line an item, or one document with `--json` listing `removed` and `kept`; exit 0 when nothing is kept, 1 when something is, 2 when it cannot run, a linked worktree included.

### Patch Changes

- 89a539d: `dw-sdlc gate` starts no command after one that SIGINT or SIGTERM ended, and compares no tree after such a Step. Ctrl-C reaches the running command and the Gate together, and the Gate can see the command's exit before its own signal. The Gate reports that command as stopped by the signal and runs nothing after it, as for a signal it gets itself, and the signal that reaches it late does not end it before its report. A command that traps the signal and exits with a code of its own stops the run only once the Gate sees the signal.
- 00ee726: `dw-sdlc pr ship` without a number finds the pull request of a branch pushed under another name, as `dw-sdlc recap` does. Where gh finds none for the branch itself, it asks for the head branch the configured upstream names, and acts on that pull request only when its commits hold the local head; otherwise it exits 2 and names the pull request it passed over.

## 0.12.1

### Patch Changes

- 2a3e684: `dw-sdlc recap` finds the pull request of a branch pushed under another name, open or merged. Where gh finds none for the branch itself, recap asks for the head branch its configured upstream names, and takes that pull request when its commits hold the local head. A merged pull request then reads as merged and an open one reports its Action, while a branch started from another's, before its first push, takes none of that branch's.

## 0.12.0

### Minor Changes

- a7c5115: The `sdlc-sessions` plugin adds `/sdlc-delegate`, which makes a session a Lead: it hands an issue to a Worker or splits the current work into Briefs, starts each Worker with `dw-sdlc worker start`, ends its turn, wakes on each Worker's Recap, relays what needs the dev and gives one combined Recap. It refuses outside herdr and in a linked worktree.

  `dw-sdlc recap` lists the session's live Workers when it runs in herdr, and a live Worker makes the close verdict no, under the reason `workers`. `dw-sdlc doctor` reports on its `hc` line whether herdr's `hc` is on the agent's PATH.

  `dw-sdlc worker start` looks for the Worker's tab for up to 10 seconds, or `--wait` when shorter, since the window lists it a moment after `hc run`. `dw-sdlc worker ls` and `dw-sdlc recap` show the folder a live Worker works in, its worktree, rather than the folder it was launched in.

- 6c56f1f: `dw-sdlc worker start`, `worker ls` and `worker report` start, list and hear from a Lead's Workers in herdr, so a Lead no longer writes `hc` lines by hand. They refuse outside a herdr terminal.

  `worker start --brief <file> --name <name>` runs `hc run` in the background with the name, the label `role=worker`, `--outlive-parent` and the repository as the folder, then `worker.command` with `--worktree`, `--model`, `--effort` and the Brief as the first message. The model and effort default to the config's `worker.model` and `worker.effort`. It refuses a fourth live Worker of the same Lead unless `--max-workers` allows it, names the Worker's herdr tab, and exits 1 when the Worker shows no work within `--wait` seconds, its terminal has ended or herdr reports the first message unsent.

  `worker ls` lists the Lead's Workers with their state, status and folder. `worker report --to <lead> --recap <file>` delivers a Recap, as its path when it is long; while the Lead is blocked it waits and sends again, never with `--force`, and exits 1 when it gives up.

### Patch Changes

- bbadfe0: `dw-sdlc recap` counts a remote out of reach as holding nothing, so it exits with the close verdict instead of 2, and that remote can turn the verdict to no and never to yes.
- 55325cf: `dw-sdlc pr ship` updates a branch behind its base whether or not GitHub reports `BEHIND`. It judges "behind" from the compare of the base with the head, so in a repository with no rule that a branch be up to date, a pull request no longer merges without CI on the tree the merge makes.

## 0.11.0

### Minor Changes

- a7090bf: `dw-sdlc recap [--json]` reads the facts a Recap rests on and writes nothing. They are the branch, uncommitted changes, unpushed commits or a missing upstream, a paused rebase, merge, cherry-pick, revert or bisect, and whether the session sits in a linked worktree. It also reads the branch's pull request with the Action the Ship script's decision gives it, without performing that Action. It answers whether the session can be closed, with every reason: exit 0 yes, 1 no, 2 cannot run. The `sdlc-recap` skill of the new `sdlc-sessions` plugin rests on it.

  `dw-sdlc doctor` adds a `sessions` line for the `sdlc-sessions` plugin and the drift of its copy of the package. The state `dw-sdlc pr ship --verbose` shows under `facts` lists the pull request's `commits`.

## 0.10.0

### Minor Changes

- 77e12d0: `pr.review` takes `auto`, the new default, between `full` and `light`: strictest first full, auto, light, off. Under `auto` the Ship script routes the Review depth from the changes the Review would read, read through GitHub's compare from `details.since`, else the base, to the head. Lockfiles alone route `off`, posted as `off: lockfiles only`. A file under `.github/workflows/`, more than 100 changed lines outside lockfiles, or a change the script cannot size routes `full`: 300 files, more than the compare lists, or a file outside lockfiles the compare shows no patch for, such as a binary one. The rest routes `light`. The answer names `source: auto` and `details.reviewCommand` at every depth, so the agent may raise a routed `light` to `full`. An invalid layer still runs `full`. A carried status's `details` name only `since`: a carry reads at no depth.

  A depth the dev names with `--review` beats a carried status: `full` and `light` read the whole diff since the base, and `off` posts the status as `off: --review off`.

- ad33b95: `pr.review` and `pr ship --review` take `light`, between `full` and `off`: the `review` answer carries `depth: light`, and the plugin's `sdlc-pr-ship` meets it with one `sdlc-reviewer` subagent at medium effort over the diff, the files it touches and the Agent map. Strictest first: full, light, off; a local `light` tightens `off` and loosens `full`.
- df5040e: `dw-sdlc pr ship` names the last commit of the pull request that carries a `dw-sdlc/review` success under `details.since`, so the Review after a push reads only the changes from it to the head. A success posted under `off` does not count.

  A head that only merged the base in carries the status, as after `update-branch`. Every commit since the reviewed one must be a merge, and the pull request's own changes since the base must be the same at both. The script then posts `dw-sdlc/review` as `mark-reviewed`, described as `carried from <sha>`. Under `--dry-run` it parks with that command. The dev's `--review full` asks for a Review of the whole diff instead.

  A history that no longer holds a reviewed commit, after a rebase or a force push, names none, and the Review reads the whole diff since the base. Both reads go through `gh`, so they work under `-R` without a checkout.

- b3e78cd: The agentic config takes a `worker` key: `command`, the words that start a Worker's Claude Code session before its own flags (default `claude`), `model` (default `sonnet`) and `effort`, one of Claude Code's levels `low`, `medium`, `high`, `xhigh` and `max` (default `high`). Any layer sets any key; the key has no strictness order, and an invalid layer keeps what the valid layers name. `dw-sdlc config` shows the resolved key. `dw-sdlc setup` writes `worker.command` as `cswap run -- --dangerously-skip-permissions` into the local layer when `cswap` is on PATH, keeps a command already there, writes nothing without `cswap`, and shows the write on `--dry-run`.

### Patch Changes

- dd4d310: `dw-sdlc pr ship` exits 2 naming each Action that ran when the read after it fails, with `performed` on stdout under `--json`. An update counts when the head carries the base it read. A reason says "gh accepted" when gh exited 0 and the read does not show the Action yet, and a `mark-reviewed` whose head moved names both heads.
- 4bdd322: `dw-sdlc pr ship` records an Action under `performed` as `ok` when the read after it shows the Action took effect, whatever gh's exit status, and keeps gh's `exit` and `stderr` beside `ok`.

## 0.9.0

### Minor Changes

- 804c168: `pr.reviewCommand` in `.ai/agentic.config.json` names the slash command a `full` Review runs, `/code-review` by default. It is a non-empty string with no strictness order, so the local layer sets it freely, to `/pr-review-toolkit:review-pr code errors` for instance. While a layer is invalid it keeps what the valid layers name. `dw-sdlc pr ship` carries it as `details.reviewCommand` on a `full` `act review` answer.

## 0.8.0

### Minor Changes

- d3aca7e: `agents-map` fails when `CLAUDE.md` at the repository root is missing, a file of its own, or a symbolic link to anything but the map's path from the root, so Claude Code reads the map the Gate judges in every clone. Each failure names the remedy, `ln -s AGENTS.md CLAUDE.md` for the default map. A map that `file` names `CLAUDE.md` needs no link.
- 7bb48bb: `dw-sdlc pr ship` never asks the agent to review a pull request another author opened, such as a Dependabot bump or a version pull request, since the dev merges it. Every other row of the decision holds for it, conflicts and failing CI first. Once nothing holds it back, it parks as `ready-to-merge` with the merge command, with or without a `dw-sdlc/review` success on its head. The viewer's own pull request answers `act review` until its head carries one.

  The script marks only the viewer's own draft ready. Another author's draft parks for the dev as `awaiting-author`, with no command: marking it ready is the author's.

- 5a8deb6: `decision-records` takes a `fields` option that holds each record to more of its frontmatter. It names no field by default, and then the Check judges `status` alone. `date` is a `YYYY-MM-DD` day. Under `touches`, a record in force, its status `accepted` or `active`, names the paths it governs. Each is a file or directory git tracks or would track, or a glob that matches such a file. A `superseded` record names none. Under `superseded-by`, a `superseded` record names the number of each record that replaces it. Each number under `amended-by` is the number of a record in the same directory. A list is comma-separated after its key, or one `- ` item a line under it. Each failure names the record and the fix.
- 8bac62b: `dw-sdlc gate --cache` skips the run when the working tree, the resolved Gate and the version of dw-sdlc match the last green run in that checkout, so a pre-push hook that runs the Gate costs nothing on an unchanged tree. The tree is hashed with `git write-tree` over a copy of the index, untracked files in and ignored files out, and the real index is never touched. The stamp lives in the checkout's own git dir, so each worktree keeps its own, and holds the hash taken before the run, so a Gate that changes the tree runs again. A tree it cannot hash runs the whole Gate. A cached run prints `gate: green — cached, the tree matches the last green run`, or under `--json` a green document with `cached: true`. The cache is off without the flag and does not combine with `--update-baseline`.
- 8ba44d6: `dw-sdlc gate` watches every Step for Drift, on by default. Before and after each Step it records the content of every file git tracks or would track, and each file the Step created, changed or deleted fails the Gate, exit 1, as `packages/x/package.json: drift: "pnpm build" changed it — commit the change, or make the Step only read`; `created it` and `deleted it` name the other two. Drift does not stop the Steps after it or the Checks, `--json` carries each one in `failures` under the rule `drift`, and `--update-baseline` refreshes no baseline after it. Ignored files and edits made before the run never drift, so a stale generated file fails a local `pnpm check` as it fails a `git diff --exit-code` in CI. A tree the Gate cannot record, such as a directory outside git, makes it exit 2. The key `gate.drift` takes `"fail"`, the default, or `"allow"`, which turns the watch off for a repository whose Steps must write.
- 0b5df0c: Markdown is held by byte budgets alone, and `file-size-ratchet` holds code. `agents-map` holds the agent map to 10240 bytes and counts no lines. `markdown-budget` holds each glob to `maxBytes`, by default `docs/agents/*.md` at 6144 bytes; a list of budgets replaces the default, such as one that adds `GLOSSARY.md` at a budget of its own. `file-size-ratchet` defaults to its `tests` and `source` groups, so it judges no markdown file; a baseline entry for a markdown file is a stale entry, which `dw-sdlc gate --update-baseline` drops. The schema refuses `maxLines` under `agents-map` and under a `markdown-budget` budget, so a config that sets it makes the Gate exit 2, naming the key, until the key goes.
- 67e8d2f: `dw-sdlc gate` is quiet by default, in a terminal, for an agent and in CI. A green run prints one line per Step with its time, as `gate: step pnpm test — pass (71 s)`, one line per Check, as `gate: check primitives — pass`, and a last line, green or failed, and none of a Step's own output. A Step or `gate.checks.run` script runs with its two output streams captured into one, in the order written; when it does not pass, its last 50 lines print indented under its own line, as `gate: step pnpm test — failed, exit 1 (71 s); its last 50 lines:`, and its remedy reads `fix what it printed above; run it alone for the full output`. In a terminal a Step's line shows when it starts and takes its result in place when it ends; piped, each line prints once, finished. `--verbose` passes each command's output through live, colours kept, under a line naming it, and keeps no tail. `--json` keeps stdout to one document and, unless `--verbose` streams the commands to stderr, lets no command's output reach stderr; each Step and Check in it carries `tail`: the last 50 lines of a command that did not pass, null otherwise. SIGINT or SIGTERM sent while a command runs stops it and every command and Check after it, and the Gate still prints its report, the stopped command's last 50 lines and its failure line, `"<command>" was stopped by SIGINT`, included; a second signal, or one sent while the Checks the package ships run, ends the Gate at once. `dw-sdlc check <name>` captures a run script the same way and prints its last 50 lines when it fails. A command the shell cannot find or execute fails with its own remedy and exit 2.
- 71d26c6: `pr.review` sets the Review depth of a head no one has reviewed, `full` or `off`, and `pr ship --review full|off` overrides it for one call. The `review` answer names the depth and its source under `details`; under `off` the Ship script posts the `dw-sdlc/review` success itself, its description saying why. A local layer may tighten `pr.review` and never loosen it, and an invalid layer runs `full`.
- afd512a: A new Check, `routed-docs`, fails each document under `docs/` that no Task Router row of the agent map and no Primitive's `docs` reach, so a task leads an agent to every document that explains it. A row reaches a document through a code span in a cell after the first that names it, a directory above it or a glob that matches it; a Primitive reaches the documents its `docs` name, the heading anchor dropped. A path reads from the root, with or without `./` or `/` before it. `gate.checks.routed-docs` takes `true` or `{ files, exempt }` over the defaults `docs/**/*.md` and `docs/research/**`, and the schema refuses any other option. The map is the file `agents-map` reads and the catalogue the one `primitives` reads. A map with no Task Router table fails once on the map, a missing map exits 2, and a catalogue that is missing or invalid reaches nothing. Each unreached document fails with `no Task Router row or Primitive reaches it — add a Task Router row, name it in a Primitive's docs, or exempt it`. The Check runs after `agents-map` and stays off until a repository turns it on; the setup writes it as `false`.

### Patch Changes

- be85f88: `dw-sdlc references setup` writes the Router's block in the shape oxfmt leaves it in: a blank line after the start marker and before the end marker, each `when` trimmed, and each column padded to its widest cell, the delimiter row's dashes included. A cell's width counts two columns for an emoji or an East Asian wide character and one for any other grapheme, which matches oxfmt on Latin text, CJK, Hangul and emoji. A Gate that runs oxfmt passes on the Router the setup writes after such a `when` changes. A `when` in a script with combining signs, such as Devanagari, or holding a rarer wide character, still gets its table padded again by the formatter.

## 0.7.0

### Minor Changes

- 7198567: `dw-sdlc pr ship [<n>] [-R owner/name] [--merge] [--dry-run] [--json] [--verbose]`, the Ship script, reads one pull request through `gh`, decides the Action it needs next and performs its own: it updates a branch behind its base, marks a draft ready and squash merges a ready pull request with `--match-head-commit`. It answers the first Action that is not its own as one line, or one document with `--json`, and exits 0 done, 10 the agent's turn, 20 wait, 30 the dev's turn, 2 when it cannot run. `pr.merge` in `.ai/agentic.config.json` says who merges: the script under `auto`, the dev under `ask`, the default, and the script for one call under `--merge`; a local layer may tighten it and never loosen it. `dw-sdlc pr reviewed <n> --head <sha>` pins a clean review to the head it read as the commit status `dw-sdlc/review` in state `success`, and posts nothing once a push moved the head.

## 0.6.0

### Minor Changes

- 9512469: References live in `.ai/references.json`, an object with `$schema`, `version` and `references`, validated against `config/references.schema.json`. A `references` key in `.ai/agentic.config.json` is refused by `dw-sdlc references sync` and `dw-sdlc references setup`; the setup moves it into a missing `.ai/references.json` and drops it from the config, keeping the config's layout. A repository with neither gets the file with no References.

## 0.5.1

### Patch Changes

- b8ae934: `dw-sdlc doctor` names a snapshot install's path only when `claude plugin list --json` gives it as a string; any other value reads `installed at ?`, as an unknown version reads `?`.

## 0.5.0

### Minor Changes

- f30acad: `comment-budget` reads the JavaScript, TypeScript and shell (`.sh`) files under its `roots`, with one budget and one failure line for all three. A shell block is a run of `#` lines, each alone on its line. A `#` opens a comment only where it starts a word of code, so a quote, a `${…}`, an arithmetic `((…))`, a heredoc body and the shebang on line 1 hold none. A shell block over the budget fails the Gate, as a JavaScript one does.

## 0.4.0

### Minor Changes

- a3f8c96: `dw-sdlc check <name> [--json] [--root <dir>]` runs one Check of the Gate by its name: a script under `gate.checks.run` or a Check the package ships, without the Steps and the other Checks. A shipped Check runs on the setting `gate.checks` gives it, and on its defaults where the config sets it `false` or leaves it out. The lines, the exit codes and the `--json` document are the Gate's; a name no Check carries exits 2.
- e5ca2bc: `dw-sdlc setup` adopts the Gate in a repository with a `package.json`: `--add-package` pins `dw-sdlc` as a devDependency at the version that runs the setup, refused without the flag, and the committed config gains a `gate` key when it has none, with `agents-map`, `markdown-refs`, `temporal-language` and `comment-budget` on and every other Check `false`. A machine whose settings still enable `guardrails@dw-sdlc` or `references@dw-sdlc` gets a `by hand` line with the `enabledPlugins` edit.

## 0.3.0

### Minor Changes

- 7dd29fd: The doctor and the setup read the `sdlc` plugin, the one plugin of the dw-sdlc marketplace in place of `guardrails` and `references`, and the doctor's `package` line names a drift between the `dw-sdlc` the plugin links and the one the repository pins.

## 0.2.0

### Minor Changes

- a2a99c7: Four Checks over markdown: `markdown-budget` holds the files a glob matches to line and byte budgets, `markdown-refs` fails a relative link or heading anchor that does not resolve, `temporal-language` fails a changelog phrase in a durable document, and `decision-records` holds the decision records to numbers without a gap, a title and an allowed status.
- 8b6da18: The `file-size-ratchet` and `comment-budget` Checks, and `dw-sdlc gate --update-baseline`, which records a Ratchet's baseline where there is none and otherwise only tightens it.

## 0.1.0

### Minor Changes

- f3487cd: The first release: the `dw-sdlc` bin with `dw-sdlc gate`, and the config resolver with its JSON Schema, as JavaScript.
