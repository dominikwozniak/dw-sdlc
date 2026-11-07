// Every `dw-sdlc` line a SKILL.md of any plugin runs, held to the bin's own parser, so a renamed
// subcommand or flag fails the Gate instead of a live session. A flag outside a `dw-sdlc` command line
// stays unchecked.

import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it } from "node:test"

import { binLines, violations } from "./skill-lines.ts"

const PLUGINS = join(import.meta.dirname, "..", "..")
const REPO_ROOT = join(PLUGINS, "..")

type Skill = { plugin: string; path: string }

/** Every skill of every plugin under `plugins/`. */
function skills(): Skill[] {
  return readdirSync(PLUGINS)
    .toSorted()
    .flatMap((plugin) => {
      const dir = join(PLUGINS, plugin, "skills")
      return existsSync(dir)
        ? readdirSync(dir)
            .toSorted()
            .map((name) => ({ plugin, path: join(dir, name, "SKILL.md") }))
        : []
    })
}

describe("the bin lines of a skill", () => {
  it("are read from a code block and from a sentence, the placeholders filled", () => {
    const text = [
      "Run it:",
      "",
      "```bash",
      'node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" pr ship [<n>] --json',
      "```",
      "",
      'Then `node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" pr reviewed <n> --head <head> --to <dir>`; it exits 2.'
    ].join("\n")
    assert.deepEqual(binLines(text), [
      { line: 4, text: "pr ship [<n>] --json", words: ["pr", "ship", "--json"] },
      {
        line: 7,
        text: "pr reviewed <n> --head <head> --to <dir>",
        words: ["pr", "reviewed", "1", "--head", "a".repeat(40), "--to", "x"]
      }
    ])
  })

  it("leave a flag named only in prose unchecked, and probe a bracketed flag", () => {
    const text = [
      "Add `--merge` or `--bogus` only when the dev asked.",
      '`node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" pr ship [<n>] [--merge] --json`'
    ].join("\n")
    assert.deepEqual(
      binLines(text).map(({ words }) => words),
      [["pr", "ship", "--merge", "--json"]]
    )
  })

  it("fail the probe, naming the skill and the line, when a skill names a subcommand or a flag the bin does not parse", () => {
    const plugin = join(PLUGINS, "sdlc")
    for (const args of ["pr ship --jsn", "pr reviewd <n>", "pr reviewed <n> --sha <head>", "nope"]) {
      const text = `Run:\n\n\`node "\${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" ${args}\``
      const [message, ...rest] = violations(plugin, "skills/sdlc-x/SKILL.md", text)
      assert.deepEqual(rest, [], args)
      assert.ok(message?.startsWith(`skills/sdlc-x/SKILL.md:3 \`${args}\` exits 2`), `${args}: ${message}`)
    }
  })

  it("fail the probe when `--json` is renamed in the text of a real skill", () => {
    const path = join(PLUGINS, "sdlc-sessions", "skills", "sdlc-recap", "SKILL.md")
    const text = readFileSync(path, "utf8")
    const renamed = text.replaceAll("--json", "--jsn")
    assert.notEqual(renamed, text, "the skill names --json in a code span")
    const [message] = violations(join(PLUGINS, "sdlc-sessions"), relative(REPO_ROOT, path), renamed)
    assert.match(message ?? "", /^plugins\/sdlc-sessions\/skills\/sdlc-recap\/SKILL\.md:\d+ `recap --jsn` exits 2/)
  })

  it("pass the probe in every SKILL.md of every plugin", () => {
    const failures: string[] = []
    let probed = 0
    for (const { plugin, path } of skills()) {
      const text = readFileSync(path, "utf8")
      probed += binLines(text).length
      failures.push(...violations(join(PLUGINS, plugin), relative(REPO_ROOT, path), text))
    }
    assert.ok(probed > 0, "a skill runs the bin")
    assert.deepEqual(failures, [])
  })
})
