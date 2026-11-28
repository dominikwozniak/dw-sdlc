# Claude Code — what a plugin can share across its skills

Read on 2026-11-28 from the official docs as `.md`, `https://code.claude.com/docs/en/`: `skills`,
`plugins/components`, `plugins/manifest-reference` (the page `plugins-reference` serves), `plugins/loading`;
and from the Claude Code `CHANGELOG.md` at `https://github.com/anthropics/claude-code` (`main` of that day).
The installed client is 2.1.332. Hook and worktree facts are in
`docs/research/agentic-guardrails/claude-code.md` and `docs/research/gate/claude-code.md`; this file does not
repeat them. It extends the second one (see "Extends" at the end). Ticket: #513.

## Answer in short

| question                                                          | answer                                                                                                               | basis |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----- |
| A command on the session's `PATH`?                                | Yes. A `bin/` directory at the plugin root is on the Bash tool's `PATH` while the plugin is enabled.                 | read  |
| Does a skill's command see `${CLAUDE_PLUGIN_ROOT}` as an env var? | No. It is a text substitution in the SKILL.md body, not exported to Bash-tool commands.                              | read  |
| Where does `${CLAUDE_PLUGIN_ROOT}` expand in a SKILL.md?          | Anywhere in the Markdown body (prose, code fences, `!` injections) and in `allowed-tools` Bash rules.                | read  |
| Can several skills read one file?                                 | Yes: put it anywhere in the plugin, name it as `${CLAUDE_PLUGIN_ROOT}/<path>` in each skill. The docs name this use. | read  |

## A command on `PATH`

- "Files in `bin/` at the plugin root are on the `PATH` of the Bash tool's shell while the plugin is
  enabled, so Claude can run them as bare commands." Make the file executable (`chmod +x`).
  `plugins/components#executables`; the same row in the layout table of `plugins/manifest-reference`.
- "Plugin `bin/` directories come after the user's own `PATH` entries, so a plugin can't shadow `git`,
  `ls`, or another system command." Same section. A `dw-sdlc` already on the user's `PATH` (for example
  from `pnpm add -g dw-sdlc`) wins over the plugin's.
- "claude.ai and Cowork don't install a plugin that has a top-level `bin/` directory." Same section. The
  CLI and the desktop client are not named in that exclusion.
- A PowerShell tool command outside the sandbox finds `bin/` too; a sandboxed one does not. Same section.
- Landed in 2.1.91: "Plugins can now ship executables under `bin/` and invoke them as bare commands from
  the Bash tool" (`CHANGELOG.md`, entry `## 2.1.91`). Later fixes: nonexistent `bin/` directories are no
  longer added to `PATH` (2.1.284); the shell profile is re-sourced only when the plugins' `bin/`
  directories changed (changelog line "Fixed the Bash tool re-sourcing the shell profile").
- The injected commands of a skill (`` !`cmd` ``) "run through the Bash tool" and "share the working
  directory, timeout, and output handling" with Claude's own shell commands (`skills#how-injected-commands-run`).
  That makes the `PATH` the same one, but the page does not say so in words (inferred).
- Plugin hook commands do not get `bin/` through this rule; they use `${CLAUDE_PLUGIN_ROOT}` (hooks row of
  `plugins/manifest-reference#where-each-variable-resolves`). Nothing in the docs says a hook's `PATH`
  holds `bin/` (unverified).

## Where `${CLAUDE_PLUGIN_ROOT}` expands

- `skills#available-string-substitutions`: "`${CLAUDE_PLUGIN_ROOT}` — The plugin's installation directory.
  Substituted only in plugin skills. Use this to reference scripts or files bundled anywhere in the plugin,
  including resources shared between the plugin's skills."
- Same page: "Claude Code substitutes `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` in two places: the
  skill's markdown content, and Bash rules in the `allowed-tools` frontmatter. In a plugin skill, Claude
  Code substitutes `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` in the same two places."
