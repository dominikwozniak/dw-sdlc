import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { pathToFileURL } from "node:url"

import {
  COMMITTED_FILE,
  type CommitConvention,
  LOCAL_FILE,
  resolveConfig,
  schemaId
} from "../../scripts/agentic-config.ts"
import { GLOBAL_DENY, LEASE_RULE, type Step, schemaReference, setup } from "../../scripts/guardrails-setup.ts"
import { commit, git, initRepo, runScript, scratch, write as writeFile, writeJson } from "../harness.ts"

function write(root: string, file: string, text: string): void {
  writeFile(join(root, file), text)
}

/** A pnpm repository with a tracked .env, an ignored .env.development and one commit. */
function nodeRepo(): string {
  const root = initRepo(scratch("setup"), { branch: "main", remote: "git@github.com:acme/app.git" })
  write(root, "package.json", "{}\n")
  write(root, "pnpm-lock.yaml", "")
  write(root, ".gitignore", ".env.development\n*.local\n")
  write(root, ".env", "SAFE=1\n")
  write(root, ".env.development", "SECRET=1\n")
  write(root, ".env.local", "SECRET=2\n")
  git(root, "add", "package.json", "pnpm-lock.yaml", ".gitignore", ".env")
  commit(root, "-m", "init")
  return root
}

const SCHEMA_FILE = "plugins/guardrails/config/agentic.config.schema.json"

/** A home where Claude Code registers the dw-sdlc marketplace at `clone`, holding the schema. */
function homeWithClone(clone: string, options: { schema?: boolean } = {}): string {
  const home = scratch("home")
  writeJson(join(home, ".claude/plugins/known_marketplaces.json"), {
    "dw-sdlc": { source: { source: "github", repo: "dominikwozniak/dw-sdlc" }, installLocation: clone }
  })
  writeJson(join(clone, ".claude-plugin/marketplace.json"), {
    name: "dw-sdlc",
    plugins: [{ name: "guardrails", source: "./plugins/guardrails" }]
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
  options: { force?: boolean; dryRun?: boolean; convention?: CommitConvention } = {}
): Step[] {
  return setup({
    root,
    home,
    force: options.force ?? false,
    dryRun: options.dryRun ?? false,
    convention: options.convention
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
      "~/.claude/settings.json": "wrote"
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
      "Bash(rtk git reset --hard *)"
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
    assert.equal(json(join(pinned, LOCAL_FILE)).packageManagers, undefined)
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
    assert.deepEqual(new Set(steps.map((step) => step.outcome)), new Set(["wrote"]))
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
    const verdict = runScript("guardrails-setup", ["--root", root], {
      env: { HOME: home, CLAUDE_CONFIG_DIR: claudeDir }
    })
    assert.equal(verdict.status, 0, verdict.stderr)
    assert.ok(existsSync(join(claudeDir, "settings.json")))
    assert.ok(!existsSync(join(home, ".claude/settings.json")))
  })
})

describe("the guardrails:setup command", () => {
  it("a dry run says would write and leaves the files alone; a refusal exits 1", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const dry = runScript("guardrails-setup", ["--root", root, "--home", home, "--dry-run"])
    assert.equal(dry.status, 0, dry.stderr)
    assert.match(dry.stdout, /^would write \.ai\/agentic\.config\.local\.json$/m)
    assert.ok(!existsSync(join(root, LOCAL_FILE)))

    write(root, LOCAL_FILE, JSON.stringify({ baseBranch: "develop" }) + "\n")
    const refused = runScript("guardrails-setup", ["--root", root, "--home", home])
    assert.equal(refused.status, 1)
    assert.match(refused.stdout, /^refused {5}\.ai\/agentic\.config\.local\.json — exists with other content/m)
  })

  it("--convention pins the named preset; a value off the enum is a usage error", () => {
    const root = nodeRepo()
    const home = scratch("home")
    const pinned = runScript("guardrails-setup", ["--root", root, "--home", home, "--convention", "ticket-key"])
    assert.equal(pinned.status, 0, pinned.stderr)
    assert.deepEqual(json(join(root, LOCAL_FILE)).commit, { convention: "ticket-key" })

    const off = runScript("guardrails-setup", ["--root", root, "--home", home, "--convention", "jira"])
    assert.equal(off.status, 2)
    assert.match(off.stderr, /--convention.*ticket-key.*conventional/)
    assert.match(off.stderr, /^Usage:/m)
  })
})
