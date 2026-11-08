// The sdlc-sessions plugin as Claude Code loads it: its manifest depending on sdlc, the package linked,
// each skill under its name and who may invoke it, the one Brief template its skills read, and the
// marketplace listing it beside sdlc, each at its manifest's version.

import assert from "node:assert/strict"
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const PLUGIN_ROOT = join(import.meta.dirname, "..")
const PLUGINS = join(PLUGIN_ROOT, "..")
const REPO_ROOT = join(PLUGINS, "..")
const SKILLS = ["sdlc-brief", "sdlc-delegate", "sdlc-recap"]
const BRIEF_TEMPLATE = "templates/brief.md"
/** The skills that write a Brief, each reading the one template rather than a copy of its rules. */
const BRIEF_WRITERS = ["sdlc-brief", "sdlc-delegate", "sdlc-recap"]
/** The skills only the dev starts, by typing them. */
const DEV_ONLY = ["sdlc-brief", "sdlc-delegate"]

type Manifest = { name: string; version: string; dependencies?: unknown; hooks?: unknown }
type Listed = { name: string; source: string; version: string }

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}

function manifestOf(plugin: string): Manifest {
  return readJson(join(PLUGINS, plugin, ".claude-plugin", "plugin.json")) as Manifest
}

function frontmatterOf(text: string): string {
  return /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ""
}

function skillText(name: string): string {
  return readFileSync(join(PLUGIN_ROOT, "skills", name, "SKILL.md"), "utf8")
}

describe("the sdlc-sessions plugin", () => {
  const manifest = manifestOf("sdlc-sessions")

  it("depends on sdlc, so a session keeps the guards, and wires no hook of its own", () => {
    assert.equal(manifest.name, "sdlc-sessions")
    assert.deepEqual(manifest.dependencies, ["sdlc"])
    assert.equal(manifest.hooks, undefined)
  })

  it("links the dw-sdlc package", () => {
    assert.equal(realpathSync(join(PLUGIN_ROOT, "dw-sdlc")), realpathSync(join(REPO_ROOT, "packages", "dw-sdlc")))
  })

  it("ships each skill under its name, named by the rule, and every plugin path a skill runs exists", () => {
    assert.deepEqual(readdirSync(join(PLUGIN_ROOT, "skills")).toSorted(), SKILLS)
    for (const name of SKILLS) {
      assert.match(name, /^sdlc-[a-z]+(?:-[a-z]+)?$/)
      const text = skillText(name)
      assert.match(text, new RegExp(`^---\\nname: ${name}\\n`))
      for (const [, path] of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
        assert.ok(path !== undefined && statSync(join(PLUGIN_ROOT, path)).isFile(), `${name} runs ${path}`)
      }
    }
  })

  it("lets a Brief reach sdlc-recap, its description limiting the model to /sdlc-recap and a Brief", () => {
    const frontmatter = frontmatterOf(skillText("sdlc-recap"))
    assert.doesNotMatch(frontmatter, /^disable-model-invocation:/m)
    const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? ""
    assert.match(description, /Invoke it only when the dev types \/sdlc-recap, or when a Brief tells/)
    assert.match(description, /co dalej\?/)
    assert.doesNotMatch(description, /: /, "a colon and a space end a plain YAML value")
  })

  it("leaves sdlc-brief and sdlc-delegate for the dev to invoke, never the model", () => {
    for (const name of DEV_ONLY) {
      const frontmatter = frontmatterOf(skillText(name))
      assert.match(frontmatter, /^disable-model-invocation: true$/m, name)
      const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? ""
      assert.ok(description.length > 0, `${name} has a description`)
      assert.doesNotMatch(description, /: /, `${name}: a colon and a space end a plain YAML value`)
    }
  })

  it("has sdlc-delegate list its Workers, start each by the command and wait only a bounded time", () => {
    const text = skillText("sdlc-delegate")
    assert.ok(text.includes('dw-sdlc/src/cli.ts" worker ls --json'), "it lists the Workers")
    assert.ok(text.includes('dw-sdlc/src/cli.ts" worker start --brief'), "it starts each Worker by the command")
    assert.match(text, /--timeout 180/, "its one wait is bounded")
  })

  it("has sdlc-recap offer a Sweep from its dry run in the main checkout, and in a linked worktree none", () => {
    const text = skillText("sdlc-recap")
    assert.ok(text.includes('dw-sdlc/src/cli.ts" sweep --dry-run --json'), "it reads the dry-run Sweep")
    assert.match(text, /`worktree\.linked` is false/, "it reads the dry run in the main checkout only")
    assert.match(text, /In a linked worktree, list none/)
    assert.match(text, /`\/sdlc-sweep`/, "the follow-up names the skill the dev's go runs")
  })

  it("has sdlc-delegate leave no Worker's terminal or worktree to the dev, its combined Recap carrying the Sweep", () => {
    const text = skillText("sdlc-delegate")
    assert.doesNotMatch(text, /removing them is the dev's call/)
    assert.match(text, /Sweep follow-up/)
    assert.match(text, /"go" runs `\/sdlc-sweep`/)
    const readme = readFileSync(join(PLUGIN_ROOT, "README.md"), "utf8")
    assert.doesNotMatch(readme, /leaves the Workers' terminals and worktrees for the dev/)
    assert.match(readme, /Sweep follow-up/)
  })

  it("has every skill that writes a Brief read the one template, which holds the rules they share", () => {
    for (const name of BRIEF_WRITERS) {
      const text = skillText(name)
      assert.ok(text.includes(`\${CLAUDE_PLUGIN_ROOT}/${BRIEF_TEMPLATE}`), `${name} reads the template`)
      assert.doesNotMatch(text, /`opus`/, `${name} leaves the routing of model and effort to the template`)
    }
  })

  it("ships a Brief template with every field, the routing, the name and the start line", () => {
    const template = readFileSync(join(PLUGIN_ROOT, BRIEF_TEMPLATE), "utf8")
    const required = [
      "/implement #<n>",
      "Goal:",
      "Source:",
      "You are the Worker: do it yourself, start no other session.",
      "May write:",
      "Must not:",
      "Proof:",
      "/sdlc-pr-ship",
      "deliver it to the Lead the way Report says",
      "Report:",
      "/sdlc-recap",
      "dw-sdlc worker report",
      "Model and effort:",
      "worker.model",
      "worker.effort",
      "`opus`",
      "`xhigh`, `max` or `fable`",
      "worker-<issue>-<slug>",
      "worker.command",
      "--worktree",
      "--model",
      "--effort"
    ]
    for (const piece of required) {
      assert.ok(template.includes(piece), `the template holds ${piece}`)
    }
  })

  it("is listed beside sdlc, each at its manifest's version", () => {
    const { plugins } = readJson(join(REPO_ROOT, ".claude-plugin", "marketplace.json")) as { plugins: Listed[] }
    const listed = plugins.map(({ name, source, version }) => [name, source, version])
    assert.deepEqual(listed, [
      ["sdlc", "./plugins/sdlc", manifestOf("sdlc").version],
      ["sdlc-sessions", "./plugins/sdlc-sessions", manifest.version]
    ])
  })
})
