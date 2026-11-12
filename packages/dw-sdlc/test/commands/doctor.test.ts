import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import {
  type Check,
  type Probe,
  claudeConfigDir,
  diagnose,
  render,
  rtkConfigPath,
  rtkExcludes
} from "../../src/commands/doctor.ts"
import { initRepo, REPO_ROOT, runBin, scratch, write, writeJson } from "../harness.ts"

type Fake = {
  /** Keyed by the command line; `in <dir>: <command>` answers only a call made from that directory. */
  commands?: Record<string, { status?: number; stdout?: string }>
  files?: Record<string, string>
  shell?: Record<string, string>
}

/** A probe answering from canned data: a command not listed fails, a file not listed is absent. */
function fake(data: Fake): Probe {
  return {
    run(command, args, cwd) {
      const key = [command, ...args].join(" ")
      const canned = (cwd === undefined ? undefined : data.commands?.[`in ${cwd}: ${key}`]) ?? data.commands?.[key]
      if (canned === undefined) {
        return { status: 127, stdout: "" }
      }
      return { status: canned.status ?? 0, stdout: canned.stdout ?? "" }
    },
    read(path) {
      return data.files?.[path]
    },
    shell(script) {
      return data.shell?.[script] ?? ""
    }
  }
}

const HOME = "/home/t"
const ROOT = "/repo"
/** Resolved the way the doctor resolves it, so the fake machine keeps the file where this runner looks. */
const RTK_CONFIG = rtkConfigPath(HOME)
/** The key for a command the doctor has to run from the home directory. */
const atHome = (command: string): string => `in ${HOME}: ${command}`

const SDLC_ENTRY = { id: "sdlc@dw-sdlc", version: "0.1.0", enabled: true, installPath: "/cache/sdlc/0.1.0" }
const SESSIONS_ENTRY = {
  id: "sdlc-sessions@dw-sdlc",
  version: "0.3.0",
  scope: "user",
  enabled: true,
  installPath: "/cache/sdlc-sessions/0.3.0"
}
const SESSIONS_COPY = "/src/dw-sdlc/plugins/sdlc-sessions/dw-sdlc/package.json"

const HEALTHY: Fake = {
  commands: {
    "jq --version": { stdout: "jq-1.8.2\n" },
    "claude plugin list --json": {
      stdout: JSON.stringify([
        {
          id: "sdlc@dw-sdlc",
          version: "0.1.0",
          scope: "user",
          enabled: true,
          installPath: "/cache/sdlc/0.1.0"
        },
        SESSIONS_ENTRY
      ])
    },
    [atHome("pnpm config get minimumReleaseAge")]: { stdout: "10080\n" },
    "git config --global commit.gpgsign": { stdout: "true\n" },
    "rtk --version": { stdout: "rtk 0.45.0\n" }
  },
  files: {
    [`${HOME}/.claude/settings.json`]: "{}",
    "/src/dw-sdlc/plugins/sdlc/hooks/rtk-rewrite.sh": "#!/bin/bash\n",
    "/src/dw-sdlc/plugins/sdlc/dw-sdlc/package.json": JSON.stringify({ name: "dw-sdlc", version: "0.2.0" }),
    [SESSIONS_COPY]: JSON.stringify({ name: "dw-sdlc", version: "0.2.0" }),
    [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { "dw-sdlc": "0.2.0" } }),
    [`${HOME}/.claude/plugins/known_marketplaces.json`]: JSON.stringify({
      "dw-sdlc": { source: { source: "directory", path: "/src/dw-sdlc" }, installLocation: "/src/dw-sdlc" }
    }),
    [RTK_CONFIG]: '[hooks]\nexclude_commands = ["find"]\ntransparent_prefixes = []\n'
  },
  shell: {
    "command -v rtk": "/opt/homebrew/bin/rtk",
    "command -v safe-chain": "/home/t/.safe-chain/bin/safe-chain",
    "command -v npm": "/home/t/.safe-chain/shims/npm",
    "command -v pnpm": "/usr/bin/pnpm",
    "command -v hc": "/home/t/.local/bin/hc"
  }
}

