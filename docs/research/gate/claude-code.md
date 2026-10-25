# Claude Code — the session hook and a plugin's symlinks

Read from `https://code.claude.com/docs/en/hooks` on 2026-10-25, and from `R/dw-solo-skills` at its
`main` ref of that day. The general hook facts are in
`docs/research/agentic-guardrails/claude-code.md`; this file holds what the Gate design asked.

## SessionStart

- Matchers: `startup` ("New session"), `resume` (`--resume`, `--continue`, `/resume`), `clear`
  (`/clear`), `compact` ("Auto or manual compaction"), `fork`. "`SessionStart` hooks run again on
  resume with `source` set to `"resume"`, or `"fork"` if you added `--fork-session`, so they can
  refresh their context."
- "Useful for loading development context like existing issues or recent changes to your codebase,
  or setting up environment variables. For static context that doesn't require a script, use
  CLAUDE.md instead."
- "SessionStart runs on every session, so keep these hooks fast. Only `type: "command"` and
  `type: "mcp_tool"` hooks are supported." At launch the `mcp_tool` hooks are skipped, since the
  servers are not up yet.
- Plain stdout is added "as context that Claude can see and act on", placed "at the start of the
  conversation, before the first prompt"; `hookSpecificOutput.additionalContext` does the same, and
  `SessionStart` also accepts `initialUserMessage`, `watchPaths`, `sessionTitle` and `reloadSkills`.
  "No blocking or decision control".
- The cap: `additionalContext`, `systemMessage`, `initialUserMessage` and plain stdout "are capped at
  10,000 characters"; over it, "Claude Code saves the output to a file in the session directory and
  replaces it with the file path and a preview of up to the first 2,000 characters."
- Exit 2 from `SessionStart` is rendered "as a `<hook name> hook error` notice"; "Claude doesn't see
  it, and the session or subagent proceeds."
- Measured in this repository the same day: the guardrails and references hooks print about 706
  characters per session, eight Sync lines and one worktree line, and only when there is something
  live to say.

## PostToolUse and Stop

- `PostToolUse` cannot block through an exit code: "Shows stderr to Claude; the tool already ran". It
  may answer `decision: "block"` with a reason, and `updatedToolOutput` rewrites the result.
- `Stop` blocks: "Prevents Claude from stopping, continues the conversation"; `onFailure` has no
  effect on it, since "exit code 2 on these events sends Claude back to keep working".

## A plugin's symlinks

- `R/dw-solo-skills/docs/agents/skills-and-plugins.md:12-15`: "`claude plugin install`
  **dereferences** symlinks — the plugin gets a real copy in the plugin cache — so a skill body
  invokes a shipped script as `${CLAUDE_PLUGIN_ROOT}/scripts/<script>.sh` and the path resolves.
  `templates/` gets the same treatment (`plugins/dw-solo-setup/templates -> ../../templates`".
- Lines 91-93: "`claude plugin validate plugins/<plugin> --strict` reads components **without
  following symlinks**, so it never sees this repo's canon". A linked directory of scripts, not of
  plugin components, is outside what the validator reads.
