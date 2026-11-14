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
const SKILLS = ["sdlc-delegate", "sdlc-kickoff", "sdlc-recap"]
const BRIEF_TEMPLATE = "templates/brief.md"
/** The skills that write a Brief, each reading the one template rather than a copy of its rules. */
const BRIEF_WRITERS = ["sdlc-delegate", "sdlc-kickoff", "sdlc-recap"]
/** The skills only the dev starts, by typing them. */
const DEV_ONLY = ["sdlc-kickoff"]

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

  it("lets the model reach sdlc-delegate on the dev's words, and never in a Worker", () => {
    const frontmatter = frontmatterOf(skillText("sdlc-delegate"))
    assert.doesNotMatch(frontmatter, /^disable-model-invocation:/m)
    const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? ""
    assert.match(description, /Invoke it when the dev types \/sdlc-delegate, or asks in their own words/)
    assert.match(
      description,
      /in a repository that has `.ai\/agentic.config.json`, offer it in one line and wait for the dev's go/
    )
    assert.match(description, /A Worker never invokes it/)
    assert.doesNotMatch(description, /: /, "a colon and a space end a plain YAML value")
    assert.doesNotMatch(description, / #/, "a space and a hash start a YAML comment")
  })

  it("leaves sdlc-kickoff for the dev to invoke, never the model", () => {
    for (const name of DEV_ONLY) {
      const frontmatter = frontmatterOf(skillText(name))
      assert.match(frontmatter, /^disable-model-invocation: true$/m, name)
      const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? ""
      assert.ok(description.length > 0, `${name} has a description`)
      assert.doesNotMatch(description, /: /, `${name}: a colon and a space end a plain YAML value`)
    }
  })

  it("has sdlc-kickoff point work this conversation holds at /handoff", () => {
    const description = /^description: (.+)$/m.exec(frontmatterOf(skillText("sdlc-kickoff")))?.[1] ?? ""
    assert.match(description, /^Kick off new work in a session of its own\./)
    assert.match(description, /goes with \/handoff\.$/)
  })

  it("ends sdlc-kickoff in The answer, its ways start, issue and line, and its Next line the word that picks one", () => {
    const text = skillText("sdlc-kickoff")
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1])
    assert.equal(headings.at(-1), "The answer")
    const answer = text.slice(text.lastIndexOf("## The answer"))
    assert.match(answer, /which word picks each way, `start`, `issue` or `line`/)
    assert.match(answer, /the start line, when this session cannot start a Lead/)
    assert.match(answer, /`Next: <word>` in a code span as the last line, the word that picks the way/)
    assert.match(answer, /The closed list:/)
    assert.doesNotMatch(answer, /called by another skill/, "only the dev invokes it")
  })

  it("has sdlc-delegate refuse in a Worker, list its Workers, start each by the command within its limit and wait only a bounded time", () => {
    const text = skillText("sdlc-delegate")
    assert.ok(text.includes('dw-sdlc/src/cli.ts" worker ls --json'), "it lists the Workers")
    assert.ok(text.includes('dw-sdlc/src/cli.ts" worker start --brief'), "it starts each Worker by the command")
    assert.match(text, /--timeout 180/, "its one wait is bounded")
    assert.ok(text.includes('hc get "$HC_TERMINAL_ID" --json'), "it reads its own labels to refuse in a Worker")
    assert.match(text, /--max-workers <n>/, "it counts in flight, not live terminals")
  })

  it("has sdlc-delegate send a spec that lands as one pull request to implement-spec", () => {
    const text = skillText("sdlc-delegate")
    const before = text.slice(text.indexOf("## Before anything"), text.indexOf("## The tickets"))
    assert.match(before, /A spec meant to land as one pull request belongs to `implement-spec`/)
    assert.match(before, /the dev runs\s+`\/sdlc-pr-ship <n>` and `\/sdlc-sweep`/)
  })

  it("has sdlc-recap offer a Sweep from its dry run in the main checkout, and in a linked worktree none", () => {
    const text = skillText("sdlc-recap")
    assert.ok(text.includes('dw-sdlc/src/cli.ts" sweep --dry-run --json'), "it reads the dry-run Sweep")
    assert.match(text, /`worktree\.linked` is false/, "it reads the dry run in the main checkout only")
    assert.match(text, /In a linked worktree, list none/)
    assert.match(text, /`\/sdlc-sweep`/, "the follow-up names the skill the dev's go runs")
  })

  it("has sdlc-recap name the next session, and start one Lead for it and the worker follow-ups only on the dev's go", () => {
    const text = skillText("sdlc-recap")
    assert.match(
      text,
      /\*\*Next session\.\*\* Write it only when `close\.verdict` is `yes`, or your verdict is `done` or `park`/
    )
    assert.match(text, /`\/sdlc-delegate #<n>` in a new Lead session named `lead-<n>-<slug>`/)
    assert.match(text, /"go, but #<m>" starts another/)
    assert.match(text, /Never start it\s+without the dev's go/)
    assert.ok(
      text.includes(
        'dw-sdlc/src/cli.ts" lead start --name lead-<n>-<slug> --prompt "/sdlc-delegate #<n> #<m> ..." --json'
      ),
      "go runs lead start"
    )
    assert.doesNotMatch(text, /lead start[^\n]*--dangerously-skip-permissions/)
    assert.match(
      text,
      /one Lead takes every ticket: the next session's\s+issue first, then the issue each `worker` follow-up was filed as/
    )
    assert.match(text, /a `worker` goes on to the new Lead/)
  })

  it("has sdlc-recap point carrying the work on at /handoff", () => {
    const description = /^description: (.+)$/m.exec(frontmatterOf(skillText("sdlc-recap")))?.[1] ?? ""
    assert.match(description, /Carrying this work on in a fresh session goes with \/handoff\./)
  })

  it("has the combined Recap of sdlc-delegate carry the Sweep follow-up, which the dev's go runs", () => {
    const text = skillText("sdlc-delegate")
    assert.match(text, /carries the Sweep follow-up/)
    assert.match(text, /"go" runs `\/sdlc-sweep`/)
    assert.match(text, /Never remove a Worker's terminal or worktree yourself/)
  })

  it("has the README say the Recap offers the Sweep and the Lead's combined Recap carries it", () => {
    const readme = readFileSync(join(PLUGIN_ROOT, "README.md"), "utf8")
    assert.match(readme, /lists a Sweep as a follow-up `now`/)
    assert.match(readme, /combined\s+Recap carries the Sweep follow-up/)
  })

  it("has every skill that writes a Brief read the one template, which holds the rules they share", () => {
    for (const name of BRIEF_WRITERS) {
      const text = skillText(name)
      assert.ok(text.includes(`\${CLAUDE_PLUGIN_ROOT}/${BRIEF_TEMPLATE}`), `${name} reads the template`)
      assert.doesNotMatch(text, /`opus`/, `${name} leaves the routing of model and effort to the template`)
    }
  })

  it("ships a Brief template with every field, the routing, the name, the start line and the new Lead", () => {
    const template = readFileSync(join(PLUGIN_ROOT, BRIEF_TEMPLATE), "utf8")
    const required = [
      "/implement #<n>",
      "Goal:",
      "Source:",
      "You are the Worker: do it yourself, start no other session.",
      "May write:",
      "Must not:",
      "Proof:",
      "Commit before `/code-review`: it reads `HEAD`.",
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
      "--effort",
      "## The new Lead",
      'lead start --name <name> --prompt "/sdlc-delegate <tickets>" --json',
      "lead-<n>-<slug>",
      "without `--dangerously-skip-permissions`",
      "hc read <address> --lines 60"
    ]
    for (const piece of required) {
      assert.ok(template.includes(piece), `the template holds ${piece}`)
    }
  })

  it("has the Ship line name both skills and leave the rules of the body to /sdlc-pr-open", () => {
    const template = readFileSync(join(PLUGIN_ROOT, BRIEF_TEMPLATE), "utf8")
    const ship = /^Ship: .+$/m.exec(template)?.[0] ?? ""
    assert.ok(ship.includes("open the pull request with `/sdlc-pr-open`"), "it opens with /sdlc-pr-open")
    assert.ok(ship.includes("carry it through `/sdlc-pr-ship`"), "it carries on with /sdlc-pr-ship")
    assert.ok(ship.includes("`pr.merge` in the config decides"), "it leaves the end to pr.merge")
    for (const rule of ["states what changes", "template", "Closes"]) {
      assert.ok(!ship.includes(rule), `the Ship line states no rule of the body: ${rule}`)
    }
    assert.ok(!ship.includes("'"), "the start line quotes the whole Brief in single quotes")
    const note = /- \*\*Ship\.\*\*[\s\S]*?(?=\n- \*\*)/.exec(template)?.[0] ?? ""
    assert.ok(!note.includes("Closes"), "the note speaks of no Closes sentence")
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