function withCommand(base: Fake, key: string, value: { status?: number; stdout?: string } | undefined): Fake {
  const commands = { ...base.commands }
  if (value === undefined) {
    delete commands[key]
  } else {
    commands[key] = value
  }
  return { ...base, commands }
}
function withFile(base: Fake, key: string, value: string | undefined): Fake {
  const files = { ...base.files }
  if (value === undefined) {
    delete files[key]
  } else {
    files[key] = value
  }
  return { ...base, files }
}
function withShell(base: Fake, key: string, value: string): Fake {
  return { ...base, shell: { ...base.shell, [key]: value } }
}

function line(checks: Check[], name: string): Check {
  const check = checks.find((entry) => entry.name === name)
  assert.notEqual(check, undefined, `no check named ${name}`)
  return check as Check
}

const CONFIG = { config: { commit: { convention: "ticket-key" } }, problems: [] as string[] }

function sessions(machine: Fake): Check {
  return line(diagnose({ root: ROOT, home: HOME, probe: fake(machine), config: CONFIG }), "sessions")
}

function listing(...entries: object[]): Fake {
  return withCommand(HEALTHY, "claude plugin list --json", { stdout: JSON.stringify(entries) })
}

function hc(machine: Fake): Check {
  return line(diagnose({ root: ROOT, home: HOME, probe: fake(machine), config: CONFIG }), "hc")
}

function withoutHc(machine: Fake): Fake {
  return withShell(machine, "command -v hc", "")
}

function rtkLine(machine: Fake): Check {
  return line(diagnose({ root: ROOT, home: HOME, probe: fake(machine), config: CONFIG }), "rtk")
}

