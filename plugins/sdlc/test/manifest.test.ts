// The plugin as Claude Code loads it: each hook script wired to its event and matcher or run by
// another hook, each skill present under its name and who may invoke it, each subagent under its name
// and on its allowed tools, the package linked, and the marketplace listing this plugin at the manifest's version.

import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const PLUGIN_ROOT = join(import.meta.dirname, "..")
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..")
const HOOKS_DIR = join(PLUGIN_ROOT, "hooks")

type Wiring = { event: string; matcher: string; script: string }

const WIRED: Wiring[] = [
  { event: "PreToolUse", matcher: "Bash", script: "bash-guard.sh" },
  { event: "PreToolUse", matcher: "Bash", script: "rtk-rewrite.sh" },
  { event: "PreToolUse", matcher: "Read|Edit|Write|MultiEdit|NotebookEdit|Grep", script: "block-env-access.sh" },
  { event: "SessionStart", matcher: "startup|resume|clear|compact|fork", script: "session-start.sh" },
  { event: "SessionStart", matcher: "startup", script: "references-sync.sh" },
  { event: "PostToolUse", matcher: "Write", script: "large-file-guard.sh" }
]
/** The guards the dispatcher spawns for a Bash call, beside the one the manifest wires for the file tools. */
const DISPATCHED = [
  "block-dangerous-commands.sh",
  "credential-leak-guard.sh",
  "block-env-access.sh",
  "block-non-pnpm.sh",
  "block-store-writes.sh",
  "block-filtered-output.sh",
  "enforce-commit-hygiene.sh"
]
/** A git hook a repository wires itself, never Claude Code. */
const GIT_HOOKS = ["commit-msg.sh"]
const SKILLS = [
  "sdlc-doctor",
  "sdlc-pr-open",
  "sdlc-pr-ship",
  "sdlc-references-add",
  "sdlc-research",
  "sdlc-setup",
  "sdlc-sweep"
]
/** The skill a Worker starts itself, its description holding the model to a Brief's instruction. */
const WORKER_STARTED_SKILL = "sdlc-pr-ship"
/** The skill the model starts on the dev's word alone, "go" on a Recap follow-up, its description holding it there. */
const WORD_STARTED_SKILL = "sdlc-sweep"
/** The skill the model starts itself, whenever it opens a pull request or writes the body of one. */
const SELF_STARTED_SKILL = "sdlc-pr-open"
/** The skill the model starts when the dev asks for subagents in so many words, its description holding it there. */
const ASK_STARTED_SKILL = "sdlc-research"
const MODEL_REACHABLE = [WORKER_STARTED_SKILL, WORD_STARTED_SKILL, SELF_STARTED_SKILL, ASK_STARTED_SKILL]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}

function byKey(rows: Wiring[]): string[] {
  return rows.map(({ event, matcher, script }) => `${event} ${matcher} ${script}`).toSorted()
}

/** Every command the manifest's `hooks` key wires, read as the script under `hooks/` it runs. */
function wiring(manifest: unknown): Wiring[] {
  assert.ok(isObject(manifest) && isObject(manifest.hooks), "the manifest has a hooks key")
  const rows: Wiring[] = []
  for (const [event, groups] of Object.entries(manifest.hooks)) {
    assert.ok(Array.isArray(groups), `${event} holds a list`)
    for (const group of groups) {
      assert.ok(isObject(group) && typeof group.matcher === "string" && Array.isArray(group.hooks))
      for (const hook of group.hooks) {
        assert.ok(isObject(hook) && hook.type === "command" && typeof hook.command === "string")
        const script = /^"\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([\w-]+\.sh)"$/.exec(hook.command)?.[1]
        assert.ok(script !== undefined, `${hook.command} runs a script under hooks/`)
        rows.push({ event, matcher: group.matcher, script })
      }
    }
  }
  return rows
}

function skillFrontmatter(name: string): string {
  const text = readFileSync(join(PLUGIN_ROOT, "skills", name, "SKILL.md"), "utf8")
  return /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ""
}

