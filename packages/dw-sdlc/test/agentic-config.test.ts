import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import {
  COMMITTED_FILE,
  LOCAL_FILE,
  STRICTEST_GUARDRAILS,
  matchesEnvGlob,
  type NodePackageManager,
  resolveConfig,
  validateDocument
} from "../src/agentic-config.ts"
import { commit, git, REPO_ROOT, repo, scratch, write } from "./harness.ts"

const ORG_REMOTE = "git@github.com:acme/app.git"
/** A document no layer may carry: `forcePush` knows `deny`, `ask` and `lease`, never `allow`. */
const FORCE_PUSH_ALLOWED = { version: 1, guardrails: { forcePush: "allow" } }
const DEFAULT_ENV_FILES = {
  policy: "git",
  allow: ["**/.env.example", "**/.env.sample", "**/.env.template"],
  deny: []
}
/** A `references` key the references plugin refuses, which the guardrails schema never names (ADR 0007). */
const MALFORMED_REFERENCES = {
  guardrails: { protectedBranches: ["main"] },
  references: [{ dir: "../x", branch: "main" }, "kody"]
}

function subjectPattern(pattern: string | undefined): RegExp {
  assert.notEqual(pattern, undefined)
  return new RegExp(pattern ?? "")
}

describe("inference, with no config file", () => {
  it("infers Conventional Commits under any remote and the package manager from the lockfile, nothing from Ruby files", () => {
    const root = repo({
      remote: ORG_REMOTE,
      files: { ".ruby-version": "4.0.5\n", Gemfile: "", "package.json": "{}", "pnpm-lock.yaml": "" }
    })
    const { config, problems, layers } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.deepEqual(layers, { committed: "absent", local: "absent" })
    assert.equal(config.commit.convention, "conventional")
    assert.ok(!("stack" in config))
    assert.deepEqual(config.packageManagers, { node: "pnpm" })
    assert.match("feat(scope)!: x", subjectPattern(config.commit.pattern))
    assert.doesNotMatch("[ABC-12] docs: x", subjectPattern(config.commit.pattern))
    assert.equal(config.commit.trailer, undefined)
    assert.deepEqual(config.guardrails, {
      forcePush: "lease",
      commitOnProtected: "allow",
      envFiles: DEFAULT_ENV_FILES,
      protectedBranches: ["master", "main", "production"]
    })
    assert.deepEqual(config.gate, { steps: [], checks: { run: [] } })
    assert.deepEqual(config.worktree, { setup: [] })
    assert.equal(config.baseBranch, "auto")
  })

  it("has no package manager without a lockfile", () => {
    const root = repo({ remote: "https://github.com/dominikwozniak/x.git", files: { "package.json": "{}" } })
    const { config } = resolveConfig(root)
    assert.equal(config.commit.convention, "conventional")
    assert.deepEqual(config.packageManagers, {})
  })

  it("is conventional outside git", () => {
    const { config } = resolveConfig(repo({ git: false }))
    assert.equal(config.commit.convention, "conventional")
  })

  it("infers the Gate command from the manifest's check script, under the lockfile's package manager", () => {
    const check = JSON.stringify({ scripts: { check: "dw-sdlc gate" } })
    const table: [Record<string, string>, string][] = [
      [{ "package.json": check }, "pnpm check"],
      [{ "package.json": check, "pnpm-lock.yaml": "" }, "pnpm check"],
      [{ "package.json": check, "package-lock.json": "" }, "npm run check"],
      [{ "package.json": check, "yarn.lock": "" }, "yarn run check"],
      [{ "package.json": check, "bun.lock": "" }, "bun run check"]
    ]
    for (const [files, command] of table) {
      assert.deepEqual(resolveConfig(repo({ files })).config.gate, { command, steps: [], checks: { run: [] } })
    }
    for (const manifest of ["{}", JSON.stringify({ scripts: { lint: "x" } }), "[]", "{ not json"]) {
      const { config } = resolveConfig(repo({ files: { "package.json": manifest } }))
      assert.equal(config.gate.command, undefined, manifest)
    }
  })

  it("maps each lockfile to its package manager", () => {
    const table: [string, NodePackageManager][] = [
      ["pnpm-lock.yaml", "pnpm"],
      ["package-lock.json", "npm"],
      ["yarn.lock", "yarn"],
      ["bun.lock", "bun"],
      ["bun.lockb", "bun"]
    ]
    for (const [lockfile, manager] of table) {
      const { config } = resolveConfig(repo({ files: { [lockfile]: "" } }))
      assert.equal(config.packageManagers.node, manager, lockfile)
    }
  })
})