- `plugins/manifest-reference#where-each-variable-resolves`: for "Skill, command, and agent content" the
  reference resolves "Anywhere in the Markdown body". So prose is covered as well as code: the line
  `${CLAUDE_PLUGIN_ROOT}/templates/brief.md` in `plugins/sdlc-sessions/skills/sdlc-kickoff/SKILL.md:16` is
  text, not a command.
- The same table: "The variables aren't present in the environment of commands Claude runs through the
  Bash tool, in the main session or in a subagent. In skill, command, and agent content, write the `${...}`
  reference in the Markdown body instead, and Claude Code substitutes the path inline when it loads the
  content." A script the skill runs cannot read `$CLAUDE_PLUGIN_ROOT`; it gets the path only as a literal
  argument the body wrote. Hook, MCP stdio and LSP processes do get it exported.
- Not listed as a place: the YAML frontmatter outside `allowed-tools`, such as `description` (unverified;
  the docs name only the body and `allowed-tools`).
- Substitution runs when the skill loads, so Claude sees a literal absolute path. For an argument value
  containing `${CLAUDE_*}` text, "Claude Code still replaces `${CLAUDE_*}` variables ... after it inserts
  the arguments" (`skills#available-string-substitutions`).
- History: `${CLAUDE_PLUGIN_ROOT}` in plugin `allowed-tools` frontmatter was fixed in 2.1.0;
  `${CLAUDE_SKILL_DIR}` added in 2.1.69; `${CLAUDE_PLUGIN_DATA}` in 2.1.78 (`CHANGELOG.md`). The first
  date of `${CLAUDE_PLUGIN_ROOT}` in a SKILL.md body is not in the changelog entries found (unverified).
- `${CLAUDE_SKILL_DIR}` in a plugin skill "is the skill's subdirectory within the plugin, not the plugin
  root" (`skills#available-string-substitutions`). With it a skill reaches `../../templates` only by a
  relative climb, so `${CLAUDE_PLUGIN_ROOT}` is the variable for shared files.
- The value: "the plugin's installed version", `cache/<marketplace>/<plugin>/<version>/` for a marketplace
  install (`plugins/loading#find-plugins-on-disk`). "`${CLAUDE_PLUGIN_ROOT}` changes when the plugin
  updates, so don't write state there."

## A file shared by several skills

- The documented route is one path from the plugin root, repeated in each skill. The substitution row
  above says "including resources shared between the plugin's skills".
- `skills#add-supporting-files` shows the other route: files inside the skill's own directory, named by a
  relative link such as `[reference.md](reference.md)` "so Claude knows what each file contains and when to
  load it". The page does not define what a relative link resolves against. With `${CLAUDE_SKILL_DIR}` the
  absolute path is explicit.
- How the model opens a shared file: the page documents no loader. A skill's body is "a single message" in
  the conversation (`skills#skill-content-lifecycle`), so the model reads the file with its own tools.
  After substitution the path is absolute, so the Read tool or `cat` takes it (inferred). Whether a Read
  outside the project's working directory prompts for permission for a path under
  `~/.claude/plugins/cache/` is not in the pages read (unverified).
