// `dw-sdlc gate --mark`, spawned on a throwaway checkout with a fake gh first on PATH: a green Gate on a
// clean tree whose HEAD is the pull request's pushed head leaves the Gate mark, a `dw-sdlc/gate` status
// or under footprint local a record in the git dir, and anything else leaves none.

import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE, LOCAL_FILE } from "../../src/agentic-config.ts"
import { commit, git, repo, runBin, write } from "../harness.ts"
import { type Context, fakeGh, GREEN, type Pr, RUN, served } from "../pr-harness.ts"

const URL = "https://github.com/byarcadia-app/foundation/pull/40"
const GATES = join(".git", "dw-sdlc", "gates", "40.json")

/** A checkout whose Gate is `steps`, committed, its config's `more` beside `gate`. */
function checkout(steps: string[], more: Record<string, unknown> = {}): { root: string; head: string } {
  const root = repo({ files: { [COMMITTED_FILE]: { gate: { steps }, ...more }, ".gitignore": `${LOCAL_FILE}\n` } })
  git(root, "add", "-A")
  commit(root, "-m", "init")
  return { root, head: git(root, "rev-parse", "HEAD").trim() }
}

/** The pull request of the checkout as gh reads it, its pushed head `head`. */
function pullRequest(head: string): Pr {
  return { ...GREEN, head }
}

function mark(root: string, pr: Pr, args: string[] = []) {
  const gh = fakeGh({ graphql: [served(pr)], commands: { "pr view": { stdout: JSON.stringify({ url: URL }) } } })
  const run = runBin(["gate", "--mark", ...args], root, gh.env)
  const posts = gh.calls().filter((call) => call[1]?.startsWith("repos/byarcadia-app/foundation/statuses/"))
  return { ...run, posts }
}

describe("dw-sdlc gate --mark", () => {
  it("posts the dw-sdlc/gate success on the pushed head the Gate passed on", () => {
    const { root, head } = checkout(["true"])
    const run = mark(root, pullRequest(head))
    assert.equal(run.status, 0, run.stdout + run.stderr)
    assert.deepEqual(run.posts, [
      [
        "api",
        `repos/byarcadia-app/foundation/statuses/${head}`,
        "--method",
        "POST",
        "--silent",
        "-f",
        "state=success",
        "-f",
        "context=dw-sdlc/gate",
        "-f",
        `target_url=${URL}`,
        "-f",
        "description=the Gate passed on this head"
      ]
    ])
    assert.match(run.stdout, new RegExp(`gate: marked ${head}: posted dw-sdlc/gate success\\n$`))
  })

  it("leaves no mark when the Gate fails", () => {
    const { root, head } = checkout(["false"])
    const run = mark(root, pullRequest(head))
    assert.equal(run.status, 1, run.stdout + run.stderr)
    assert.deepEqual(run.posts, [])
  })

  it("refuses a dirty tree before the Gate runs", () => {
    const { root, head } = checkout(["touch ran"])
    write(join(root, "notes.txt"), "draft\n")
    const run = mark(root, pullRequest(head))
    assert.equal(run.status, 2, run.stdout + run.stderr)
    assert.match(run.stderr, /uncommitted changes/)
    assert.equal(existsSync(join(root, "ran")), false)
    assert.deepEqual(run.posts, [])
  })

  it("refuses a HEAD that is not the pull request's pushed head", () => {
    const { root } = checkout(["true"])
    const run = mark(root, pullRequest("b01dfacec0ffee0ddba11c0de5ca1ab1e0ddba11"))
    assert.equal(run.status, 2, run.stdout + run.stderr)
    assert.match(run.stderr, /push HEAD/)
    assert.deepEqual(run.posts, [])
  })

  it("does not combine with --update-baseline, which writes the tree", () => {
    const { root, head } = checkout(["true"])
    const run = mark(root, pullRequest(head), ["--update-baseline"])
    assert.equal(run.status, 2, run.stdout + run.stderr)
  })

  it("records the mark in the git dir under footprint local, and pr ship reads it there", () => {
    const { root, head } = checkout(["true"], { footprint: "local", pr: { merge: "ask", review: "full" } })
    const run = mark(root, pullRequest(head))
    assert.equal(run.status, 0, run.stdout + run.stderr)
    assert.deepEqual(run.posts, [])
    assert.deepEqual(JSON.parse(readFileSync(join(root, GATES), "utf8")), [head])

    // GitHub ran no job on the head, and its Review state is clean: the mark stands in for CI.
    const refused: Context = { kind: "run", name: "Check", state: "FAILURE", link: RUN, steps: 0 }
    write(join(root, ".git", "dw-sdlc", "reviews", "40.json"), JSON.stringify({ [head]: "clean" }))
    const gh = fakeGh({ graphql: [served({ ...pullRequest(head), checks: [refused] })] })
    const ship = runBin(["pr", "ship", "40", "-R", "byarcadia-app/foundation", "--json"], root, {
      ...gh.env,
      DW_SDLC_NOW: "2026-10-31T11:10:00Z"
    })
    assert.equal(JSON.parse(ship.stdout).action, "ready-to-merge", ship.stdout + ship.stderr)
  })
})
