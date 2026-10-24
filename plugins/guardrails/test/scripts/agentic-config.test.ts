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
  type Problem,
  resolveConfig,
  validateDocument
} from "../../scripts/agentic-config.ts"
import { commit, git, initRepo, REPO_ROOT, runBash, runScript, scratch, write } from "../harness.ts"

const LIB = join(import.meta.dirname, "..", "..", "hooks", "lib.sh")
const ORG_REMOTE = "git@github.com:acme/app.git"
/** A document no layer may carry: `forcePush` knows `deny`, `ask` and `lease`, never `allow`. */
const FORCE_PUSH_ALLOWED = { version: 1, guardrails: { forcePush: "allow" } }
const DEFAULT_ENV_FILES = {
  policy: "git",
  allow: ["**/.env.example", "**/.env.sample", "**/.env.template"],
  deny: []
}

/** A throwaway repository; `files` maps a relative path to its text, an object is written as JSON. */
function repo(options: { git?: false; remote?: string; files?: Record<string, string | object> } = {}): string {
  const root = scratch("config")
  if (options.git !== false) {
    initRepo(root, options.remote === undefined ? {} : { remote: options.remote })
  }
  for (const [file, content] of Object.entries(options.files ?? {})) {
    write(join(root, file), typeof content === "string" ? content : JSON.stringify(content))
  }
  return root
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
    assert.deepEqual(config.validation, { commands: [] })
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
          validation: { commands: ["pnpm check"] }
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
    assert.deepEqual(config.validation.commands, ["pnpm check"])
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

/** The same resolution through hooks/lib.sh, the copy the guards run. */
function libResolve(root: string): { config: unknown; problems: string[] } {
  const script = `source "$1"; guard_config_load "$2" || exit 9; printf '%s\\n' "$GUARD_CONFIG"; printf '%s' "$GUARD_CONFIG_PROBLEMS"`
  const result = runBash(["-c", script, "lib", LIB, root], "")
  assert.equal(result.status, 0, result.stderr)
  const [first, ...rest] = result.stdout.split("\n")
  return { config: JSON.parse(first ?? ""), problems: rest.filter((line) => line !== "") }
}

function reportLines(problems: Problem[]): string[] {
  return problems.map(({ file, path, message }) =>
    path === "" ? `${file}: ${message}` : `${file}: ${path}: ${message}`
  )
}

describe("hooks/lib.sh agrees with resolveConfig", () => {
  const cases: [string, () => string][] = [
    [
      "on inference alone",
      () => repo({ remote: ORG_REMOTE, files: { ".ruby-version": "4.0.5\n", Gemfile: "", "pnpm-lock.yaml": "" } })
    ],
    [
      "on a committed file over inference",
      () =>
        repo({
          remote: ORG_REMOTE,
          files: {
            "package.json": "{}",
            [COMMITTED_FILE]: {
              baseBranch: "develop",
              guardrails: { forcePush: "deny" },
              commit: { trailer: "Co-Authored-By" }
            }
          }
        })
    ],
    [
      "on a committed convention",
      () => repo({ remote: ORG_REMOTE, files: { [COMMITTED_FILE]: { commit: { convention: "ticket-key" } } } })
    ],
    [
      "on a local convention under a committed pattern",
      () =>
        repo({
          remote: ORG_REMOTE,
          files: {
            [COMMITTED_FILE]: { commit: { pattern: "^x: .+" } },
            [LOCAL_FILE]: { commit: { convention: "conventional" } }
          }
        })
    ],
    [
      "on a committed file with schema violations",
      () => repo({ files: { [COMMITTED_FILE]: { version: 2, guardrails: { forcePush: "allow", extra: 1 } } } })
    ],
    [
      "on a loosening local file",
      () =>
        repo({
          files: {
            [COMMITTED_FILE]: { guardrails: { forcePush: "deny", protectedBranches: ["master", "production"] } },
            [LOCAL_FILE]: { baseBranch: "develop", guardrails: { forcePush: "lease", protectedBranches: ["master"] } }
          }
        })
    ],
    [
      "on a local lease under a committed ask",
      () =>
        repo({
          files: {
            [COMMITTED_FILE]: { guardrails: { forcePush: "ask" } },
            [LOCAL_FILE]: { guardrails: { forcePush: "lease" } }
          }
        })
    ],
    [
      "on a local ask over the default lease",
      () => repo({ files: { [LOCAL_FILE]: { guardrails: { forcePush: "ask" } } } })
    ],
    [
      "on a committed commitOnProtected deny",
      () => repo({ files: { [COMMITTED_FILE]: { guardrails: { commitOnProtected: "deny" } } } })
    ],
    [
      "on a local commitOnProtected deny over the default allow",
      () => repo({ files: { [LOCAL_FILE]: { guardrails: { commitOnProtected: "deny" } } } })
    ],
    [
      "on a local commitOnProtected allow under a committed deny",
      () =>
        repo({
          files: {
            [COMMITTED_FILE]: { guardrails: { commitOnProtected: "deny" } },
            [LOCAL_FILE]: { guardrails: { commitOnProtected: "allow" } }
          }
        })
    ],
    [
      "on a tightening local file",
      () =>
        repo({
          files: {
            [COMMITTED_FILE]: { guardrails: { protectedBranches: ["master"] } },
            [LOCAL_FILE]: { guardrails: { envFiles: { policy: "deny" }, protectedBranches: ["master", "staging"] } }
          }
        })
    ],
    [
      "on envFiles lists merged key by key",
      () =>
        repo({
          files: {
            [COMMITTED_FILE]: {
              guardrails: { envFiles: { allow: [".env", "**/.env.example"], deny: [".env.local"] } }
            },
            [LOCAL_FILE]: { guardrails: { envFiles: { allow: [".env"], deny: [".env.local", ".env.test"] } } }
          }
        })
    ],
    [
      "on a local file adding an allowed env file and dropping a denied one",
      () =>
        repo({
          files: {
            [COMMITTED_FILE]: { guardrails: { envFiles: { policy: "deny", deny: [".env.local"] } } },
            [LOCAL_FILE]: { guardrails: { envFiles: { policy: "git", allow: ["**/.env.example", ".env"], deny: [] } } }
          }
        })
    ]
  ]
  for (const [name, make] of cases) {
    it(name, () => {
      const root = make()
      const expected = resolveConfig(root)
      const actual = libResolve(root)
      assert.deepEqual(actual.config, expected.config)
      assert.deepEqual(actual.problems, reportLines(expected.problems))
    })
  }

  it("on a file that is not JSON, up to the parser's own words", () => {
    const root = repo({ files: { [COMMITTED_FILE]: "{ not json" } })
    const expected = resolveConfig(root)
    const actual = libResolve(root)
    assert.deepEqual(actual.config, expected.config)
    assert.equal(actual.problems.length, 1)
    assert.match(actual.problems[0] ?? "", new RegExp(`^${COMMITTED_FILE}: not JSON: `))
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

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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

  it("resolves the same through hooks/lib.sh", () => {
    for (const own of [{}, { [COMMITTED_FILE]: { baseBranch: "develop" } }]) {
      const { worktree } = withWorktree(MAIN_LAYERS, own)
      const expected = resolveConfig(worktree)
      const actual = libResolve(worktree)
      assert.deepEqual(actual.config, expected.config)
      assert.deepEqual(actual.problems, reportLines(expected.problems))
    }
  })

  it("gets the main checkout named as a layer's source by agentic:check", () => {
    const { main, worktree } = withWorktree(MAIN_LAYERS)
    const verdict = runScript("agentic-config", ["--root", worktree])
    assert.equal(verdict.status, 0, verdict.stderr)
    const line = `^local {6}\\.ai/agentic\\.config\\.local\\.json {2}valid, from ${escaped(main)}$`
    assert.match(verdict.stdout, new RegExp(line, "m"))
  })
})

describe("the agentic:check command", () => {
  it("validates this repository's committed file and exits 0", () => {
    const verdict = runScript("agentic-config", [COMMITTED_FILE], { cwd: REPO_ROOT })
    assert.equal(verdict.status, 0, verdict.stderr)
    assert.equal(verdict.stdout, `${COMMITTED_FILE}: valid\n`)
  })

  it("names the problem in a file that allows a force push and exits 1", () => {
    const root = repo({ git: false, files: { "agentic.config.json": FORCE_PUSH_ALLOWED } })
    const verdict = runScript("agentic-config", [join(root, "agentic.config.json")], { cwd: REPO_ROOT })
    assert.equal(verdict.status, 1)
    assert.match(verdict.stderr, /guardrails\.forcePush: "allow" is not one of "deny", "ask", "lease"/)
  })

  it("exits 1 when the repository's config is invalid, after printing what the guards see", () => {
    const root = repo({ files: { [COMMITTED_FILE]: "{ not json" } })
    const verdict = runScript("agentic-config", ["--root", root])
    assert.equal(verdict.status, 1)
    assert.match(verdict.stdout, /"forcePush": "deny"/)
    assert.match(verdict.stderr, /the guards run on the strictest defaults/)
  })

  it("--root inside a repository resolves the repository's top level", () => {
    const root = repo({ files: { [COMMITTED_FILE]: { baseBranch: "develop" }, "sub/x.txt": "" } })
    const verdict = runScript("agentic-config", ["--root", join(root, "sub")])
    assert.equal(verdict.status, 0, verdict.stderr)
    assert.match(verdict.stdout, /^committed {2}\.ai\/agentic\.config\.json {2}valid$/m)
    assert.match(verdict.stdout, /"baseBranch": "develop"/)
  })
})