describe("diagnose", () => {
  it("passes every check on a healthy machine", () => {
    const checks = diagnose({ root: ROOT, home: HOME, probe: fake(HEALTHY), config: CONFIG })
    assert.deepEqual(
      checks.map((check) => check.name),
      ["jq", "plugin", "package", "sessions", "hc", "rtk", "safe chain", "pnpm release age", "commit signing", "config"]
    )
    assert.deepEqual(new Set(checks.map((check) => check.level)), new Set(["PASS"]))
    assert.match(line(checks, "jq").detail, /jq-1\.8\.2/)
    assert.match(line(checks, "plugin").detail, /0\.1\.0/)
    assert.match(line(checks, "plugin").detail, /runs live from \/src\/dw-sdlc\/plugins\/sdlc/)
    assert.equal(line(checks, "package").detail, "dw-sdlc 0.2.0 in the plugin and in the repository")
  })

  it("package: a drift line when the plugin's package and the repository's pin differ", () => {
    const behind = withFile(
      HEALTHY,
      `${ROOT}/package.json`,
      JSON.stringify({ devDependencies: { "dw-sdlc": "0.3.0" } })
    )
    const update = line(diagnose({ root: ROOT, home: HOME, probe: fake(behind), config: CONFIG }), "package")
    assert.equal(update.level, "WARN")
    assert.equal(
      update.detail,
      "drift: the plugin runs dw-sdlc 0.2.0 and the repository pins 0.3.0, so its hooks and skills run other code than the Gate. claude plugin update sdlc@dw-sdlc"
    )
    const ahead = withFile(HEALTHY, `${ROOT}/package.json`, JSON.stringify({ devDependencies: { "dw-sdlc": "0.1.0" } }))
    const pin = line(diagnose({ root: ROOT, home: HOME, probe: fake(ahead), config: CONFIG }), "package")
    assert.equal(pin.level, "WARN")
    assert.match(pin.detail, /^drift: the plugin runs dw-sdlc 0\.2\.0 and the repository pins 0\.1\.0/)
    assert.match(pin.detail, /pnpm add --save-dev --save-exact dw-sdlc@0\.2\.0$/)
  })

  it("package: a catalog pin, and workspace: or a range read from the installed copy", () => {
    const catalog = withFile(
      withFile(HEALTHY, `${ROOT}/package.json`, JSON.stringify({ devDependencies: { "dw-sdlc": "catalog:" } })),
      `${ROOT}/pnpm-workspace.yaml`,
      "catalog:\n  dw-sdlc: 0.3.0\n"
    )
    assert.match(
      line(diagnose({ root: ROOT, home: HOME, probe: fake(catalog), config: CONFIG }), "package").detail,
      /repository pins 0\.3\.0/
    )
    const workspace = withFile(
      HEALTHY,
      `${ROOT}/package.json`,
      JSON.stringify({ devDependencies: { "dw-sdlc": "workspace:*" } })
    )
    const installed = withFile(
      workspace,
      `${ROOT}/node_modules/dw-sdlc/package.json`,
      JSON.stringify({ version: "0.2.0" })
    )
    assert.equal(
      line(diagnose({ root: ROOT, home: HOME, probe: fake(installed), config: CONFIG }), "package").level,
      "PASS"
    )
    const missing = line(diagnose({ root: ROOT, home: HOME, probe: fake(workspace), config: CONFIG }), "package")
    assert.equal(missing.level, "WARN")
    assert.equal(missing.detail, "the repository pins dw-sdlc workspace:*, not installed: pnpm install")
  })

  it("package: no pin, no repository, or a plugin without the package", () => {
    const unpinned = withFile(HEALTHY, `${ROOT}/package.json`, JSON.stringify({ devDependencies: {} }))
    const none = line(diagnose({ root: ROOT, home: HOME, probe: fake(unpinned), config: CONFIG }), "package")
    assert.equal(none.level, "INFO")
    assert.equal(none.detail, "the repository does not pin dw-sdlc")
    const outside = line(diagnose({ root: ROOT, home: HOME, probe: fake(HEALTHY), config: undefined }), "package")
    assert.equal(outside.level, "INFO")
    const sparse = withFile(HEALTHY, "/src/dw-sdlc/plugins/sdlc/dw-sdlc/package.json", undefined)
    const bare = line(diagnose({ root: ROOT, home: HOME, probe: fake(sparse), config: CONFIG }), "package")
    assert.equal(bare.level, "WARN")
    assert.match(bare.detail, /carries no dw-sdlc: an install from GitHub needs packages in its --sparse set/)
  })

  it("package: a snapshot install is read at its installPath", () => {
    const fromGit = withFile(
      withFile(
        HEALTHY,
        `${HOME}/.claude/plugins/known_marketplaces.json`,
        JSON.stringify({ "dw-sdlc": { source: { source: "github", repo: "dominikwozniak/dw-sdlc" } } })
      ),
      "/cache/sdlc/0.1.0/dw-sdlc/package.json",
      JSON.stringify({ version: "0.1.0" })
    )
    const check = line(diagnose({ root: ROOT, home: HOME, probe: fake(fromGit), config: CONFIG }), "package")
    assert.match(check.detail, /^drift: the plugin runs dw-sdlc 0\.1\.0 and the repository pins 0\.2\.0/)
  })

  describe("sessions", () => {
    it("passes with its version and its copy of the package", () => {
      const check = sessions(HEALTHY)
      assert.equal(check.level, "PASS")
      assert.equal(check.detail, "0.3.0 enabled, on dw-sdlc 0.2.0")
    })

    it("is INFO when absent, or when claude plugin list does not answer: a machine may go without it", () => {
      const absent = sessions(listing(SDLC_ENTRY))
      assert.equal(absent.level, "INFO")
      assert.equal(
        absent.detail,
        "no sdlc-sessions@dw-sdlc, so no /sdlc-recap, /sdlc-brief or /sdlc-delegate. claude plugin install sdlc-sessions@dw-sdlc --scope user"
      )
      const silent = sessions(withCommand(HEALTHY, "claude plugin list --json", undefined))
      assert.equal(silent.level, "INFO")
      assert.equal(silent.detail, "claude plugin list did not answer")
    })

    it("warns when disabled, naming the command that enables it", () => {
      const check = sessions(listing(SDLC_ENTRY, { ...SESSIONS_ENTRY, enabled: false }))
      assert.equal(check.level, "WARN")
      assert.equal(check.detail, "0.3.0 installed but disabled. claude plugin enable sdlc-sessions@dw-sdlc")
    })

    it("warns when it carries no copy of the package", () => {
      const check = sessions(withFile(HEALTHY, SESSIONS_COPY, undefined))
      assert.equal(check.level, "WARN")
      assert.match(check.detail, /carries no dw-sdlc: an install from GitHub needs packages in its --sparse set/)
    })

    it("names the drift of its copy and the plugin that is behind", () => {
      const behind = sessions(withFile(HEALTHY, SESSIONS_COPY, JSON.stringify({ version: "0.1.0" })))
      assert.equal(behind.level, "WARN")
      assert.equal(
        behind.detail,
        "drift: sdlc-sessions runs dw-sdlc 0.1.0 and sdlc runs 0.2.0. claude plugin update sdlc-sessions@dw-sdlc"
      )
      const ahead = sessions(withFile(HEALTHY, SESSIONS_COPY, JSON.stringify({ version: "0.3.0" })))
      assert.equal(
        ahead.detail,
        "drift: sdlc-sessions runs dw-sdlc 0.3.0 and sdlc runs 0.2.0. claude plugin update sdlc@dw-sdlc"
      )
    })

    it("reads a snapshot install at its installPath", () => {
      const fromGit = withFile(
        withFile(
          withFile(
            HEALTHY,
            `${HOME}/.claude/plugins/known_marketplaces.json`,
            JSON.stringify({ "dw-sdlc": { source: { source: "github", repo: "dominikwozniak/dw-sdlc" } } })
          ),
          "/cache/sdlc/0.1.0/dw-sdlc/package.json",
          JSON.stringify({ version: "0.2.0" })
        ),
        "/cache/sdlc-sessions/0.3.0/dw-sdlc/package.json",
        JSON.stringify({ version: "0.2.0" })
      )
      assert.equal(sessions(fromGit).level, "PASS")
    })
  })

  describe("hc", () => {
    const NO_HC = "no hc on PATH, so no /sdlc-delegate: install herdr to run Workers"

    it("passes with its path on the agent's PATH", () => {
      assert.deepEqual(hc(HEALTHY), {
        name: "hc",
        level: "PASS",
        detail: "/home/t/.local/bin/hc, so a Lead can start Workers"
      })
    })

    it("warns when absent and sdlc-sessions is enabled: /sdlc-delegate has nothing to start Workers with", () => {
      assert.deepEqual(hc(withoutHc(HEALTHY)), { name: "hc", level: "WARN", detail: NO_HC })
    })

    it("is INFO when absent and sdlc-sessions is off: a machine with only the guards goes without herdr", () => {
      const notInstalled = withoutHc(listing(SDLC_ENTRY))
      const disabled = withoutHc(listing(SDLC_ENTRY, { ...SESSIONS_ENTRY, enabled: false }))
      const silent = withoutHc(withCommand(HEALTHY, "claude plugin list --json", undefined))
      for (const machine of [notInstalled, disabled, silent]) {
        assert.deepEqual(hc(machine), { name: "hc", level: "INFO", detail: NO_HC })
      }
    })
  })

  it("jq missing is a FAIL that names the consequence", () => {
    const checks = diagnose({
      root: ROOT,
      home: HOME,
      probe: fake(withCommand(HEALTHY, "jq --version", undefined)),
      config: CONFIG
    })
    const check = line(checks, "jq")
    assert.equal(check.level, "FAIL")
    assert.match(check.detail, /every guard is silent/)
  })

  it("the plugin absent, disabled or another version", () => {
    const absent = withCommand(HEALTHY, "claude plugin list --json", { stdout: "[]" })
    assert.equal(
      line(diagnose({ root: ROOT, home: HOME, probe: fake(absent), config: CONFIG }), "plugin").level,
      "FAIL"
    )
    const disabled = withCommand(HEALTHY, "claude plugin list --json", {
      stdout: JSON.stringify([{ id: "sdlc@dw-sdlc", version: "0.1.0", enabled: false }])
    })
    const check = line(diagnose({ root: ROOT, home: HOME, probe: fake(disabled), config: CONFIG }), "plugin")
    assert.equal(check.level, "FAIL", "a disabled plugin guards nothing")
    assert.match(check.detail, /claude plugin enable/)
    const fromGit = withFile(
      HEALTHY,
      `${HOME}/.claude/plugins/known_marketplaces.json`,
      JSON.stringify({ "dw-sdlc": { source: { source: "git", url: "git@github.com:dominikwozniak/dw-sdlc.git" } } })
    )
    const snapshot = line(diagnose({ root: ROOT, home: HOME, probe: fake(fromGit), config: CONFIG }), "plugin")
    assert.match(
      snapshot.detail,
      /installed at \/cache\/sdlc\/0\.1\.0; a change reaches it through claude plugin update/
    )
    const noClaude = withCommand(HEALTHY, "claude plugin list --json", undefined)
    assert.equal(
      line(diagnose({ root: ROOT, home: HOME, probe: fake(noClaude), config: CONFIG }), "plugin").level,
      "FAIL"
    )
  })

  it("plugin: a snapshot whose installPath is not a string is installed at ?", () => {
    const fromGit = withFile(
      HEALTHY,
      `${HOME}/.claude/plugins/known_marketplaces.json`,
      JSON.stringify({ "dw-sdlc": { source: { source: "git", url: "git@github.com:dominikwozniak/dw-sdlc.git" } } })
    )
    const odd = withCommand(fromGit, "claude plugin list --json", {
      stdout: JSON.stringify([{ id: "sdlc@dw-sdlc", version: "0.1.0", enabled: true, installPath: { dir: "/cache" } }])
    })
    const check = line(diagnose({ root: ROOT, home: HOME, probe: fake(odd), config: CONFIG }), "plugin")
    assert.equal(check.level, "PASS")
    assert.match(check.detail, /installed at \?; a change reaches it through claude plugin update/)
  })

  it("rtk: wired by hand is a FAIL, no rtk at all a PASS", () => {
    const shim = JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: 'bash "$HOME/.claude/hooks/rtk-hook-guard.sh"' }] }
        ]
      }
    })
    const check = line(
      diagnose({
        root: ROOT,
        home: HOME,
        probe: fake(withFile(HEALTHY, `${HOME}/.claude/settings.json`, shim)),
        config: CONFIG
      }),
      "rtk"
    )
    assert.equal(check.level, "FAIL")
    assert.match(check.detail, /rtk-hook-guard\.sh/)
    assert.match(check.detail, /linked worktree/)
    const direct = JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] }] }
    })
    assert.equal(
      line(
        diagnose({
          root: ROOT,
          home: HOME,
          probe: fake(withFile(HEALTHY, `${HOME}/.claude/settings.json`, direct)),
          config: CONFIG
        }),
        "rtk"
      ).level,
      "FAIL"
    )
    const stale = withFile(HEALTHY, "/src/dw-sdlc/plugins/sdlc/hooks/rtk-rewrite.sh", undefined)
    const old = line(diagnose({ root: ROOT, home: HOME, probe: fake(stale), config: CONFIG }), "rtk")
    assert.equal(old.level, "WARN", "a plugin without the hook rewrites nothing")
    assert.match(old.detail, /claude plugin update; nothing rewrites/)
    const interim = line(
      diagnose({
        root: ROOT,
        home: HOME,
        probe: fake(withFile(stale, `${HOME}/.claude/settings.json`, shim)),
        config: CONFIG
      }),
      "rtk"
    )
    assert.equal(interim.level, "WARN", "the hand wiring is what runs rtk until the plugin carries the hook")
    assert.match(interim.detail, /carries it until then/)
    const snapshot = withFile(
      withFile(
        stale,
        `${HOME}/.claude/plugins/known_marketplaces.json`,
        JSON.stringify({ "dw-sdlc": { source: { source: "github", repo: "dominikwozniak/dw-sdlc" } } })
      ),
      "/cache/sdlc/0.1.0/hooks/rtk-rewrite.sh",
      "#!/bin/bash\n"
    )
    assert.equal(
      line(diagnose({ root: ROOT, home: HOME, probe: fake(snapshot), config: CONFIG }), "rtk").level,
      "PASS",
      "a snapshot install is read at its installPath"
    )
    const noRtk = withShell(HEALTHY, "command -v rtk", "")
    const none = line(diagnose({ root: ROOT, home: HOME, probe: fake(noRtk), config: CONFIG }), "rtk")
    assert.equal(none.level, "PASS")
    assert.match(none.detail, /no rtk/)
  })

  it("rtk reflects exclude_commands for the filters that misbehave", () => {
    assert.match(rtkLine(HEALTHY).detail, /exclude_commands: find/)
    const empty = withFile(HEALTHY, RTK_CONFIG, "[hooks]\nexclude_commands = []\n")
    const check = rtkLine(empty)
    assert.equal(check.level, "WARN")
    assert.match(check.detail, /lacks find \(rtk 0\.45\.0 refuses find -exec; fixed in 0\.46\.0\)/)
    const later = rtkLine(withCommand(empty, "rtk --version", { stdout: "rtk 0.49.0\n" }))
    assert.equal(later.level, "PASS", "from 0.46.0 on no filter needs excluding")
    assert.equal(rtkLine(withFile(HEALTHY, RTK_CONFIG, undefined)).level, "WARN")
  })

  it("reads the exclude list from config.toml and knows where the file lives", () => {
    assert.deepEqual(rtkExcludes('[hooks]\nexclude_commands = ["find", "pnpm exec vitest"]\n'), [
      "find",
      "pnpm exec vitest"
    ])
    assert.deepEqual(rtkExcludes("[hooks]\nexclude_commands = []\n"), [])
    assert.deepEqual(rtkExcludes(undefined), [])
    assert.equal(rtkConfigPath("/h", "darwin"), "/h/Library/Application Support/rtk/config.toml")
    assert.equal(rtkConfigPath("/h", "linux", {}), "/h/.config/rtk/config.toml")
    assert.equal(rtkConfigPath("/h", "linux", { XDG_CONFIG_HOME: "/x" }), "/x/rtk/config.toml")
  })

  it("safe chain: absent, present without the shim, present with it", () => {
    const absent = withShell(withShell(HEALTHY, "command -v safe-chain", ""), "command -v npm", "/usr/bin/npm")
    const check = line(diagnose({ root: ROOT, home: HOME, probe: fake(absent), config: CONFIG }), "safe chain")
    assert.equal(check.level, "WARN")
    assert.match(check.detail, /AikidoSec/)
    const noShim = withShell(HEALTHY, "command -v npm", "/usr/bin/npm")
    const shimless = line(diagnose({ root: ROOT, home: HOME, probe: fake(noShim), config: CONFIG }), "safe chain")
    assert.equal(shimless.level, "WARN")
    assert.match(shimless.detail, /npm resolves to \/usr\/bin\/npm/)
    const aliasRoute = withShell(HEALTHY, "command -v npm", "npm")
    assert.equal(
      line(diagnose({ root: ROOT, home: HOME, probe: fake(aliasRoute), config: CONFIG }), "safe chain").level,
      "PASS"
    )
  })

  it("pnpm release age: below the baseline warns, no pnpm is informational", () => {
    const low = withCommand(HEALTHY, atHome("pnpm config get minimumReleaseAge"), { stdout: "1440\n" })
    const check = line(diagnose({ root: ROOT, home: HOME, probe: fake(low), config: CONFIG }), "pnpm release age")
    assert.equal(check.level, "WARN")
    assert.match(check.detail, /10080/)
    const unset = withCommand(HEALTHY, atHome("pnpm config get minimumReleaseAge"), { stdout: "undefined\n" })
    assert.equal(
      line(diagnose({ root: ROOT, home: HOME, probe: fake(unset), config: CONFIG }), "pnpm release age").level,
      "WARN"
    )
    const noPnpm = withShell(HEALTHY, "command -v pnpm", "")
    assert.equal(
      line(diagnose({ root: ROOT, home: HOME, probe: fake(noPnpm), config: CONFIG }), "pnpm release age").level,
      "INFO"
    )
  })

  it("the machine-wide values come from the home directory, never from the repository's own config", () => {
    // pnpm-workspace.yaml in the checkout answers 10080 while the machine has nothing set.
    const repoOnly = withCommand(
      withCommand(HEALTHY, atHome("pnpm config get minimumReleaseAge"), { stdout: "undefined\n" }),
      "pnpm config get minimumReleaseAge",
      { stdout: "10080\n" }
    )
    const pnpm = line(diagnose({ root: ROOT, home: HOME, probe: fake(repoOnly), config: CONFIG }), "pnpm release age")
    assert.equal(pnpm.level, "WARN")
  })

  it("commit signing off is a WARN", () => {
    const off = withCommand(HEALTHY, "git config --global commit.gpgsign", { status: 1, stdout: "" })
    const check = line(diagnose({ root: ROOT, home: HOME, probe: fake(off), config: CONFIG }), "commit signing")
    assert.equal(check.level, "WARN")
    assert.match(check.detail, /git config --global commit.gpgsign true/)
  })

  it("Claude's config dir is $CLAUDE_CONFIG_DIR when set, else ~/.claude", () => {
    assert.equal(claudeConfigDir({ CLAUDE_CONFIG_DIR: "/cfg" }, HOME), "/cfg")
    assert.equal(claudeConfigDir({}, HOME), `${HOME}/.claude`)
  })

  it("reads the user settings from the Claude config dir it is given", () => {
    const direct = JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] }] }
    })
    const marketplaces = HEALTHY.files?.[`${HOME}/.claude/plugins/known_marketplaces.json`]
    const swapped = withFile(
      withFile(HEALTHY, "/cfg/settings.json", direct),
      "/cfg/plugins/known_marketplaces.json",
      marketplaces
    )
    const check = line(
      diagnose({ root: ROOT, home: HOME, claudeDir: "/cfg", probe: fake(swapped), config: CONFIG }),
      "rtk"
    )
    assert.equal(check.level, "FAIL")
    assert.match(check.detail, /\/cfg\/settings\.json wires rtk by hand/)
  })

  it("config: names the convention", () => {
    const check = line(diagnose({ root: ROOT, home: HOME, probe: fake(HEALTHY), config: CONFIG }), "config")
    assert.equal(check.level, "PASS")
    assert.equal(check.detail, "commit ticket-key")
  })

  it("config: names a layer read from the main checkout of a worktree", () => {
    const config = { ...CONFIG, sources: { committed: undefined, local: "/main" } }
    const check = line(diagnose({ root: ROOT, home: HOME, probe: fake(HEALTHY), config }), "config")
    assert.equal(check.level, "PASS")
    assert.equal(check.detail, "commit ticket-key; local layer from /main")
  })

  it("config: outside a repository is INFO and says no repository was found", () => {
    const check = line(diagnose({ root: "/tmp/x", home: HOME, probe: fake(HEALTHY), config: undefined }), "config")
    assert.equal(check.level, "INFO")
    assert.match(check.detail, /^no repository found at \/tmp\/x/)
  })

  it("config: problems fail and are listed", () => {
    const checks = diagnose({
      root: ROOT,
      home: HOME,
      probe: fake(HEALTHY),
      config: {
        config: { commit: { convention: "ticket-key" } },
        problems: ['.ai/agentic.config.json: guardrails.forcePush: "allow" is not one of "deny", "ask", "lease"']
      }
    })
    const check = line(checks, "config")
    assert.equal(check.level, "FAIL")
    assert.match(check.detail, /forcePush/)
  })
})

