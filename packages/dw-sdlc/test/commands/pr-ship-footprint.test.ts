// `dw-sdlc pr ship` under footprint local: the Gate mark read from `.git/dw-sdlc/gates/<n>.json` in the place
// of the dw-sdlc/gate status, and every decision the one footprint github takes on the same pull request.

import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE, LOCAL_FILE } from "../../src/agentic-config.ts"
import { repo, runBin } from "../harness.ts"
import { type Context, fakeGh, GREEN, HEAD, type Pr, RUN, served } from "../pr-harness.ts"

const REPOSITORY = "byarcadia-app/foundation"
const TARGET = ["40", "-R", REPOSITORY]
const GATES = join(".git", "dw-sdlc", "gates", "40.json")
const PRIOR = "ad212a6aa5e5c0ffee0ddba11c0de5ca1ab1e0dd"
const CONFIG = { pr: { merge: "ask", ciUnavailable: "gate" }, gate: { steps: ["pnpm test"] } }

type Files = Record<string, string | object>

/** A job GitHub refused to start: failed at once, no step run, as a billing lock leaves it. */
const REFUSED: Context = { kind: "run", name: "Check", state: "FAILURE", link: RUN, steps: 0 }
/** The `dw-sdlc/gate` status footprint github reads a Gate mark from. */
const MARKED: Context = { kind: "status", name: "dw-sdlc/gate", state: "SUCCESS" }
/** A `dw-sdlc/review` status an older Ship script left: of no account under either footprint. */
const STALE: Context = { kind: "status", name: "dw-sdlc/review", state: "FAILURE" }

/** CI unavailable on the head, a stale review status beside it, `more` contexts after. */
function unavailable(...more: Context[]): Pr {
  return { ...GREEN, checks: [REFUSED, STALE, ...more] }
}

/** A checkout under footprint local, `heads` already in its Gate mark file when given. */
function localCheckout(heads: string[] | undefined, config: object = CONFIG): string {
  const files: Files = { [COMMITTED_FILE]: config, [LOCAL_FILE]: { footprint: "local" } }
  return repo({ files: heads === undefined ? files : { ...files, [GATES]: heads } })
}

/** `dw-sdlc <args>` in `root`, gh serving `graphql` in order. */
function run(args: string[], root: string, graphql: Pr[]) {
  const gh = fakeGh({ graphql: graphql.map(served) })
  const ran = runBin(args, root, { ...gh.env, DW_SDLC_NOW: "2026-10-31T11:10:00Z" })
  return { ...ran, calls: gh.calls().map((call) => call.join(" ")) }
}

/** What both footprints must agree on. */
function decision(stdout: string): Record<string, unknown> {
  const { status, action, actor, reason, details, blockers, command } = JSON.parse(stdout) as Record<string, unknown>
  return { status, action, actor, reason, details, blockers, command }
}

const posts = (calls: string[]): string[] => calls.filter((call) => call.includes("/statuses/"))

describe("dw-sdlc pr ship under footprint local", () => {
  it("decides as footprint github does on the same pull request, reading the Gate mark from the local file", () => {
    const cases: [string, Pr, string[] | undefined, Pr][] = [
      ["no Gate mark", unavailable(), undefined, unavailable()],
      ["a Gate mark on the head", unavailable(), [HEAD], unavailable(MARKED)],
      ["a Gate mark on an earlier head", unavailable(), [PRIOR], unavailable()],
      ["green CI", GREEN, [], GREEN]
    ]
    for (const [name, local, heads, github] of cases) {
      const onGithub = run(
        ["pr", "ship", ...TARGET, "--json", "--dry-run"],
        repo({ files: { [COMMITTED_FILE]: CONFIG } }),
        [github]
      )
      const onLocal = run(["pr", "ship", ...TARGET, "--json", "--dry-run"], localCheckout(heads), [local])
      assert.equal(onLocal.status, onGithub.status, `${name}: ${onGithub.stderr}${onLocal.stderr}`)
      assert.deepEqual(decision(onLocal.stdout), decision(onGithub.stdout), name)
      assert.deepEqual(posts(onLocal.calls), [], name)
    }
  })

  it("lets a Gate mark in the local file stand in for CI unavailable: the merge is the dev's, not a proof to make", () => {
    const withMark = run(["pr", "ship", ...TARGET, "--json"], localCheckout([HEAD]), [unavailable()])
    assert.equal(withMark.status, 30, withMark.stderr)
    assert.equal(decision(withMark.stdout).action, "ready-to-merge")
    const without = run(["pr", "ship", ...TARGET, "--json"], localCheckout(undefined), [unavailable()])
    assert.equal(without.status, 10, without.stderr)
    assert.equal(decision(without.stdout).action, "prove-locally")
  })

  it("ignores a dw-sdlc/gate status GitHub holds: only the local file says what the Gate proved", () => {
    const ran = run(["pr", "ship", ...TARGET, "--json"], localCheckout(undefined), [unavailable(MARKED)])
    assert.equal(ran.status, 10, ran.stderr)
    assert.equal(decision(ran.stdout).action, "prove-locally")
  })

  it("writes nothing and posts no status, whatever it decides", () => {
    const local = localCheckout(undefined, { ...CONFIG, pr: { merge: "auto", ciUnavailable: "gate" } })
    const ran = run(["pr", "ship", ...TARGET, "--json", "--dry-run"], local, [GREEN])
    assert.equal(ran.status, 30, ran.stderr)
    assert.deepEqual(posts(ran.calls), [])
    assert.equal(existsSync(join(local, GATES)), false)
    assert.equal(existsSync(join(local, ".git", "dw-sdlc", "reviews")), false)
  })

  it("stops when the local file is not an array of head shas, naming it", () => {
    const local = repo({
      files: { [COMMITTED_FILE]: CONFIG, [LOCAL_FILE]: { footprint: "local" }, [GATES]: { [HEAD]: "great" } }
    })
    const ran = run(["pr", "ship", ...TARGET, "--json"], local, [unavailable()])
    assert.equal(ran.status, 2)
    assert.match(ran.stderr, /gates\/40\.json/)
  })
})
