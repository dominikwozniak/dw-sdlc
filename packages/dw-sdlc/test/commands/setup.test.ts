import assert from "node:assert/strict"
import { chmodSync, existsSync, readFileSync } from "node:fs"
import { delimiter, join } from "node:path"
import { describe, it } from "node:test"
import { pathToFileURL } from "node:url"

import { COMMITTED_FILE, LOCAL_FILE, resolveConfig, schemaId } from "../../src/agentic-config.ts"
import { type SetupOptions, type Step, schemaReference, setup } from "../../src/commands/setup.ts"
import { GLOBAL_DENY, LEASE_RULE } from "../../src/setup-rules.ts"
import {
  commit,
  git,
  initRepo,
  lines,
  PACKAGE_ROOT,
  REPO_ROOT,
  type Run,
  runBin as spawnBin,
  scratch,
  write as writeFile,
  writeJson
} from "../harness.ts"

/** This machine's PATH without any directory that holds a `cswap`, so a run never finds the dev's own. */
const PATH_WITHOUT_CSWAP = (process.env.PATH ?? "")
  .split(delimiter)
  .filter((dir) => !existsSync(join(dir, "cswap")))
  .join(delimiter)

/** The bin on a PATH with no `cswap`, unless a test names another; `env` over it. */
function runBin(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Run {
  return spawnBin(args, cwd, { PATH: PATH_WITHOUT_CSWAP, ...env })
}

/** This machine's PATH without a `cswap` and with a fake one first. */
function withCswap(): string {
  const dir = scratch("cswap")
  writeFile(join(dir, "cswap"), "#!/bin/sh\nexit 0\n")
  chmodSync(join(dir, "cswap"), 0o755)
  return `${dir}${delimiter}${PATH_WITHOUT_CSWAP}`
}

function write(root: string, file: string, text: string): void {
  writeFile(join(root, file), text)
}

/** The version of the package under test, the one the setup pins. */
const VERSION = String(JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version)

/** A pnpm repository on the Gate, with a tracked .env, an ignored .env.development and one commit. */
function nodeRepo(): string {
  const root = initRepo(scratch("setup"), { branch: "main", remote: "git@github.com:acme/app.git" })
  write(root, "package.json", JSON.stringify({ devDependencies: { "dw-sdlc": VERSION } }) + "\n")
  write(root, "pnpm-lock.yaml", "")
  write(root, COMMITTED_FILE, JSON.stringify({ version: 1, gate: {} }) + "\n")
  write(root, ".gitignore", ".env.development\n*.local\n")
  write(root, ".env", "SAFE=1\n")
  write(root, ".env.development", "SECRET=1\n")
  write(root, ".env.local", "SECRET=2\n")
  git(root, "add", "package.json", "pnpm-lock.yaml", COMMITTED_FILE, ".gitignore", ".env")
  commit(root, "-m", "init")
  return root
}

/** Where the marketplace clone holds the schema: behind the plugin's link to the package. */
const SCHEMA_FILE = "plugins/sdlc/dw-sdlc/config/agentic.config.schema.json"

/** A home where Claude Code registers the dw-sdlc marketplace at `clone`, holding the schema. */
function homeWithClone(clone: string, options: { schema?: boolean } = {}): string {
  const home = scratch("home")
  writeJson(join(home, ".claude/plugins/known_marketplaces.json"), {
    "dw-sdlc": { source: { source: "github", repo: "dominikwozniak/dw-sdlc" }, installLocation: clone }
  })
  writeJson(join(clone, ".claude-plugin/marketplace.json"), {
    name: "dw-sdlc",
    plugins: [{ name: "sdlc", source: "./plugins/sdlc" }]
  })
  if (options.schema !== false) {
    write(clone, SCHEMA_FILE, "{}\n")
  }
  return home
}

function json(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  assert.ok(typeof parsed === "object" && parsed !== null)
  return parsed as Record<string, unknown>
}

function outcomes(steps: Step[]): Record<string, string> {
  return Object.fromEntries(steps.map((step) => [step.file, step.outcome]))
}

function run(
  root: string,
  home: string,
  options: Partial<
    Pick<SetupOptions, "force" | "dryRun" | "convention" | "forcePush" | "commitOnProtected" | "path">
  > = {}
): Step[] {
  return setup({
    root,
    home,
    force: options.force ?? false,
    dryRun: options.dryRun ?? false,
    convention: options.convention,
    forcePush: options.forcePush,
    commitOnProtected: options.commitOnProtected,
    path: options.path ?? PATH_WITHOUT_CSWAP
  })
}

describe("setup", () => {
  it("writes the env deny rules the resolved guardrails.envFiles refuses", () => {
    const root = nodeRepo()
    write(root, ".env.test", "TEST=1\n")
    git(root, "add", ".env.test")
    writeJson(join(root, COMMITTED_FILE), {
      guardrails: { envFiles: { allow: [".env.development", "**/.env.example"], deny: [".env.test"] } }
    })
    run(root, scratch("home"))
    const deny = (json(join(root, ".claude/settings.local.json")).permissions as { deny: string[] }).deny
    const envRules = deny.filter((rule) => rule.includes(".env"))
    assert.deepEqual(envRules, ["Read(./.env.local)", "Edit(./.env.local)", "Read(./.env.test)", "Edit(./.env.test)"])
  })

  it("writes the default env rules, not the strictest set, while a config layer is invalid", () => {
    const root = nodeRepo()
    writeFile(join(root, COMMITTED_FILE), '{ "guardrails": { "envFiles": "git" } }')
    run(root, scratch("home"))
    const deny = (json(join(root, ".claude/settings.local.json")).permissions as { deny: string[] }).deny
    const envRules = deny.filter((rule) => rule.includes(".env"))
    assert.deepEqual(envRules, [
      "Read(./.env.development)",
      "Edit(./.env.development)",
      "Read(./.env.local)",
      "Edit(./.env.local)"
    ])
  })

  it("writes the four files for a Node repository, and a second run changes nothing", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const first = run(root, home)
    assert.deepEqual(outcomes(first), {
      [LOCAL_FILE]: "wrote",
      ".git/info/exclude": "wrote",
      ".claude/settings.local.json": "wrote",
      "~/.claude/settings.json": "wrote",
      "package.json": "unchanged",
      [COMMITTED_FILE]: "unchanged"
    })

    const local = json(join(root, LOCAL_FILE))
    assert.equal(local.commit, undefined, "no flag, so nothing about the convention")
    assert.deepEqual(local.packageManagers, { node: "pnpm" })
    // No marketplace registered in this home, so the $id: never the install cache, which moves with
    // every plugin version.
    assert.equal(local.$schema, schemaId())
    const resolved = resolveConfig(root)
    assert.deepEqual(resolved.problems, [])
    assert.equal(resolved.layers.local, "valid")

    const exclude = readFileSync(join(root, ".git/info/exclude"), "utf8")
    assert.match(exclude, /^\.ai\/agentic\.config\.local\.json$/m)
    assert.match(exclude, /^\.claude\/settings\.local\.json$/m)

    const settings = json(join(root, ".claude/settings.local.json"))
    const deny = (settings.permissions as { deny: string[] }).deny
    for (const rule of [
      "Bash(git push --force)",
      "Bash(rtk git push --force)",
      "Bash(git reset --hard *)",
      "Bash(rtk git reset --hard *)",
      "Bash(git branch -f *)",
      "Bash(rtk git stash drop)",
      "Bash(git worktree remove --force *)",
      "Bash(gh repo delete)",
      "Bash(gh repo delete *)",
      "Bash(rtk gh repo delete *)"
    ]) {
      assert.ok(deny.includes(rule), rule)
    }
    for (const rule of [
      "Read(./.env.development)",
      "Edit(./.env.development)",
      "Read(./.env.local)",
      "Edit(./.env.local)"
    ]) {
      assert.ok(deny.includes(rule), rule)
    }
    assert.ok(
      !deny.some((rule) => rule === "Read(./.env)" || rule === "Edit(./.env)"),
      "the tracked .env stays readable"
    )
    assert.ok(
      !deny.some((rule) => rule.includes("push --force *")),
      "no push prefix rule that could catch --force-with-lease"
    )
    assert.ok(
      !deny.some((rule) => rule.includes("branch -D")),
      "no forced branch delete rule, which would refuse a merged branch the guard lets through"
    )

    const user = json(join(home, ".claude/settings.json"))
    assert.deepEqual((user.autoMode as { allow: string[] }).allow, ["$defaults", LEASE_RULE])
    assert.deepEqual((user.permissions as { deny: string[] }).deny, GLOBAL_DENY)

    const snapshot = [LOCAL_FILE, ".git/info/exclude", ".claude/settings.local.json"].map((file) =>
      readFileSync(join(root, file), "utf8")
    )
    snapshot.push(readFileSync(join(home, ".claude/settings.json"), "utf8"))
    const second = run(root, home)
    assert.deepEqual(new Set(second.map((step) => step.outcome)), new Set(["unchanged"]))
    const again = [LOCAL_FILE, ".git/info/exclude", ".claude/settings.local.json"].map((file) =>
      readFileSync(join(root, file), "utf8")
    )
    again.push(readFileSync(join(home, ".claude/settings.json"), "utf8"))
    assert.deepEqual(again, snapshot)
  })

  it("points $schema at the marketplace clone's schema, which an editor can open", () => {
    const root = nodeRepo()
    const clone = scratch("clone")
    run(root, homeWithClone(clone))
    assert.equal(json(join(root, LOCAL_FILE)).$schema, pathToFileURL(join(clone, SCHEMA_FILE)).href)
  })

  it("falls back to the $id without a registered clone, the plugin in it, or the schema file", () => {
    assert.equal(schemaReference(join(scratch("home"), ".claude")), schemaId())
    const noPlugin = scratch("clone")
    const home = homeWithClone(noPlugin)
    writeJson(join(noPlugin, ".claude-plugin/marketplace.json"), { name: "dw-sdlc", plugins: [] })
    assert.equal(schemaReference(join(home, ".claude")), schemaId())
    assert.equal(schemaReference(join(homeWithClone(scratch("clone"), { schema: false }), ".claude")), schemaId())
  })

  it("rewrites a local file that differs only in $schema instead of refusing it", () => {
    const root = nodeRepo()
    run(root, scratch("home"))
    assert.equal(json(join(root, LOCAL_FILE)).$schema, schemaId())
    const clone = scratch("clone")
    const steps = run(root, homeWithClone(clone))
    assert.equal(outcomes(steps)[LOCAL_FILE], "wrote")
    assert.equal(json(join(root, LOCAL_FILE)).$schema, pathToFileURL(join(clone, SCHEMA_FILE)).href)
  })

  it("writes no local layer that would hold only $schema, and the dry run names the skip", () => {
    const root = nodeRepo()
    write(root, COMMITTED_FILE, JSON.stringify({ version: 1, gate: {}, packageManagers: { node: "pnpm" } }) + "\n")
    const home = scratch("home")
    const dry = run(root, home, { dryRun: true })
    const step = dry.find((item) => item.file === LOCAL_FILE)
    assert.equal(step?.outcome, "skipped")
    assert.match(step?.detail ?? "", /\$schema/)
    assert.equal(existsSync(join(root, LOCAL_FILE)), false)

    const bin = runBin(["setup", "--dry-run", "--home", home], root)
    assert.match(bin.stdout, /^skipped\s+\.ai\/agentic\.config\.local\.json — /m)

    const steps = run(root, home)
    assert.equal(outcomes(steps)[LOCAL_FILE], "skipped")
    assert.equal(existsSync(join(root, LOCAL_FILE)), false)
    assert.equal(resolveConfig(root).layers.local, "absent")
    assert.equal(
      outcomes(run(root, home, { force: true }))[LOCAL_FILE],
      "skipped",
      "--force writes no layer that holds only $schema either"
    )
  })

  it("still writes the layer for a pin flag, or where the committed config leaves packageManagers.node unset", () => {
    const committed = JSON.stringify({ version: 1, gate: {}, packageManagers: { node: "pnpm" } }) + "\n"
    for (const options of [
      { convention: "ticket-key" },
      { forcePush: "ask" },
      { commitOnProtected: "deny" }
    ] as const) {
      const root = nodeRepo()
      write(root, COMMITTED_FILE, committed)
      assert.equal(outcomes(run(root, scratch("home"), options))[LOCAL_FILE], "wrote", JSON.stringify(options))
      assert.equal(existsSync(join(root, LOCAL_FILE)), true)
    }
    const unset = nodeRepo()
    assert.equal(outcomes(run(unset, scratch("home")))[LOCAL_FILE], "wrote")
  })

  it("leaves an existing local layer as it is where the layer would hold only $schema", () => {
    const root = nodeRepo()
    write(root, COMMITTED_FILE, JSON.stringify({ version: 1, gate: {}, packageManagers: { node: "pnpm" } }) + "\n")
    write(root, LOCAL_FILE, JSON.stringify({ $schema: "https://example.test/old.json" }) + "\n")
    const before = readFileSync(join(root, LOCAL_FILE), "utf8")
    const steps = run(root, homeWithClone(scratch("clone")))
    assert.equal(outcomes(steps)[LOCAL_FILE], "skipped")
    assert.equal(readFileSync(join(root, LOCAL_FILE), "utf8"), before)
  })

  it("leaves out every key the committed config sets, so inference never outranks it", () => {
    const root = nodeRepo()
    write(root, COMMITTED_FILE, JSON.stringify({ commit: { convention: "ticket-key" } }) + "\n")
    run(root, scratch("home"))
    const local = json(join(root, LOCAL_FILE))
    assert.equal(local.commit, undefined)
    assert.deepEqual(local.packageManagers, { node: "pnpm" }, "a key the committed file leaves unset stays")
    const { config, problems } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.equal(config.commit.convention, "ticket-key")

    const pinned = nodeRepo()
    write(pinned, COMMITTED_FILE, JSON.stringify({ packageManagers: { node: "pnpm" } }) + "\n")
    run(pinned, scratch("home"))
    assert.equal(existsSync(join(pinned, LOCAL_FILE)), false, "nothing is left for the layer to hold")
  })

  it("pins the convention the flag names, over a committed one too; a re-run with the flag changes nothing", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const first = run(root, home, { convention: "ticket-key" })
    assert.equal(outcomes(first)[LOCAL_FILE], "wrote")
    const local = json(join(root, LOCAL_FILE))
    assert.deepEqual(local.commit, { convention: "ticket-key" })
    assert.deepEqual(local.packageManagers, { node: "pnpm" }, "the inferred keys stay beside it")
    const { config, problems } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.equal(config.commit.convention, "ticket-key")

    const text = readFileSync(join(root, LOCAL_FILE), "utf8")
    const again = run(root, home, { convention: "ticket-key" })
    assert.deepEqual(new Set(again.map((step) => step.outcome)), new Set(["unchanged"]))
    assert.equal(readFileSync(join(root, LOCAL_FILE), "utf8"), text)

    const explicit = nodeRepo()
    write(explicit, COMMITTED_FILE, JSON.stringify({ commit: { convention: "ticket-key" } }) + "\n")
    run(explicit, scratch("home"), { convention: "conventional" })
    assert.deepEqual(
      json(join(explicit, LOCAL_FILE)).commit,
      { convention: "conventional" },
      "the flag is explicit, so it is written even where the committed config sets one"
    )
  })

  it("without the flag a run keeps the pinned convention, --force included; the flag replaces it", () => {
    const root = nodeRepo()
    const home = scratch("home")
    run(root, home, { convention: "ticket-key" })
    const text = readFileSync(join(root, LOCAL_FILE), "utf8")
    const bare = run(root, home)
    assert.deepEqual(new Set(bare.map((step) => step.outcome)), new Set(["unchanged"]))
    assert.equal(readFileSync(join(root, LOCAL_FILE), "utf8"), text)

    const forced = run(root, home, { force: true })
    assert.equal(outcomes(forced)[LOCAL_FILE], "unchanged")
    assert.deepEqual(json(join(root, LOCAL_FILE)).commit, { convention: "ticket-key" }, "--force drops no pin")

    const replaced = run(root, home, { convention: "conventional" })
    assert.equal(outcomes(replaced)[LOCAL_FILE], "wrote")
    assert.deepEqual(json(join(root, LOCAL_FILE)).commit, { convention: "conventional" })
  })

  it("refuses to overwrite a differing local file without --force", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const byHand = { baseBranch: "develop", commit: { convention: "ticket-key" } }
    write(root, LOCAL_FILE, JSON.stringify(byHand) + "\n")
    const steps = run(root, home)
    assert.equal(outcomes(steps)[LOCAL_FILE], "refused")
    assert.deepEqual(json(join(root, LOCAL_FILE)), byHand)
    const forced = run(root, home, { force: true })
    assert.equal(outcomes(forced)[LOCAL_FILE], "wrote")
    const local = json(join(root, LOCAL_FILE))
    assert.equal(local.baseBranch, undefined, "the other content is gone")
    assert.deepEqual(local.commit, { convention: "ticket-key" }, "the pin is the setup's own content and stays")
  })

  it("keeps a guardrails block the local file holds on every run, --force included", () => {
    const root = nodeRepo()
    const home = scratch("home")
    run(root, home)
    const guardrails = { forcePush: "ask", commitOnProtected: "deny" }
    const byHand = { ...json(join(root, LOCAL_FILE)), guardrails }
    write(root, LOCAL_FILE, JSON.stringify(byHand, null, 2) + "\n")
    const text = readFileSync(join(root, LOCAL_FILE), "utf8")

    const again = run(root, home)
    assert.equal(outcomes(again)[LOCAL_FILE], "unchanged")
    const forced = run(root, home, { force: true })
    assert.equal(outcomes(forced)[LOCAL_FILE], "unchanged")
    assert.equal(readFileSync(join(root, LOCAL_FILE), "utf8"), text, "--force drops no guardrails block")
    const { config, problems } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.equal(config.guardrails.forcePush, "ask")
    assert.equal(config.guardrails.commitOnProtected, "deny")

    const bare = initRepo(scratch("setup"), { branch: "main" })
    write(bare, LOCAL_FILE, JSON.stringify({ $schema: schemaId(), guardrails: { forcePush: "ask" } }) + "\n")
    assert.notEqual(outcomes(run(bare, home))[LOCAL_FILE], "refused", "no lockfile, so nothing is inferred beside it")
    assert.deepEqual(json(join(bare, LOCAL_FILE)).guardrails, { forcePush: "ask" })
  })

  it("pins forcePush and commitOnProtected the flags name, keeps them on a run without the flags, and lets a flag replace one", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const pinned = run(root, home, { forcePush: "ask", commitOnProtected: "deny" })
    assert.equal(outcomes(pinned)[LOCAL_FILE], "wrote")
    assert.deepEqual(json(join(root, LOCAL_FILE)).guardrails, { forcePush: "ask", commitOnProtected: "deny" })
    const { config, problems } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.equal(config.guardrails.forcePush, "ask")
    assert.equal(config.guardrails.commitOnProtected, "deny")

    assert.equal(outcomes(run(root, home))[LOCAL_FILE], "unchanged", "a run without the flags keeps the pins")
    assert.equal(outcomes(run(root, home, { forcePush: "deny" }))[LOCAL_FILE], "wrote", "a flag replaces its own key")
    assert.deepEqual(json(join(root, LOCAL_FILE)).guardrails, { forcePush: "deny", commitOnProtected: "deny" })
  })

  it("refuses a pin that loosens the committed value and leaves the local file alone", () => {
    const root = nodeRepo()
    const home = scratch("home")
    write(
      root,
      ".ai/agentic.config.json",
      JSON.stringify({ guardrails: { forcePush: "ask", commitOnProtected: "deny" } }) + "\n"
    )
    run(root, home)
    const text = readFileSync(join(root, LOCAL_FILE), "utf8")
    for (const options of [{ forcePush: "lease" as const }, { commitOnProtected: "allow" as const }]) {
      const steps = run(root, home, options)
      const step = steps.find((item) => item.file === LOCAL_FILE)
      assert.equal(step?.outcome, "refused")
      assert.match(step?.detail ?? "", /loosens/)
      assert.equal(readFileSync(join(root, LOCAL_FILE), "utf8"), text)
    }
    assert.equal(outcomes(run(root, home, { forcePush: "deny" }))[LOCAL_FILE], "wrote", "a tighter pin passes")
    assert.equal(outcomes(run(root, home, { commitOnProtected: "deny" }))[LOCAL_FILE], "wrote", "an equal pin passes")
  })

  it("still refuses a local file that holds another key beside its guardrails block", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const byHand = { guardrails: { forcePush: "ask" }, baseBranch: "develop" }
    write(root, LOCAL_FILE, JSON.stringify(byHand) + "\n")
    assert.equal(outcomes(run(root, home))[LOCAL_FILE], "refused")
    assert.deepEqual(json(join(root, LOCAL_FILE)), byHand)
    assert.equal(outcomes(run(root, home, { force: true }))[LOCAL_FILE], "wrote")
    const local = json(join(root, LOCAL_FILE))
    assert.equal(local.baseBranch, undefined, "the other content is gone")
    assert.deepEqual(local.guardrails, { forcePush: "ask" }, "the guardrails block stays")
  })

  it("keeps what the settings files already hold and appends to it", () => {
    const root = nodeRepo()
    const home = scratch("home")
    write(
      home,
      ".claude/settings.json",
      JSON.stringify({
        permissions: { defaultMode: "auto", deny: ["Bash(custom *)"] },
        autoMode: { environment: ["Organization: Acme"], allow: ["my own rule"] },
        enabledPlugins: { "x@y": true }
      })
    )
    write(
      root,
      ".claude/settings.local.json",
      JSON.stringify({ permissions: { allow: ["Bash(gh pr *)"], deny: ["Read(./secret)"] } })
    )
    run(root, home)
    const user = json(join(home, ".claude/settings.json"))
    assert.deepEqual(
      (user.autoMode as { allow: string[] }).allow,
      ["my own rule", LEASE_RULE],
      "no $defaults injected into a list the user wrote without it"
    )
    assert.deepEqual((user.autoMode as { environment: string[] }).environment, ["Organization: Acme"])
    assert.deepEqual((user.permissions as { deny: string[] }).deny, ["Bash(custom *)", ...GLOBAL_DENY])
    assert.equal((user.permissions as { defaultMode: string }).defaultMode, "auto")
    assert.deepEqual(user.enabledPlugins, { "x@y": true })
    const local = json(join(root, ".claude/settings.local.json"))
    assert.deepEqual((local.permissions as { allow: string[] }).allow, ["Bash(gh pr *)"])
    assert.equal((local.permissions as { deny: string[] }).deny[0], "Read(./secret)")
  })

  it("removes the forced branch delete rules from the local settings and keeps every other entry", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const deny = ["Read(./secret)", "Bash(git branch -D *)", "Bash(git branch -D main)", "Bash(rtk git branch -D *)"]
    write(root, ".claude/settings.local.json", JSON.stringify({ permissions: { allow: ["Bash(gh pr *)"], deny } }))
    assert.equal(outcomes(run(root, home))[".claude/settings.local.json"], "wrote")
    const local = json(join(root, ".claude/settings.local.json"))
    const kept = (local.permissions as { deny: string[] }).deny
    assert.ok(!kept.includes("Bash(git branch -D *)"))
    assert.ok(!kept.includes("Bash(rtk git branch -D *)"))
    assert.deepEqual(
      kept.slice(0, 2),
      ["Read(./secret)", "Bash(git branch -D main)"],
      "a rule the setup never writes stays"
    )
    assert.deepEqual((local.permissions as { allow: string[] }).allow, ["Bash(gh pr *)"])
    assert.equal(outcomes(run(root, home))[".claude/settings.local.json"], "unchanged")
  })

  it("refuses a settings file that is not JSON and leaves it alone", () => {
    const root = nodeRepo()
    const home = scratch("home")
    write(home, ".claude/settings.json", "{ not json")
    const steps = run(root, home)
    assert.equal(outcomes(steps)["~/.claude/settings.json"], "refused")
    assert.equal(readFileSync(join(home, ".claude/settings.json"), "utf8"), "{ not json")
  })

  it("a dry run reports and writes nothing", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const steps = run(root, home, { dryRun: true })
    assert.deepEqual(outcomes(steps), {
      [LOCAL_FILE]: "wrote",
      ".git/info/exclude": "wrote",
      ".claude/settings.local.json": "wrote",
      "~/.claude/settings.json": "wrote",
      "package.json": "unchanged",
      [COMMITTED_FILE]: "unchanged"
    })
    assert.ok(!existsSync(join(root, LOCAL_FILE)))
    assert.ok(!existsSync(join(root, ".claude/settings.local.json")))
    assert.ok(!existsSync(join(home, ".claude/settings.json")))
  })

  it("from a linked worktree every file goes to the main checkout, which each worktree reads", () => {
    const root = nodeRepo()
    const home = scratch("home")
    git(root, "worktree", "add", "-q", join(root, ".claude/worktrees/wt"), "-b", "wt")
    const worktree = join(root, ".claude/worktrees/wt")
    const steps = run(worktree, home, { convention: "ticket-key" })
    assert.equal(outcomes(steps)[LOCAL_FILE], "wrote")
    assert.ok(existsSync(join(root, LOCAL_FILE)), "one local layer for the repository, in the main checkout")
    assert.ok(!existsSync(join(worktree, LOCAL_FILE)), "a worktree's own layer would override the main checkout's")
    assert.equal(resolveConfig(worktree).config.commit.convention, "ticket-key")
    assert.match(readFileSync(join(root, ".git/info/exclude"), "utf8"), /agentic\.config\.local\.json/)
    assert.ok(
      existsSync(join(root, ".claude/settings.local.json")),
      "Claude Code reads the main checkout's local settings"
    )
    assert.ok(!existsSync(join(worktree, ".claude/settings.local.json")))
  })
})