describe("the committed file", () => {
  it("overrides inference freely and leaves the rest to the defaults", () => {
    const root = repo({
      remote: ORG_REMOTE,
      files: {
        [COMMITTED_FILE]: {
          baseBranch: "develop",
          guardrails: { forcePush: "deny", protectedBranches: ["master"] },
          gate: { steps: ["pnpm lint"], checks: { run: [{ name: "docs", command: "node docs.ts" }] } }
        }
      }
    })
    const { config, problems, layers } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.equal(layers.committed, "valid")
    assert.equal(config.baseBranch, "develop")
    assert.deepEqual(config.guardrails, {
      forcePush: "deny",
      commitOnProtected: "allow",
      envFiles: DEFAULT_ENV_FILES,
      protectedBranches: ["master"]
    })
    assert.deepEqual(config.gate, {
      steps: ["pnpm lint"],
      checks: { run: [{ name: "docs", command: "node docs.ts" }] }
    })
    assert.equal(config.commit.convention, "conventional")
  })

  it("picks the subject preset from commit.convention when no pattern is set", () => {
    const root = repo({
      remote: ORG_REMOTE,
      files: { [COMMITTED_FILE]: { commit: { convention: "ticket-key" } } }
    })
    const { config, problems } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.equal(config.commit.convention, "ticket-key")
    assert.match("[ABC-12] docs: x", subjectPattern(config.commit.pattern))
    assert.match("[PROJECT-2508] feat: y", subjectPattern(config.commit.pattern))
    assert.doesNotMatch("docs: x", subjectPattern(config.commit.pattern))
  })

  it("names every schema violation by file and path, and the guards go strictest", () => {
    const root = repo({
      files: { [COMMITTED_FILE]: { version: 2, guardrails: { forcePush: "allow", extra: 1 }, unrelatedTool: {} } }
    })
    const { config, problems, layers } = resolveConfig(root)
    assert.deepEqual(problems, [
      { file: COMMITTED_FILE, path: "version", message: "2 is not 1" },
      { file: COMMITTED_FILE, path: "guardrails.forcePush", message: '"allow" is not one of "deny", "ask", "lease"' },
      { file: COMMITTED_FILE, path: "guardrails", message: 'unknown key "extra"' }
    ])
    assert.equal(layers.committed, "invalid")
    assert.deepEqual(config.guardrails, STRICTEST_GUARDRAILS)
  })

  it("leaves the references key to its plugin: a malformed one keeps the guards off the strictest set", () => {
    const root = repo({ files: { [COMMITTED_FILE]: MALFORMED_REFERENCES } })
    const { config, problems, layers } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.equal(layers.committed, "valid")
    assert.deepEqual(config.guardrails, {
      forcePush: "lease",
      commitOnProtected: "allow",
      envFiles: DEFAULT_ENV_FILES,
      protectedBranches: ["main"]
    })
  })

  it("that is not JSON is one problem", () => {
    const root = repo({ files: { [COMMITTED_FILE]: "{ not json" } })
    const { config, problems } = resolveConfig(root)
    assert.equal(problems.length, 1)
    assert.equal(problems[0]?.file, COMMITTED_FILE)
    assert.equal(problems[0]?.path, "")
    assert.match(problems[0]?.message ?? "", /^not JSON: /)
    assert.deepEqual(config.guardrails, STRICTEST_GUARDRAILS)
  })
})

