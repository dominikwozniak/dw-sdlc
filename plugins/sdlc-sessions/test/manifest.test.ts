// The sdlc-sessions plugin as Claude Code loads it: its manifest depending on sdlc, the package linked,
// each skill under its name with a description that keeps model invocation narrow, and the marketplace
// listing it beside sdlc, each at its manifest's version.

import assert from "node:assert/strict"
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const PLUGIN_ROOT = join(import.meta.dirname, "..")
const PLUGINS = join(PLUGIN_ROOT, "..")
const REPO_ROOT = join(PLUGINS, "..")
const SKILLS = ["sdlc-recap"]

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
