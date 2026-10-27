// The plugin as Claude Code loads it: each hook script wired to its event and matcher or run by
// another hook, each skill present under its name, the package linked, and the marketplace listing
// this plugin alone at the manifest's version.

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
  "enforce-commit-hygiene.sh"
]
/** A git hook a repository wires itself, never Claude Code. */
const GIT_HOOKS = ["commit-msg.sh"]
const SKILLS = ["sdlc-doctor", "sdlc-references-add", "sdlc-setup"]

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

  it("links the dw-sdlc package", () => {
    assert.equal(realpathSync(join(PLUGIN_ROOT, "dw-sdlc")), realpathSync(join(REPO_ROOT, "packages", "dw-sdlc")))
  })

  it("is the one plugin the marketplace lists, at the manifest's version", () => {
    const marketplace = readJson(join(REPO_ROOT, ".claude-plugin", "marketplace.json"))
    assert.ok(isObject(marketplace) && Array.isArray(marketplace.plugins) && isObject(manifest))
    const listed = marketplace.plugins.map((plugin) =>
      isObject(plugin) ? [plugin.name, plugin.source, plugin.version] : plugin
    )
    assert.deepEqual(listed, [[manifest.name, "./plugins/sdlc", manifest.version]])
    assert.equal(manifest.name, "sdlc")
  })
})