describe("the local file", () => {
  it("tightens guardrails and overrides everything else", () => {
    const root = repo({
      files: {
        [COMMITTED_FILE]: { baseBranch: "main", guardrails: { forcePush: "lease", protectedBranches: ["master"] } },
        [LOCAL_FILE]: {
          baseBranch: "develop",
          guardrails: {
            forcePush: "deny",
            envFiles: { policy: "deny", deny: [".env.staging"] },
            protectedBranches: ["master", "staging"]
          },
          worktree: { setup: ["pnpm install"] }
        }
      }
    })
    const { config, problems, layers } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.deepEqual(layers, { committed: "valid", local: "valid" })
    assert.equal(config.baseBranch, "develop")
    assert.deepEqual(config.guardrails, {
      forcePush: "deny",
      commitOnProtected: "allow",
      envFiles: { ...DEFAULT_ENV_FILES, policy: "deny", deny: [".env.staging"] },
      protectedBranches: ["master", "staging"]
    })
    assert.deepEqual(config.worktree.setup, ["pnpm install"])
  })

  it("sets the Gate key by key over the committed one and the inferred command, gate.steps and gate.checks.run wholesale", () => {
    const root = repo({
      files: {
        "package.json": JSON.stringify({ scripts: { check: "dw-sdlc gate" } }),
        [COMMITTED_FILE]: {
          gate: { steps: ["pnpm lint", "pnpm test"], checks: { run: [{ name: "docs", command: "node docs.ts" }] } }
        },
        [LOCAL_FILE]: { gate: { command: "pnpm verify", steps: ["pnpm test"] } }
      }
    })
    const { config, problems } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.deepEqual(config.gate, {
      command: "pnpm verify",
      steps: ["pnpm test"],
      checks: { run: [{ name: "docs", command: "node docs.ts" }] }
    })
  })

  it("ranks commitOnProtected deny before allow, the default", () => {
    const committed = repo({ files: { [COMMITTED_FILE]: { guardrails: { commitOnProtected: "deny" } } } })
    assert.deepEqual(resolveConfig(committed).problems, [])
    assert.equal(resolveConfig(committed).config.guardrails.commitOnProtected, "deny")

    const tighter = repo({ files: { [LOCAL_FILE]: { guardrails: { commitOnProtected: "deny" } } } })
    assert.deepEqual(resolveConfig(tighter).problems, [])
    assert.equal(resolveConfig(tighter).config.guardrails.commitOnProtected, "deny")

    const looser = repo({
      files: {
        [COMMITTED_FILE]: { guardrails: { commitOnProtected: "deny" } },
        [LOCAL_FILE]: { guardrails: { commitOnProtected: "allow" } }
      }
    })
    const { config, problems, layers } = resolveConfig(looser)
    assert.deepEqual(problems, [
      {
        file: LOCAL_FILE,
        path: "guardrails.commitOnProtected",
        message: '"allow" loosens "deny"; the local file may tighten guardrails, never loosen them'
      }
    ])
    assert.equal(layers.local, "invalid")
    assert.deepEqual(config.guardrails, STRICTEST_GUARDRAILS)
    assert.equal(
      config.guardrails.commitOnProtected,
      "deny",
      "the strictest set refuses a commit on a protected branch"
    )
  })

  it("ranks forcePush ask between deny and lease", () => {
    const tighter = repo({ files: { [LOCAL_FILE]: { guardrails: { forcePush: "ask" } } } })
    assert.deepEqual(resolveConfig(tighter).problems, [])
    assert.equal(resolveConfig(tighter).config.guardrails.forcePush, "ask")
    const looser = repo({
      files: {
        [COMMITTED_FILE]: { guardrails: { forcePush: "ask" } },
        [LOCAL_FILE]: { guardrails: { forcePush: "lease" } }
      }
    })
    assert.deepEqual(resolveConfig(looser).problems, [
      {
        file: LOCAL_FILE,
        path: "guardrails.forcePush",
        message: '"lease" loosens "ask"; the local file may tighten guardrails, never loosen them'
      }
    ])
  })

  it("merges envFiles key by key, each list wholesale", () => {
    const root = repo({
      files: {
        [COMMITTED_FILE]: { guardrails: { envFiles: { allow: [".env", "**/.env.example"], deny: [".env.local"] } } },
        [LOCAL_FILE]: { guardrails: { envFiles: { allow: [".env"] } } }
      }
    })
    const { config, problems } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.deepEqual(config.guardrails.envFiles, { policy: "git", allow: [".env"], deny: [".env.local"] })
  })

  it("may drop an allowed env file and add a denied one, never the reverse", () => {
    const committed = { guardrails: { envFiles: { allow: [".env", "**/.env.example"], deny: [".env.local"] } } }
    const ok = repo({
      files: {
        [COMMITTED_FILE]: committed,
        [LOCAL_FILE]: { guardrails: { envFiles: { allow: [], deny: [".env.local", ".env"] } } }
      }
    })
    assert.deepEqual(resolveConfig(ok).problems, [])

    const bad = repo({
      files: {
        [COMMITTED_FILE]: committed,
        [LOCAL_FILE]: { guardrails: { envFiles: { policy: "git", allow: [".env", ".env.test"], deny: [] } } }
      }
    })
    const { config, problems, layers } = resolveConfig(bad)
    assert.deepEqual(
      problems.map(({ file, path }) => ({ file, path })),
      [
        { file: LOCAL_FILE, path: "guardrails.envFiles.allow" },
        { file: LOCAL_FILE, path: "guardrails.envFiles.deny" }
      ]
    )
    assert.match(
      problems[0]?.message ?? "",
      /adds "\.env\.test"; the local file may drop allowed env files, never add them/
    )
    assert.match(
      problems[1]?.message ?? "",
      /drops "\.env\.local"; the local file may add denied env files, never drop them/
    )
    assert.equal(layers.local, "invalid")
    assert.deepEqual(config.guardrails, STRICTEST_GUARDRAILS)
  })

  it("may not loosen envFiles.policy", () => {
    const root = repo({
      files: {
        [COMMITTED_FILE]: { guardrails: { envFiles: { policy: "deny" } } },
        [LOCAL_FILE]: { guardrails: { envFiles: { policy: "git" } } }
      }
    })
    const { problems } = resolveConfig(root)
    assert.deepEqual(
      problems.map(({ path }) => path),
      ["guardrails.envFiles.policy"]
    )
    assert.match(problems[0]?.message ?? "", /"git" loosens "deny"/)
  })

  it("keeps an explicit commit.pattern over a convention set in another layer", () => {
    const root = repo({
      remote: ORG_REMOTE,
      files: {
        [COMMITTED_FILE]: { commit: { pattern: "^x: .+" } },
        [LOCAL_FILE]: { commit: { convention: "conventional" } }
      }
    })
    const { config, problems } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.deepEqual(config.commit, { convention: "conventional", pattern: "^x: .+" })
  })

  it("may not loosen a guardrail: the whole file is dropped and the guards go strictest", () => {
    const root = repo({
      files: {
        [COMMITTED_FILE]: { guardrails: { forcePush: "deny", protectedBranches: ["master", "production"] } },
        [LOCAL_FILE]: { baseBranch: "develop", guardrails: { forcePush: "lease", protectedBranches: ["master"] } }
      }
    })
    const { config, problems, layers } = resolveConfig(root)
    assert.deepEqual(
      problems.map(({ file, path }) => ({ file, path })),
      [
        { file: LOCAL_FILE, path: "guardrails.forcePush" },
        { file: LOCAL_FILE, path: "guardrails.protectedBranches" }
      ]
    )
    assert.match(problems[0]?.message ?? "", /"lease" loosens "deny"/)
    assert.match(problems[1]?.message ?? "", /drops "production"/)
    assert.deepEqual(layers, { committed: "valid", local: "invalid" })
    assert.deepEqual(config.guardrails, STRICTEST_GUARDRAILS)
    assert.equal(config.baseBranch, "auto")
  })

  it("is measured against the defaults when nothing is committed", () => {
    const same = repo({
      files: {
        [LOCAL_FILE]: { guardrails: { forcePush: "lease", envFiles: { policy: "deny", allow: ["**/.env.example"] } } }
      }
    })
    assert.deepEqual(resolveConfig(same).problems, [])

    const fewer = repo({ files: { [LOCAL_FILE]: { guardrails: { protectedBranches: ["master"] } } } })
    const { problems } = resolveConfig(fewer)
    assert.equal(problems.length, 1)
    assert.equal(problems[0]?.path, "guardrails.protectedBranches")
    assert.match(problems[0]?.message ?? "", /drops "main", "production"/)
  })
})