- A `!` injection can inline the shared file's text at load, instead of leaving the model to open it:
  `` !`cat ${CLAUDE_PLUGIN_ROOT}/<file>` `` (inferred from `skills#inject-dynamic-context`: "The command
  output replaces the placeholder"). Costs: a non-zero exit "aborts the entire skill invocation"; stderr
  is merged into the text; the command is checked against permission rules and, outside auto mode, one
  that does not pass aborts the skill unless `allowed-tools` pre-approves it
  (`skills#when-an-injected-command-fails`, `#permission-checks-on-injected-commands`). A
  `PreSkillShellCommand` hook can refuse such commands (same section; changelog "Added a
  `PreSkillShellCommand` hook event").
- Re-invoking a skill "whose rendered content is identical" adds only a note; after compaction each skill
  keeps "the first 5,000 tokens" under a shared 25,000-token budget (`skills#skill-content-lifecycle`). A
  shared file inlined by `!` counts in that budget; a file the model reads by tool does not ride with the
  skill after compaction (inferred).
- Components may not reach outside the plugin: "A path that points outside the plugin as written, such as
  `../shared-utils`" and "A symlink that leads outside the plugin" are rejected as component paths; a
  copied plugin does not carry "files outside the plugin directory" (`plugins/loading#in-place-and-copied-plugins`,
  `#paths-that-escape-the-plugin-directory`). So a shared file lives inside the plugin directory.
- Two plugins share nothing by this route: `plugins/sdlc-sessions` depends on `sdlc` but has its own root.
  The docs read mention only "links between plugins within one marketplace" as an allowed symlink case
  (`plugins/loading`, linking to `plugins/host-marketplace#share-files-within-a-marketplace-with-symlinks`,
  not read). Whether a plugin may name another's `${CLAUDE_PLUGIN_ROOT}` is not documented (unverified).

## How this repository wires it today

- `plugins/sdlc/.claude-plugin/plugin.json` has no `bin` key and the plugin has no `bin/` directory; hooks
  call `"${CLAUDE_PLUGIN_ROOT}/hooks/<guard>.sh"`.
- `plugins/sdlc/dw-sdlc` and `plugins/sdlc-sessions/dw-sdlc` are symlinks to `packages/dw-sdlc`;
  `docs/contributing/plugin-internals.md:26` says `claude plugin install` copies it as a real directory.
  Each plugin therefore carries its own copy of the package.
- Skills run `node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" <args>`. The test pattern
  `plugins/sdlc/test/skill-lines.test.ts` / `skill-lines.ts:14` is
  `/node "\$\{CLAUDE_PLUGIN_ROOT\}\/dw-sdlc\/src\/cli\.ts" .../`, and line 44 spawns that file with
  `--help`. A bare `dw-sdlc` line would need a new pattern there.
- `packages/dw-sdlc/src/cli.ts:1` starts `#!/usr/bin/env node` and the file is mode 755; `package.json`
  has `"bin": {"dw-sdlc": "src/cli.ts"}`. A `bin/dw-sdlc` in the plugin can be a link to that file or a
  two-line shell wrapper. The docs do not say whether `bin/` entries may be symlinks, nor whether the
  install copy keeps the executable bit and the link (unverified; the dereference fact in
  `docs/research/gate/claude-code.md` was read for a directory link, not a file link).
- The Node 24 type stripping of `cli.ts` needs a path outside `node_modules`; the plugin cache path
  `~/.claude/plugins/cache/...` is such a path (inferred from Node's rule, not from Claude Code docs).

## Extends

- `docs/research/gate/claude-code.md` ("A plugin's symlinks") quotes a repository note that `${CLAUDE_PLUGIN_ROOT}/scripts/<script>.sh`
  resolves in a skill body. The official pages now confirm the variable in a SKILL.md body, in prose and in
  commands, and add: it is not an env var for Bash-tool commands, and it works in `allowed-tools`.
- It does not mention `bin/`. The `bin/` route above is new to this repository's research.
- Nothing in `docs/research/agentic-guardrails/claude-code.md` is corrected.

## Unverified

- Run end to end: not done. Nothing here was executed with a real plugin; every claim is read from the
  docs, or marked inferred.
- Whether `bin/` entries may be symlinks, and whether `claude plugin install` keeps a link or the mode bit.
- Whether `bin/` is on a hook command's `PATH`.
- Whether `${CLAUDE_PLUGIN_ROOT}` expands in frontmatter fields other than `allowed-tools`.
- Whether a Read of a plugin-cache path outside the working directory prompts.
- The version in which `${CLAUDE_PLUGIN_ROOT}` first expanded in a SKILL.md body.
- Whether one plugin may name a file of another plugin it depends on.
- The `allowed-tools` rule shape for a bare plugin command, such as `Bash(dw-sdlc *)`: the docs show the
  rule only with a `${CLAUDE_SKILL_DIR}` path.
