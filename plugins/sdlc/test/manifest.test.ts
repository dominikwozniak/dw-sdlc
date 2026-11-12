// The plugin as Claude Code loads it: each hook script wired to its event and matcher or run by
// another hook, each skill present under its name and who may invoke it, each subagent under its name
// and on its allowed tools, the package linked, and the marketplace listing this plugin at the manifest's version.

import assert from "node:assert/strict"
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
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
const SKILLS = ["sdlc-doctor", "sdlc-pr-open", "sdlc-pr-ship", "sdlc-references-add", "sdlc-setup", "sdlc-sweep"]
/** The skill a Worker starts itself, its description holding the model to a Brief's instruction. */
const WORKER_STARTED_SKILL = "sdlc-pr-ship"
/** The skill the model starts on the dev's word alone, "go" on a Recap follow-up, its description holding it there. */
const WORD_STARTED_SKILL = "sdlc-sweep"
/** The skill the model starts itself, whenever it opens a pull request or writes the body of one. */
const SELF_STARTED_SKILL = "sdlc-pr-open"
const MODEL_REACHABLE = [WORKER_STARTED_SKILL, WORD_STARTED_SKILL, SELF_STARTED_SKILL]
/** The subagents under `agents/`, each a file named as its `name`, spawned as `sdlc:<name>`. */
const AGENTS = ["sdlc-reviewer"]
/** The tools a subagent of the plugin may list: none that edits a file. Its instructions keep Bash to git's reads. */
const ALLOWED_TOOLS = new Set(["Read", "Grep", "Bash"])

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
      assert.match(text, new RegExp(`^---\\nname: ${name}\\n`))
      for (const [, path] of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
        assert.ok(path !== undefined && statSync(join(PLUGIN_ROOT, path)).isFile(), `${name} runs ${path}`)
      }
    }
  })

  it("leaves each skill for the user to invoke, never the model, but the three the model, a Brief or the dev's go starts", () => {
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

  it("lets the model reach sdlc-pr-open, its description triggering on opening a pull request and on its body", () => {
    const frontmatter = skillFrontmatter(SELF_STARTED_SKILL)
    assert.doesNotMatch(frontmatter, /^disable-model-invocation:/m)
    const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? ""
    assert.match(description, /^Open a pull request, or write or rewrite the body of one/)
    assert.match(description, /whenever you open a pull request or write, rewrite or rework a pull request body/)
    assert.match(description, /never merges and never starts \/sdlc-pr-ship/)
    assert.doesNotMatch(description, /: /, "a colon and a space end a plain YAML value")
  })

  it("holds sdlc-pr-open to its evals: queries that trigger it and near misses that do not, and four behaviours", () => {
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
        "issue-source-from-a-brief-mermaid-for-a-flow"
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

  it("runs the sweep through the plugin's link, never a dw-sdlc from PATH, and never a kept item's command", () => {
    const text = readFileSync(join(PLUGIN_ROOT, "skills", WORD_STARTED_SKILL, "SKILL.md"), "utf8")
    assert.match(text, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/dw-sdlc\/src\/cli\.ts" sweep --json/)
    assert.doesNotMatch(text, /^\s*(?:dw-sdlc|pnpm)\b/m)
    assert.match(text, /Never run a kept item's command/)
  })

  it("ships each subagent under its name, at medium effort on the session's model, with no tool that edits a file", () => {
    assert.deepEqual(
      readdirSync(join(PLUGIN_ROOT, "agents")).toSorted(),
      AGENTS.map((name) => `${name}.md`)
    )
    for (const name of AGENTS) {
      const text = readFileSync(join(PLUGIN_ROOT, "agents", `${name}.md`), "utf8")
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ""
      const field = (key: string) => new RegExp(`^${key}: (.+)$`, "m").exec(frontmatter)?.[1]
      assert.equal(field("name"), name)
      assert.ok((field("description") ?? "").length > 0, `${name} has a description`)
      assert.equal(field("effort"), "medium", `${name} runs at medium effort`)
      assert.equal(field("model"), "inherit", `${name} runs on the session's model`)
      const tools = (field("tools") ?? "").split(",").map((tool) => tool.trim())
      assert.ok(
        tools.length > 0 && tools.every((tool) => ALLOWED_TOOLS.has(tool)),
        `${name} tools: ${tools.join(", ")}`
      )
    }
  })

  it("has sdlc-reviewer list what no one asked for as added: lines, only with a spec and outside the Finding count", () => {
    const text = readFileSync(join(PLUGIN_ROOT, "agents", "sdlc-reviewer.md"), "utf8")
    assert.match(text, /`added: <file>:<line> — <what the spec did not ask for>`/)
    assert.match(text, /When\s+a\s+spec\s+is\s+stated/)
    assert.match(text, /does\s+not\s+count\s+toward\s+`findings: <n>`\s+and\s+never\s+holds\s+the\s+merge/)
    assert.match(text, /Planned\s+but\s+not\s+done\s+is\s+still\s+a\s+Finding/)
  })

  it("has sdlc-pr-ship carry added: lines and scope creep into Decisions without you at every Review depth", () => {
    const text = readFileSync(join(PLUGIN_ROOT, "skills", "sdlc-pr-ship", "SKILL.md"), "utf8")
    assert.match(text, /Whatever\s+the\s+Review\s+depth,\s+carry\s+what\s+no\s+one\s+asked\s+for/)
    assert.match(text, /Recap's\s+"Decisions\s+without\s+you"/)
    assert.match(text, /at\s+`light`,\s+each\s+`added:`\s+line/)
    assert.match(text, /at\s+`full`,\s+each\s+scope-creep\s+item\s+`code-review`\s+reports/)
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