describe("matchesEnvGlob", () => {
  it("anchors a plain entry at the root and lets `**/` reach any depth", () => {
    assert.ok(matchesEnvGlob(".env", ".env"))
    assert.ok(!matchesEnvGlob(".env", "config/.env"))
    assert.ok(matchesEnvGlob("**/.env.example", ".env.example"))
    assert.ok(matchesEnvGlob("**/.env.example", "a/b/.env.example"))
    assert.ok(!matchesEnvGlob("**/.env.example", ".env.example.bak"))
    assert.ok(matchesEnvGlob("config/.env.*", "config/.env.test"))
    assert.ok(!matchesEnvGlob("config/.env.*", "config/.env"))
    assert.ok(matchesEnvGlob("*/.env", "deep/er/.env"), "* crosses / like a bash [[ == ]] pattern")
    assert.ok(matchesEnvGlob(".env.?", ".env.a"))
    assert.ok(!matchesEnvGlob(".env.{a,b}", ".env.a"), "no brace groups")
    assert.ok(!matchesEnvGlob("(.env)", ".env"), "regex metacharacters are literal")
    assert.ok(matchesEnvGlob(".env.[ab]", ".env.[ab]"), "a bracket is literal, as in the hook")
    assert.ok(!matchesEnvGlob(".env.[ab]", ".env.a"))
  })
})