describe("the worker command", () => {
  const COMMAND = "cswap run -- --dangerously-skip-permissions"

  it("writes worker.command into the local layer when cswap is on PATH, and a second run changes nothing", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const path = withCswap()
    assert.equal(outcomes(run(root, home, { path }))[LOCAL_FILE], "wrote")
    assert.deepEqual(json(join(root, LOCAL_FILE)).worker, { command: COMMAND })
    const resolved = resolveConfig(root)
    assert.deepEqual(resolved.problems, [])
    assert.deepEqual(resolved.config.worker, { command: COMMAND, model: "sonnet", effort: "high" })
    const text = read(root, LOCAL_FILE)
    assert.equal(outcomes(run(root, home, { path }))[LOCAL_FILE], "unchanged")
    assert.equal(read(root, LOCAL_FILE), text)
  })

  it("writes no worker key without cswap, and a run later with it adds the key to the file", () => {
    const root = nodeRepo()
    const home = scratch("home")
    run(root, home)
    assert.equal(json(join(root, LOCAL_FILE)).worker, undefined)
    assert.equal(resolveConfig(root).config.worker.command, "claude")
    assert.equal(outcomes(run(root, home, { path: withCswap() }))[LOCAL_FILE], "wrote")
    assert.deepEqual(json(join(root, LOCAL_FILE)).worker, { command: COMMAND })
  })

  it("leaves a command the file holds alone, --force included, and keeps the other worker keys", () => {
    const root = nodeRepo()
    const home = scratch("home")
    run(root, home)
    const byHand = { ...json(join(root, LOCAL_FILE)), worker: { command: "claude --verbose", model: "opus" } }
    write(root, LOCAL_FILE, JSON.stringify(byHand, null, 2) + "\n")
    const text = read(root, LOCAL_FILE)
    const path = withCswap()
    assert.equal(outcomes(run(root, home, { path }))[LOCAL_FILE], "unchanged")
    assert.equal(outcomes(run(root, home, { path, force: true }))[LOCAL_FILE], "unchanged")
    assert.equal(read(root, LOCAL_FILE), text)
    assert.deepEqual(resolveConfig(root).config.worker, { command: "claude --verbose", model: "opus", effort: "high" })
  })

  it("adds the command beside a worker block that holds none", () => {
    const root = nodeRepo()
    const home = scratch("home")
    run(root, home)
    const byHand = { ...json(join(root, LOCAL_FILE)), worker: { model: "opus" } }
    write(root, LOCAL_FILE, JSON.stringify(byHand, null, 2) + "\n")
    assert.equal(outcomes(run(root, home, { path: withCswap() }))[LOCAL_FILE], "wrote")
    assert.deepEqual(json(join(root, LOCAL_FILE)).worker, { model: "opus", command: COMMAND })
    assert.equal(outcomes(run(root, home, { path: PATH_WITHOUT_CSWAP }))[LOCAL_FILE], "unchanged")
  })

  it("refuses a worker value that is not an object, as any other content the setup does not own", () => {
    const root = nodeRepo()
    const home = scratch("home")
    run(root, home)
    write(root, LOCAL_FILE, JSON.stringify({ ...json(join(root, LOCAL_FILE)), worker: "cswap" }) + "\n")
    assert.equal(outcomes(run(root, home, { path: withCswap() }))[LOCAL_FILE], "refused")
  })

  it("the command finds cswap on its own PATH; a dry run shows the write and makes none", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const dry = runBin(["setup", "--root", root, "--home", home, "--dry-run"], REPO_ROOT, { PATH: withCswap() })
    assert.equal(dry.status, 0, dry.stderr)
    assert.match(
      dry.stdout,
      /^would write \.ai\/agentic\.config\.local\.json — worker\.command: cswap run -- --dangerously-skip-permissions$/m
    )
    assert.ok(!existsSync(join(root, LOCAL_FILE)))

    const wrote = runBin(["setup", "--root", root, "--home", home], REPO_ROOT, { PATH: withCswap() })
    assert.equal(wrote.status, 0, wrote.stderr)
    assert.deepEqual(json(join(root, LOCAL_FILE)).worker, { command: COMMAND })

    const without = nodeRepo()
    assert.equal(runBin(["setup", "--root", without, "--home", home], REPO_ROOT).status, 0)
    assert.equal(json(join(without, LOCAL_FILE)).worker, undefined)
  })
})