describe("render", () => {
  it("prints one aligned line per check", () => {
    const text = render([
      { name: "jq", level: "PASS", detail: "jq-1.8.2" },
      { name: "safe chain", level: "WARN", detail: "absent" }
    ])
    assert.deepEqual(text.split("\n"), ["PASS  jq                jq-1.8.2", "WARN  safe chain        absent"])
  })
})

// The real probes, kept fast and machine-independent: no claude, rtk or pnpm on PATH, a plain login shell.
const BARE_MACHINE = { PATH: "/usr/bin:/bin", SHELL: "/bin/sh" }

describe("the doctor command", () => {
  it("--root inside a repository diagnoses the repository's top level", () => {
    const root = initRepo(scratch("doctor"))
    writeJson(join(root, ".ai", "agentic.config.json"), { guardrails: { forcePush: "allow" } })
    write(join(root, "sub", "x.txt"), "")
    const verdict = runBin(["doctor", "--root", join(root, "sub"), "--home", scratch("home")], REPO_ROOT, BARE_MACHINE)
    assert.match(verdict.stdout, /^FAIL {2}config {12}the guards run on the strictest defaults/m)
    assert.equal(verdict.status, 1)
  })

  it("reads a config whose Steps are objects as a valid one", () => {
    const root = initRepo(scratch("doctor"))
    const steps = [{ command: "pnpm lint", hint: "run pnpm fix" }, "pnpm test"]
    writeJson(join(root, ".ai", "agentic.config.json"), { commit: { convention: "conventional" }, gate: { steps } })
    const verdict = runBin(["doctor", "--root", root, "--home", scratch("home")], REPO_ROOT, BARE_MACHINE)
    assert.match(verdict.stdout, /^PASS {2}config {12}commit conventional/m)
    assert.doesNotMatch(verdict.stdout, /^FAIL {2}config/m)
  })

  it("--root outside any repository judges no config", () => {
    const dir = scratch("doctor-bare")
    const verdict = runBin(["doctor", "--root", dir, "--home", scratch("home")], REPO_ROOT, BARE_MACHINE)
    assert.match(verdict.stdout, /^INFO {2}config {12}no repository found at /m)
    assert.ok(verdict.stdout.includes(`no repository found at ${dir}`), verdict.stdout)
  })
})