describe("validateDocument", () => {
  it("rejects a document that allows a force push", () => {
    const file = "agentic.config.json"
    const result = validateDocument(file, JSON.stringify(FORCE_PUSH_ALLOWED))
    assert.ok("problems" in result)
    assert.deepEqual(result.problems, [
      { file, path: "guardrails.forcePush", message: '"allow" is not one of "deny", "ask", "lease"' }
    ])
  })

  it("accepts this repository's own committed config", () => {
    const result = validateDocument(COMMITTED_FILE, readFileSync(join(REPO_ROOT, COMMITTED_FILE), "utf8"))
    assert.ok("value" in result, JSON.stringify(result))
    assert.equal(result.value.commit?.convention, "conventional")
  })

  it("tolerates a top-level key it does not know and accepts packageManagers.ruby", () => {
    const layer = { stack: "rails", packageManagers: { ruby: "bundler" }, commit: { convention: "ticket-key" } }
    const result = validateDocument("x.json", JSON.stringify(layer))
    assert.ok("value" in result, JSON.stringify(result))
  })

  it("tolerates the validation key the gate key replaced, as a top-level key it does not know", () => {
    const result = validateDocument(
      COMMITTED_FILE,
      JSON.stringify({ version: 1, validation: { commands: ["pnpm check"] } })
    )
    assert.ok("value" in result, JSON.stringify(result))
    const { config, problems } = resolveConfig(
      repo({ files: { [COMMITTED_FILE]: { validation: { commands: ["x"] } } } })
    )
    assert.deepEqual(problems, [])
    assert.ok(!("validation" in config))
  })

  it("refuses a Check name it does not ship and an unknown key under gate", () => {
    const document = {
      gate: { checks: { nope: true, run: [{ name: "docs", command: "x", timeout: 1 }] }, parallel: true }
    }
    assert.deepEqual(validateDocument(COMMITTED_FILE, JSON.stringify(document)), {
      problems: [
        { file: COMMITTED_FILE, path: "gate.checks.run[0]", message: 'unknown key "timeout"' },
        { file: COMMITTED_FILE, path: "gate.checks", message: 'unknown key "nope"' },
        { file: COMMITTED_FILE, path: "gate", message: 'unknown key "parallel"' }
      ]
    })
  })

  it("rejects a commit.convention it does not know", () => {
    const result = validateDocument("x.json", JSON.stringify({ commit: { convention: "jira" } }))
    assert.ok("problems" in result)
    assert.deepEqual(result.problems, [
      { file: "x.json", path: "commit.convention", message: '"jira" is not one of "ticket-key", "conventional"' }
    ])
  })

  it("compiles commit.pattern and checks the trailer's shape", () => {
    const result = validateDocument("x.json", JSON.stringify({ commit: { pattern: "(", trailer: "Co-Authored-By:" } }))
    assert.ok("problems" in result)
    assert.deepEqual(
      result.problems.map(({ path }) => path),
      ["commit.pattern", "commit.trailer"]
    )
  })
})