describe("Claude's config dir", () => {
  it("takes the user settings and the marketplace clone from the dir it is given", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const clone = scratch("clone")
    const claudeDir = join(homeWithClone(clone), ".claude")
    const steps = setup({ root, home, claudeDir, force: false, dryRun: false })
    assert.equal(outcomes(steps)[join(claudeDir, "settings.json")], "wrote")
    assert.ok(existsSync(join(claudeDir, "settings.json")))
    assert.ok(!existsSync(join(home, ".claude/settings.json")))
    assert.equal(json(join(root, LOCAL_FILE)).$schema, pathToFileURL(join(clone, SCHEMA_FILE)).href)
  })

  it("is $CLAUDE_CONFIG_DIR for the command", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const claudeDir = scratch("cfg")
    const verdict = runBin(["setup", "--root", root], REPO_ROOT, { HOME: home, CLAUDE_CONFIG_DIR: claudeDir })
    assert.equal(verdict.status, 0, verdict.stderr)
    assert.ok(existsSync(join(claudeDir, "settings.json")))
    assert.ok(!existsSync(join(home, ".claude/settings.json")))
  })
})

describe("the guardrails:setup command", () => {
  it("a dry run says would write and leaves the files alone; a refusal exits 1", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const dry = runBin(["setup", "--root", root, "--home", home, "--dry-run"], REPO_ROOT)
    assert.equal(dry.status, 0, dry.stderr)
    assert.match(dry.stdout, /^would write \.ai\/agentic\.config\.local\.json$/m)
    assert.ok(!existsSync(join(root, LOCAL_FILE)))

    write(root, LOCAL_FILE, JSON.stringify({ baseBranch: "develop" }) + "\n")
    const refused = runBin(["setup", "--root", root, "--home", home], REPO_ROOT)
    assert.equal(refused.status, 1)
    assert.match(refused.stdout, /^refused {5}\.ai\/agentic\.config\.local\.json — exists with other content/m)
  })

  it("--convention pins the named preset; a value off the enum is a usage error", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const pinned = runBin(["setup", "--root", root, "--home", home, "--convention", "ticket-key"], REPO_ROOT)
    assert.equal(pinned.status, 0, pinned.stderr)
    assert.deepEqual(json(join(root, LOCAL_FILE)).commit, { convention: "ticket-key" })

    const off = runBin(["setup", "--root", root, "--home", home, "--convention", "jira"], REPO_ROOT)
    assert.equal(off.status, 2)
    assert.match(off.stderr, /--convention.*ticket-key.*conventional/)
    assert.match(off.stderr, /^Usage:/m)
  })

  it("--force-push and --commit-on-protected pin their values; a value off the enum is a usage error", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const args = ["--root", root, "--home", home]
    const pinned = runBin(["setup", ...args, "--force-push", "ask", "--commit-on-protected", "deny"], REPO_ROOT)
    assert.equal(pinned.status, 0, pinned.stderr)
    assert.deepEqual(json(join(root, LOCAL_FILE)).guardrails, { forcePush: "ask", commitOnProtected: "deny" })

    for (const [flag, value] of [
      ["--force-push", "always"],
      ["--commit-on-protected", "ask"]
    ]) {
      const off = runBin(["setup", ...args, flag ?? "", value ?? ""], REPO_ROOT)
      assert.equal(off.status, 2)
      assert.match(off.stderr, new RegExp(`${flag} must be`))
    }
  })
})