describe("the sdlc plugin", () => {
  const manifest = readJson(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"))

  it("wires each hook to its event and matcher", () => {
    assert.deepEqual(byKey(wiring(manifest)), byKey(WIRED))
    for (const { script } of WIRED) {
      assert.ok((statSync(join(HOOKS_DIR, script)).mode & 0o111) !== 0, `${script} is executable`)
    }
  })

  it("runs every other hook script from the dispatcher, sources it, or leaves it to git", () => {
    const dispatcher = readFileSync(join(HOOKS_DIR, "bash-guard.sh"), "utf8")
    for (const guard of DISPATCHED) {
      assert.match(dispatcher, new RegExp(`^\\s*(?:.*\\) )?guard ${guard.replaceAll(".", "\\.")}\\b`, "m"))
    }
    const scripts = readdirSync(HOOKS_DIR).filter((file) => file.endsWith(".sh"))
    const accounted = new Set([...WIRED.map(({ script }) => script), ...DISPATCHED, ...GIT_HOOKS])
    const unaccounted = scripts.filter((file) => !accounted.has(file) && !/^lib(?:-[\w]+)?\.sh$/.test(file))
    assert.deepEqual(unaccounted, [], "a hook script nothing runs")
  })

  it("ships each skill under its name, and every plugin path a skill runs exists", () => {
    assert.deepEqual(readdirSync(join(PLUGIN_ROOT, "skills")).toSorted(), SKILLS)
    for (const name of SKILLS) {
      const text = readFileSync(join(PLUGIN_ROOT, "skills", name, "SKILL.md"), "utf8")
      assert.match(name, /^sdlc-[a-z]+(?:-[a-z]+)?$/)
      assert.match(text, new RegExp(`^---\\nname: ${name}\\n`))
      for (const [, path] of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
        assert.ok(path !== undefined && statSync(join(PLUGIN_ROOT, path)).isFile(), `${name} runs ${path}`)
      }
    }
  })

  it("has a test under test/hooks/ for each hook script that is no library", () => {
    const tests = new Set(readdirSync(join(PLUGIN_ROOT, "test", "hooks")))
    const scripts = readdirSync(HOOKS_DIR).filter((file) => file.endsWith(".sh") && !/^lib(?:-\w+)?\.sh$/.test(file))
    for (const script of scripts) {
      assert.ok(tests.has(script.replace(/\.sh$/, ".test.ts")), `${script} has no test/hooks/ test`)
    }
  })

  it('has sdlc-pr-open keep the "Generated with" footer out of a body', () => {
    const text = readFileSync(join(PLUGIN_ROOT, "skills", SELF_STARTED_SKILL, "SKILL.md"), "utf8")
    assert.match(text, /^- It carries no "Generated with" footer\.$/m)
  })

  it("leaves each skill for the user to invoke, never the model, but the four the model, a Brief, the dev's go or the dev's ask for subagents starts", () => {
    for (const name of SKILLS.filter((skill) => !MODEL_REACHABLE.includes(skill))) {
      assert.match(skillFrontmatter(name), /^disable-model-invocation: true$/m, `${name} is user-invoked`)
    }
  })

  it("lets a Brief reach sdlc-pr-ship, its description limiting the model to /sdlc-pr-ship and a Brief", () => {
    const frontmatter = skillFrontmatter(WORKER_STARTED_SKILL)
    assert.doesNotMatch(frontmatter, /^disable-model-invocation:/m)
    const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? ""
    assert.match(description, /Invoke it only when the dev types \/sdlc-pr-ship, or when a Brief tells/)
    assert.match(description, /carry its pull request through/)
    assert.match(description, /"open a PR", is never this skill/, "opening a pull request is sdlc-pr-open's")
    assert.doesNotMatch(description, /: /, "a colon and a space end a plain YAML value")
  })

  it("has sdlc-pr-ship run no Review: no act review, no pr reviewed, no depth flag, no reviewer subagent", () => {
    const text = readFileSync(join(PLUGIN_ROOT, "skills", "sdlc-pr-ship", "SKILL.md"), "utf8")
    assert.doesNotMatch(text, /act review|pr reviewed|--review\b|sdlc-reviewer|review-limit|mark-reviewed/)
    assert.equal(existsSync(join(PLUGIN_ROOT, "skills", "sdlc-pr-ship", "references")), false)
    assert.equal(existsSync(join(PLUGIN_ROOT, "agents")), false, "the plugin ships no subagent")
  })

  it("lets the model reach sdlc-pr-open, its description triggering on opening a pull request and on its body", () => {
    const frontmatter = skillFrontmatter(SELF_STARTED_SKILL)
    assert.doesNotMatch(frontmatter, /^disable-model-invocation:/m)
    const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? ""
    assert.match(description, /^Open a pull request, or write or rewrite the body of one/)
    assert.match(description, /whenever you open a pull request or write, rewrite or rework a pull request body/)
    assert.match(description, /never merges and never starts \/sdlc-pr-ship/)
    assert.doesNotMatch(description, /: /, "a colon and a space end a plain YAML value")
  })

  it("holds sdlc-pr-open to its evals: queries that trigger it and near misses that do not, and seven behaviours", () => {
    const evals = join(PLUGIN_ROOT, "skills", SELF_STARTED_SKILL, "evals")
    const queries = readJson(join(evals, "trigger.json"))
    assert.ok(Array.isArray(queries))
    const rows = queries.filter(isObject)
    for (const query of ["merge it", "review this pull request", "is CI green on #88?"]) {
      assert.ok(
        rows.some((row) => row.query === query && row.should_trigger === false),
        `${query} must not trigger`
      )
    }
    assert.ok(rows.some((row) => row.should_trigger === true))
    const behaviours = readJson(join(evals, "evals.json"))
    assert.ok(isObject(behaviours) && Array.isArray(behaviours.evals))
    assert.equal(behaviours.skill_name, SELF_STARTED_SKILL)
    assert.deepEqual(
      behaviours.evals.map((entry) => (isObject(entry) ? entry.name : undefined)),
      [
        "repo-with-template-issue-source",
        "repo-without-template-ticket-key",
        "branch-with-open-pr-rewrite-after-review",
        "issue-source-from-a-brief-mermaid-for-a-flow",
        "local-renames-a-worktree-branch-to-the-ticket-key",
        "local-renames-a-worktree-branch-to-the-slug-without-a-key",
        "github-keeps-a-worktree-branch-name"
      ]
    )
  })

  it("lets the dev's go reach sdlc-sweep, its description limiting the model to /sdlc-sweep and a go on a Recap", () => {
    const frontmatter = skillFrontmatter(WORD_STARTED_SKILL)
    assert.doesNotMatch(frontmatter, /^disable-model-invocation:/m)
    const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? ""
    assert.match(description, /It runs only on the dev's word, when the dev types \/sdlc-sweep or says go on a Recap/)
    assert.match(description, /is never this skill/)
    assert.doesNotMatch(description, /: /, "a colon and a space end a plain YAML value")
  })

  it("lets the dev's ask for subagents reach sdlc-research, its description limiting the model to that ask", () => {
    const frontmatter = skillFrontmatter(ASK_STARTED_SKILL)
    assert.doesNotMatch(frontmatter, /^disable-model-invocation:/m)
    assert.doesNotMatch(frontmatter, /^model:/m, "the model is set per agent, never in the frontmatter")
    assert.doesNotMatch(frontmatter, /^context:/m, "the skill runs in the conversation, never a fork")
    assert.match(frontmatter, /^argument-hint: "\[research\|review\|overview\] <question>"$/m)
    const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? ""
    assert.match(description, /^Fan out independent subagents to research, review or map something/)
    assert.match(description, /check what they claim and answer in the conversation/)
    assert.match(description, /Use it only when the dev asks for subagents in so many words/)
    assert.match(description, /It writes no file\. A question without a request for subagents is never this skill/)
    assert.match(description, /a file of findings in the repository is \/research\./)
    assert.doesNotMatch(description, /: /, "a colon and a space end a plain YAML value")
  })

  it("has sdlc-research brief its agents with the material only, set the model per agent and mark what it did not check", () => {
    const text = readFileSync(join(PLUGIN_ROOT, "skills", ASK_STARTED_SKILL, "SKILL.md"), "utf8")
    assert.match(text, /Spawn\s+two\s+to\s+four\s+subagents\s+in\s+one\s+message/)
    assert.match(text, /Spawn\s+more\s+only\s+when\s+the\s+dev\s+says/)
    assert.match(text, /`sonnet`\s+for\s+`research`\s+and\s+`overview`,\s+`opus`\s+for\s+`review`/)
    assert.match(text, /never\s+this\s+session's\s+hypothesis/)
    assert.match(text, /It\s+writes\s+no\s+file/)
    assert.match(text, /marked\s+`unverified`/)
    const answer = text.slice(text.lastIndexOf("## The answer"))
    assert.ok(answer.indexOf("**The verdict**") < answer.indexOf("**The findings.**"))
    assert.ok(answer.indexOf("**The findings.**") < answer.indexOf("**The effort**"))
    assert.ok(answer.indexOf("**The effort**") < answer.indexOf("**Open questions**"))
  })

  it("records sdlc-research as an extension of research in ADR 0028", () => {
    const adr = readFileSync(
      join(REPO_ROOT, "docs", "adr", "0028-sdlc-research-extends-research-and-the-model-may-start-it.md"),
      "utf8"
    )
    assert.match(adr, /It extends `research` and replaces none of it/)
    assert.match(adr, /\*\*Model-invocable\.\*\*/)
  })

  it("runs the sweep through the plugin's link, never a dw-sdlc from PATH, and never a kept item's command", () => {
    const text = readFileSync(join(PLUGIN_ROOT, "skills", WORD_STARTED_SKILL, "SKILL.md"), "utf8")
    assert.match(text, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/dw-sdlc\/src\/cli\.ts" sweep --json/)
    assert.doesNotMatch(text, /^\s*(?:dw-sdlc|pnpm)\b/m)
    assert.match(text, /Never run a kept item's command/)
  })

  it("has sdlc-sweep take dry-run as its argument, the dev's ask to look first", () => {
    const text = readFileSync(join(PLUGIN_ROOT, "skills", WORD_STARTED_SKILL, "SKILL.md"), "utf8")
    assert.match(skillFrontmatter(WORD_STARTED_SKILL), /^argument-hint: "\[dry-run\]"$/m)
    assert.match(text, /Add `--dry-run` only when the dev asked to look first, as `\/sdlc-sweep dry-run`/)
  })

  it("has sdlc-pr-ship wait in the background on the dev's run, the script the only loop, and name no Next for a wait", () => {
    const text = readFileSync(join(PLUGIN_ROOT, "skills", "sdlc-pr-ship", "SKILL.md"), "utf8")
    assert.match(text, /`wait`,\s+when\s+the\s+dev\s+invoked\s+the\s+skill/)
    assert.match(text, /`run_in_background`/)
    assert.match(text, /`gh\s+pr\s+checks\s+<n>\s+--watch\s+--fail-fast`/)
    assert.match(text, /`sleep\s+<recheckAfter>`/)
    assert.match(text, /The\s+script\s+is\s+the\s+only\s+loop/)
    assert.match(
      text,
      /Under\s+`\/loop`,\s+run\s+from\s+a\s+Brief,\s+or\s+called\s+by\s+another\s+skill,\s+start\s+no\s+wait/
    )
    const answer = text.slice(text.lastIndexOf("## The answer"))
    assert.doesNotMatch(answer, /- `wait`:/, "a dev's run never stops at a wait")
  })

  it("ends each skill in The answer, with a closed Next list and the rule for when no line is written", () => {
    for (const name of SKILLS) {
      const text = readFileSync(join(PLUGIN_ROOT, "skills", name, "SKILL.md"), "utf8")
      const headings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1])
      assert.equal(headings.at(-1), "The answer", `${name} ends in ## The answer`)
      const answer = text.slice(text.lastIndexOf("## The answer"))
      assert.match(answer, /`Next: <(?:command|word)>` in a code span as the last line/, `${name} names the Next line`)
      assert.match(answer, /The\s+closed list:/, `${name} holds a closed list`)
      assert.match(answer, /Write the `Next:` line only when the dev invoked the skill/, `${name} says who sees Next`)
    }
  })

  it("links the dw-sdlc package", () => {
    assert.equal(realpathSync(join(PLUGIN_ROOT, "dw-sdlc")), realpathSync(join(REPO_ROOT, "packages", "dw-sdlc")))
  })

  it("is the plugin named sdlc, on the path the marketplace lists it at", () => {
    const marketplace = readJson(join(REPO_ROOT, ".claude-plugin", "marketplace.json"))
    assert.ok(isObject(marketplace) && Array.isArray(marketplace.plugins) && isObject(manifest))
    const entry: unknown = marketplace.plugins.find((plugin) => isObject(plugin) && plugin.name === "sdlc")
    assert.ok(isObject(entry))
    assert.equal(manifest.name, "sdlc")
    assert.equal(entry.source, "./plugins/sdlc")
    assert.equal(entry.version, manifest.version)
  })
})