/**
 * A main checkout holding `files` untracked, the way a repository keeps `.ai/` out of git, and a
 * linked worktree of it in a sibling directory holding `own`.
 */
function withWorktree(
  files: Record<string, object>,
  own: Record<string, object> = {}
): { main: string; worktree: string } {
  const main = repo({ files: { ...files, "README.md": "" } })
  git(main, "add", "README.md")
  commit(main, "-m", "init")
  const worktree = join(scratch("config-wt"), "wt")
  git(main, "worktree", "add", "-q", worktree, "-b", "wt")
  for (const [file, content] of Object.entries(own)) {
    write(join(worktree, file), JSON.stringify(content))
  }
  return { main, worktree }
}

describe("a linked worktree", () => {
  const MAIN_LAYERS = {
    [COMMITTED_FILE]: { guardrails: { envFiles: { allow: [".env.test.local"] } } },
    [LOCAL_FILE]: { commit: { convention: "ticket-key" } }
  }

  it("reads each layer it lacks from the main checkout", () => {
    const { main, worktree } = withWorktree(MAIN_LAYERS)
    const { config, problems, layers, sources } = resolveConfig(worktree)
    assert.deepEqual(problems, [])
    assert.deepEqual(layers, { committed: "valid", local: "valid" })
    assert.deepEqual(sources, { committed: main, local: main })
    assert.equal(config.commit.convention, "ticket-key")
    assert.deepEqual(config.guardrails.envFiles.allow, [".env.test.local"])
  })

  it("keeps a layer of its own over the main checkout's", () => {
    const { main, worktree } = withWorktree(MAIN_LAYERS, { [COMMITTED_FILE]: { baseBranch: "develop" } })
    const { config, sources } = resolveConfig(worktree)
    assert.deepEqual(sources, { committed: worktree, local: main })
    assert.equal(config.baseBranch, "develop")
    assert.deepEqual(config.guardrails.envFiles, DEFAULT_ENV_FILES)
    assert.equal(config.commit.convention, "ticket-key")
  })

  it("names no source for a layer neither checkout has", () => {
    const { worktree } = withWorktree({})
    assert.deepEqual(resolveConfig(worktree).sources, { committed: undefined, local: undefined })
  })
})