function setupBin(root: string, home: string, ...flags: string[]): Run {
  return runBin(["setup", "--root", root, "--home", home, ...flags], REPO_ROOT)
}

function read(root: string, file: string): string {
  return readFileSync(join(root, file), "utf8")
}

describe("adopting the Gate", () => {
  const MANIFEST = {
    name: "app",
    scripts: { check: "dw-sdlc gate" },
    devDependencies: { "@types/node": "24.0.0", typescript: "5.9.3" }
  }
  /** The Checks a new gate key names, in the order the package ships them. */
  const DEFAULT_CHECKS = [
    ["primitives", false],
    ["agents-map", true],
    ["routed-docs", false],
    ["markdown-budget", false],
    ["markdown-refs", true],
    ["temporal-language", true],
    ["decision-records", false],
    ["file-size-ratchet", false],
    ["comment-budget", true]
  ]
  const PINNED = `wrote       package.json — pins dw-sdlc ${VERSION} as a devDependency; pnpm install brings it in`
  const GATE_KEY =
    "the gate key, agents-map, markdown-refs, temporal-language and comment-budget on and the other Checks off"

  /** A pnpm repository whose package.json lacks dw-sdlc, with `files` beside it, all committed. */
  function withoutGate(files: Record<string, string> = {}): string {
    const root = initRepo(scratch("adopt"), { branch: "main" })
    write(root, "package.json", JSON.stringify(MANIFEST, null, 2) + "\n")
    write(root, "pnpm-lock.yaml", "")
    for (const [file, text] of Object.entries(files)) {
      write(root, file, text)
    }
    git(root, "add", "package.json", "pnpm-lock.yaml", ...Object.keys(files))
    commit(root, "-m", "init")
    return root
  }

  it("pins the package and adds the gate key to a repository with neither, and a second run writes nothing", () => {
    const config = '{\n  "version": 1,\n  "commit": { "convention": "ticket-key" }\n}\n'
    const root = withoutGate({ [COMMITTED_FILE]: config })
    const home = scratch("home")
    const first = setupBin(root, home, "--add-package")
    assert.equal(first.status, 0, first.stdout)
    assert.ok(lines(first.stdout).includes(PINNED), first.stdout)
    assert.ok(lines(first.stdout).includes(`wrote       ${COMMITTED_FILE} — ${GATE_KEY}`), first.stdout)

    const devDependencies = { "@types/node": "24.0.0", "dw-sdlc": VERSION, typescript: "5.9.3" }
    assert.equal(read(root, "package.json"), JSON.stringify({ ...MANIFEST, devDependencies }, null, 2) + "\n")
    const written = read(root, COMMITTED_FILE)
    assert.ok(written.startsWith(config.slice(0, -3) + ',\n  "gate": {\n'), "the config keeps its layout")
    assert.deepEqual(Object.entries(JSON.parse(written).gate.checks), DEFAULT_CHECKS)
    const { config: resolved, problems } = resolveConfig(root)
    assert.deepEqual(problems, [])
    assert.equal(resolved.commit.convention, "ticket-key")

    const snapshot = [read(root, "package.json"), written]
    const second = setupBin(root, home)
    assert.equal(second.status, 0, second.stdout)
    assert.deepEqual(
      lines(second.stdout).filter((line) => !line.startsWith("unchanged")),
      [],
      "the pin is there, so no flag is needed"
    )
    assert.deepEqual([read(root, "package.json"), read(root, COMMITTED_FILE)], snapshot)
  })

  it("creates the committed config where there is none, and a dry run shows both writes and makes neither", () => {
    const root = withoutGate()
    const home = scratch("home")
    const manifest = read(root, "package.json")
    const dry = setupBin(root, home, "--add-package", "--dry-run")
    assert.equal(dry.status, 0, dry.stdout)
    assert.ok(lines(dry.stdout).includes(PINNED.replace("wrote      ", "would write")), dry.stdout)
    assert.ok(lines(dry.stdout).includes(`would write ${COMMITTED_FILE} — ${GATE_KEY}`), dry.stdout)
    assert.equal(read(root, "package.json"), manifest)
    assert.ok(!existsSync(join(root, COMMITTED_FILE)))

    assert.equal(setupBin(root, home, "--add-package").status, 0)
    assert.deepEqual(json(join(root, COMMITTED_FILE)), {
      $schema: "../node_modules/dw-sdlc/config/agentic.config.schema.json",
      version: 1,
      gate: { checks: Object.fromEntries(DEFAULT_CHECKS) }
    })
    assert.deepEqual(resolveConfig(root).problems, [])
  })

  it("without --add-package refuses the package, naming the version it would pin, and adds no gate key", () => {
    const root = withoutGate()
    const manifest = read(root, "package.json")
    const result = setupBin(root, scratch("home"))
    assert.equal(result.status, 1)
    assert.ok(
      lines(result.stdout).includes(
        `refused     package.json — no dw-sdlc devDependency, and a new one needs your yes: --add-package pins dw-sdlc ${VERSION}`
      ),
      result.stdout
    )
    assert.ok(!result.stdout.includes(COMMITTED_FILE), "the gate key waits for the package that runs it")
    assert.equal(read(root, "package.json"), manifest)
    assert.ok(!existsSync(join(root, COMMITTED_FILE)))
  })

  it("leaves a gate key the config holds and a pin the manifest holds as they are", () => {
    const config = '{ "gate": { "checks": { "agents-map": false } } }\n'
    const root = withoutGate({ [COMMITTED_FILE]: config })
    const manifest = JSON.stringify({ devDependencies: { "dw-sdlc": "workspace:*" } }) + "\n"
    write(root, "package.json", manifest)
    const result = setupBin(root, scratch("home"), "--add-package")
    assert.equal(result.status, 0, result.stdout)
    assert.ok(lines(result.stdout).includes("unchanged   package.json"), result.stdout)
    assert.ok(lines(result.stdout).includes(`unchanged   ${COMMITTED_FILE}`), result.stdout)
    assert.equal(read(root, "package.json"), manifest)
    assert.equal(read(root, COMMITTED_FILE), config)
  })

  it("leaves a gate key whose Steps are objects as it is, and refuses no layer", () => {
    const gate = { steps: [{ command: "pnpm lint", hint: "run pnpm fix" }, "pnpm test"] }
    const config = `${JSON.stringify({ version: 1, gate })}\n`
    const root = withoutGate({ [COMMITTED_FILE]: config })
    const result = setupBin(root, scratch("home"), "--add-package")
    assert.equal(result.status, 0, result.stdout)
    assert.ok(lines(result.stdout).includes(`unchanged   ${COMMITTED_FILE}`), result.stdout)
    assert.equal(read(root, COMMITTED_FILE), config)
  })

  it("refuses a committed config or a manifest that is not a JSON object with exit 1, and leaves it untouched", () => {
    for (const text of ["[]\n", "{ not json"]) {
      const root = withoutGate({ [COMMITTED_FILE]: text })
      const result = setupBin(root, scratch("home"), "--add-package")
      assert.equal(result.status, 1, result.stdout)
      assert.ok(
        lines(result.stdout).includes(`refused     ${COMMITTED_FILE} — is not a JSON object; fix it by hand first`),
        result.stdout
      )
      assert.equal(read(root, COMMITTED_FILE), text)
    }
    const root = withoutGate()
    write(root, "package.json", "[]\n")
    const result = setupBin(root, scratch("home"), "--add-package")
    assert.equal(result.status, 1)
    assert.ok(lines(result.stdout).includes("refused     package.json — is not a JSON object; fix it by hand first"))
    assert.equal(read(root, "package.json"), "[]\n")
    assert.ok(!existsSync(join(root, COMMITTED_FILE)))
  })

  it("never writes the agent map, and the next Gate run names what the map lacks", () => {
    const map = "# app\n\nRead the code before you change it.\n"
    const root = withoutGate({ "AGENTS.md": map })
    assert.equal(setupBin(root, scratch("home"), "--add-package").status, 0)
    assert.equal(read(root, "AGENTS.md"), map)
    const gate = runBin(["gate", "--root", root], REPO_ROOT)
    assert.equal(gate.status, 1, gate.stdout)
    assert.deepEqual(lines(gate.stdout).slice(-3), [
      'AGENTS.md: agents-map: does not name the Gate command "pnpm check" — name it where the map lists the commands',
      "CLAUDE.md: agents-map: does not exist — link it to the map: ln -s AGENTS.md CLAUDE.md",
      "gate: failed — 2 failures"
    ])

    const bare = withoutGate()
    assert.equal(setupBin(bare, scratch("home"), "--add-package").status, 0)
    assert.ok(!existsSync(join(bare, "AGENTS.md")))
    const missing = runBin(["gate", "--root", bare], REPO_ROOT)
    assert.equal(missing.status, 2, missing.stdout)
    assert.deepEqual(lines(missing.stdout).slice(-2), [
      "AGENTS.md: agents-map: the map does not exist — write it, or point gate.checks.agents-map.file at the map",
      "gate: cannot run — 1 failure"
    ])
  })

  it("from a linked worktree the package and the gate key go to the worktree, on its branch", () => {
    const root = withoutGate()
    const manifest = read(root, "package.json")
    const worktree = join(root, ".claude/worktrees/wt")
    git(root, "worktree", "add", "-q", worktree, "-b", "wt")
    assert.equal(setupBin(worktree, scratch("home"), "--add-package").status, 0)
    assert.equal(JSON.parse(read(worktree, "package.json")).devDependencies["dw-sdlc"], VERSION)
    assert.ok(existsSync(join(worktree, COMMITTED_FILE)))
    assert.equal(read(root, "package.json"), manifest, "the main checkout's branch is not the one being set up")
    assert.ok(!existsSync(join(root, COMMITTED_FILE)))
  })

  it("a repository without a package.json gets neither step", () => {
    const root = initRepo(scratch("setup"), { branch: "main" })
    const result = setupBin(root, scratch("home"))
    assert.equal(result.status, 0, result.stdout)
    assert.ok(!/package\.json|agentic\.config\.json/.test(result.stdout), result.stdout)
    assert.ok(!existsSync(join(root, COMMITTED_FILE)))
  })

  it("names the enabledPlugins edit settings on the retired plugins need, and leaves the settings to the user", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const settings = join(home, ".claude/settings.json")
    const retired = { "guardrails@dw-sdlc": true, "references@dw-sdlc": true, "x@y": true }
    writeJson(settings, { enabledPlugins: retired })
    const both = setupBin(root, home)
    assert.equal(both.status, 0, both.stdout)
    assert.ok(
      lines(both.stdout).includes(
        'by hand     ~/.claude/settings.json — enabledPlugins: remove "guardrails@dw-sdlc" and "references@dw-sdlc", which the marketplace does not list, and add "sdlc@dw-sdlc": true after claude plugin install sdlc@dw-sdlc --scope user'
      ),
      both.stdout
    )
    assert.deepEqual(json(settings).enabledPlugins, retired)

    writeJson(settings, {
      enabledPlugins: { "guardrails@dw-sdlc": false, "references@dw-sdlc": true, "sdlc@dw-sdlc": true }
    })
    const one = setupBin(root, home)
    assert.equal(one.status, 0, one.stdout)
    assert.deepEqual(
      lines(one.stdout).filter((line) => line.startsWith("by hand")),
      [
        'by hand     ~/.claude/settings.json — enabledPlugins: remove "references@dw-sdlc", which the marketplace does not list'
      ]
    )

    writeJson(settings, { enabledPlugins: { "sdlc@dw-sdlc": true } })
    const none = setupBin(root, home)
    assert.deepEqual(
      lines(none.stdout).filter((line) => line.startsWith("by hand")),
      []
    )
  })
})
