// What block-non-pnpm.sh refuses (exit 2) and lets through (exit 0), fed the real hook payload against
// throwaway repositories: a pnpm lockfile, no Node lockfile at all, npm declared, pnpm declared over a
// yarn lockfile. The guard fires only where the resolved config says pnpm.

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { bashPayload, expectExit, initRepo, runHook, scratch, write, writeJson } from "../harness.ts"

const TMP = scratch("pm")
const PNPM = initRepo(join(TMP, "pnpm"))
write(join(PNPM, "package.json"), "")
write(join(PNPM, "pnpm-lock.yaml"), "")
const NO_NODE = initRepo(join(TMP, "no-node"))
const NPM = initRepo(join(TMP, "npm"))
write(join(NPM, "package.json"), "")
writeJson(join(NPM, ".ai", "agentic.config.json"), { packageManagers: { node: "npm" } })
const DECLARED = initRepo(join(TMP, "declared"))
write(join(DECLARED, "yarn.lock"), "")
writeJson(join(DECLARED, ".ai", "agentic.config.json"), { packageManagers: { node: "pnpm" } })

// A folder that is no repository, holding a pnpm one, an npm one and a plain folder.
const OUTSIDE = join(TMP, "workspace")
const OUTSIDE_PNPM = initRepo(join(OUTSIDE, "app"))
write(join(OUTSIDE_PNPM, "package.json"), "")
write(join(OUTSIDE_PNPM, "pnpm-lock.yaml"), "")
const OUTSIDE_NPM = initRepo(join(OUTSIDE, "legacy"))
write(join(OUTSIDE_NPM, "package.json"), "")
writeJson(join(OUTSIDE_NPM, ".ai", "agentic.config.json"), { packageManagers: { node: "npm" } })
mkdirSync(join(OUTSIDE, "plain"), { recursive: true })

function blocked(name: string, command: string, cwd = PNPM): void {
  it(name, () => {
    expectExit(runHook("block-non-pnpm", bashPayload(command, cwd)), 2)
  })
}
function allowed(name: string, command: string, cwd = PNPM): void {
  it(name, () => {
    expectExit(runHook("block-non-pnpm", bashPayload(command, cwd)), 0)
  })
}

describe("a pnpm repository (lockfile) — npm refused", () => {
  blocked("npm-install", "npm install")
  blocked("npm-install-pkg", "npm install lodash")
  blocked("npm-i", "npm i")
  blocked("npm-add", "npm add lodash")
  blocked("npm-ci", "npm ci")
  blocked("npm-update", "npm update")
  blocked("npm-upgrade", "npm upgrade")
  blocked("npm-exec", "npm exec tsc")
  blocked("npm-run", "npm run build")
  blocked("npm-install-save-dev", "npm install --save-dev prettier")
  blocked("sudo-npm-install", "sudo npm install -g typescript")
  blocked("npm-after-and", "pnpm build && npm install")
  blocked("npm-after-semicolon", "cd app; npm ci")
  blocked("npm-after-pipe", "echo x | npm run seed")
})

describe("a pnpm repository — yarn, bun and npx refused", () => {
  blocked("yarn-bare", "yarn")
  blocked("yarn-add", "yarn add lodash")
  blocked("yarn-install", "yarn install")
  blocked("bun-install", "bun install")
  blocked("bun-i", "bun i")
  blocked("bun-add", "bun add lodash")
  blocked("bun-remove", "bun remove lodash")
  blocked("bun-run", "bun run build")
  blocked("bun-x", "bun x tsc")
  blocked("sudo-yarn", "sudo yarn add lodash")
  blocked("npx-tsc", "npx tsc --noEmit")
  blocked("npx-scoped", "npx @scope/tool")
  blocked("npx-bare", "npx")
  blocked("sudo-npx", "sudo npx eslint .")
  blocked("rtk-npx", "rtk npx tsc")
  blocked("assign-npx", "NODE_ENV=test npx jest")
  blocked("npx-chained", "cd sub && npx tsc --noEmit")
})

// Each verb that installs, removes, updates, links or rebuilds a dependency, or runs a script or a
// package, under every alias npm 11's lib/utils/cmd-list.js gives it and bun documents.
const NPM_INSTALL = ["install", "add", "i", "in", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal"]
const NPM_CI = ["isntall", "ci", "clean-install", "ic", "install-clean", "isntall-clean"]
const NPM_INSTALL_TEST = ["install-test", "it", "install-ci-test", "cit", "clean-install-test", "sit"]
const NPM_CHANGE = ["uninstall", "unlink", "remove", "rm", "r", "un", "update", "u", "up", "upgrade", "udpate"]
const NPM_TREE = ["dedupe", "ddp", "prune", "link", "ln", "rebuild", "rb"]
const NPM_RUN = ["run", "run-script", "rum", "urn", "test", "tst", "t", "start", "stop", "restart"]
const NPM_EXEC = ["exec", "x", "init", "create", "innit", "explore"]
const NPM_VERBS = [NPM_INSTALL, NPM_CI, NPM_INSTALL_TEST, NPM_CHANGE, NPM_TREE, NPM_RUN, NPM_EXEC].flat()
// bun's own commands, as its root command matcher (src/runtime/cli/mod.rs) reads the first word. Any
// other word runs a package.json script, a bin or a file, and `check`, `lint`, `fmt` and `compile` run
// the project's script of that name when it has one.
const BUN_INSTALL = ["install", "i", "ci", "add", "a", "remove", "rm", "uninstall", "r", "update", "up"]
const BUN_TREE = ["link", "unlink", "patch", "patch-commit", "dedupe", "prune"]
const BUN_RUN = ["run", "x", "exec", "test", "init", "create", "c", "check", "lint", "fmt", "compile"]
const BUN_VERBS = [BUN_INSTALL, BUN_TREE, BUN_RUN].flat()
const BUN_OWN = [
  ["build", "bun", "outdated", "audit", "info", "why", "publish", "whoami", "list", "pm", "repl"],
  ["upgrade", "help", "completions", "getcompletes", "discord"]
].flat()

describe("a pnpm repository — every npm and bun verb that installs or runs", () => {
  for (const verb of NPM_VERBS) {
    blocked(`npm ${verb}`, `npm ${verb} lodash`)
  }
  for (const verb of BUN_VERBS) {
    blocked(`bun ${verb}`, `bun ${verb} lodash`)
  }
  blocked("npm audit fix", "npm audit fix")
  blocked("npm audit fix behind an option", "npm audit --json fix --force")
  blocked("npm test alone", "npm test")
  blocked("bunx", "bunx prettier --write .")
  blocked("bunx bare", "bunx")
  blocked("sudo-bunx", "sudo bunx tsc")
  blocked("bunx-chained", "cd sub && bunx tsc --noEmit")
  allowed("npm audit reads", "npm audit")
  allowed("npm audit signatures reads", "npm audit signatures")
  allowed("npm ls reads", "npm ls lodash")
  allowed("npm outdated reads", "npm outdated")
  allowed("npm help names a verb", "npm help install")
  allowed("npm pkg get reads", "npm pkg get name")
  blocked("npm explore runs a command in a package", "npm explore x -- ls")
  allowed("bun build bundles", "bun build ./src/index.ts")
  allowed("bun version", "bun --version")
})

describe("a pnpm repository — bun runs any word that is not its own command", () => {
  for (const word of BUN_OWN) {
    allowed(`bun ${word}`, `bun ${word}`)
  }
  blocked("a package.json script", "bun dev")
  blocked("a file by path", "bun ./x.ts")
  blocked("a file in a folder", "bun scripts/x.ts")
  blocked("a name the shell expands", 'bun "$SCRIPT"')
  blocked("a quoted script name", "bun 'dev'")
  blocked("bun test runs code", "bun test")
  blocked("bun pm trust runs lifecycle scripts", "bun pm trust x")
  blocked("a script after a chain", "pnpm build && bun dev")
  blocked("a script behind a wrapper", 'rtk run "bun dev"')
  blocked("a script after a cd into a pnpm repository", "cd app && bun dev", OUTSIDE)
  allowed("bun pm ls reads", "bun pm ls")
  allowed("bun pm untrusted reads", "bun pm untrusted")
  allowed("bare bun prints its help", "bun")
  allowed("a script name in prose", 'git commit -m "docs: bun dev is banned"')
  allowed("bun dev in an npm repository", "bun dev", NPM)
})

// bun's which() (src/runtime/cli/mod.rs) skips every leading word that starts with a `-` and reads the
// next word as the command, an option's value included: `bun --cwd app outdated` is `app`, which runs
// `outdated` as a script, a bin or a file. `-e`, `--eval`, `-p` and `--print` run their code.
describe("a pnpm repository — an option before bun's first word does not hide it", () => {
  blocked("--watch before a script", "bun --watch dev")
  blocked("--hot before a file", "bun --hot ./x.ts")
  blocked("--bun before a script", "bun --bun dev")
  blocked("-b before a script", "bun -b dev")
  blocked("--cwd before a script", "bun --cwd app dev")
  blocked("--silent before install", "bun --silent install")
  blocked("two options before install", "bun --silent --no-install install")
  blocked("--filter runs the script in each workspace", "bun --filter '*' build")
  blocked("an option's value is bun's command word", "bun --cwd app outdated")
  blocked("a redirect before a script", "bun > log.txt dev")
  blocked("a glued redirect before install", "bun 2>&1 install")
  blocked("-e runs code", "bun -e 'console.log(1)'")
  blocked("--eval runs code", 'bun --eval "console.log(1)"')
  blocked("--eval= runs code", "bun --eval='console.log(1)'")
  blocked("-p prints code it runs", "bun -p 1+1")
  blocked("--print prints code it runs", "bun --print 1+1")
  blocked("-e behind a flag of no value", "bun -be 'console.log(1)'")
  blocked("-e whose code is a word of bun's own", "bun -e build")
  blocked("-e after another option", "bun --silent -e 'console.log(1)'")
  blocked("an option before a script after a chain", "pnpm build && bun --watch dev")
  allowed("--cwd= keeps the command word", "bun --cwd=app outdated")
  allowed("--silent before pm ls", "bun --silent pm ls")
  allowed("an option before a read", "bun --no-install outdated")
  allowed("a redirect before a read", "bun 2>/dev/null outdated")
  allowed("bun --version", "bun --version")
  allowed("bun -v", "bun -v")
  allowed("bun --help", "bun --help")
  allowed("an option before a script in prose", 'git commit -m "docs: bun --watch dev is banned"')
  allowed("an option before a script in an npm repository", "bun --watch dev", NPM)
})

describe("a pnpm repository — wrappers seen through", () => {
  blocked("rtk-npm-install", "rtk npm install")
  blocked("rtk-proxy-npm", "rtk proxy npm ci")
  blocked("rtk-run-npm", "rtk run npm install")
  blocked("rtk-run-quoted-npm", 'rtk run "npm install"')
  blocked("assign-npm", "CI=1 npm ci")
  blocked("assign-sudo-yarn", "FOO=1 sudo yarn install")
  blocked("command-npm", "command npm install")
  blocked("env-npm", "env CI=1 npm ci")
  blocked("subshell-npx", "(cd app && npx tsc)")
  blocked("bash-c-chained-npm", 'bash -c "cd app && npm install"')
  blocked("bash-c-ansi-c-chained-npm", "bash -c $'cd app && npm install'")
  blocked("dq-substitution-npm", 'echo "$(npm install)"')
  blocked("heredoc-to-bash-npm", "bash <<EOF\ncd app; npm install\nEOF")
  blocked("dq-backtick-npx", 'echo "`npx foo`"')
  // A heredoc body is text: a backtick in a commit message is markdown, not a substitution.
  allowed("heredoc-body-backtick", "git commit -F - <<'EOF'\nfix: x\n\nnever run `npm install` here\nEOF")
})

describe("a pnpm repository — an npm option before the verb", () => {
  blocked("npm-prefix", "npm --prefix packages/app install")
  blocked("npm-global", "npm -g install typescript")
  blocked("npm-silent-ci", "npm --silent ci")
  blocked("npm-workspace-run", "npm --workspace a run build")
  blocked("npm-w-install", "npm -w a install lodash")
  blocked("npm-prefix-equals", "npm --prefix=packages/app install")
  blocked("npm-prefix-quoted", 'npm --prefix "packages/my app" install')
  blocked("npm-two-options", "npm --silent --prefix app ci")
  blocked("npm-option-after-chain", "pnpm build && npm --silent ci")
  allowed("npm-version-short", "npm -v")
  allowed("npm-view-package", "npm view lodash version")
  allowed("npm-view-a-package-named-like-a-verb", "npm view run")
  allowed("npm-option-then-no-verb", "npm --prefix app")
  allowed("npm-option-then-other-verb", "npm --silent whoami")
  allowed("npm-option-in-prose", 'git commit -m "docs: npm --silent ci is banned"')
})

describe("a cd out of the repository into a pnpm one", () => {
  blocked("cd-npm-install", "cd app && npm install", OUTSIDE)
  blocked("cd-yarn-add", "cd app && yarn add lodash", OUTSIDE)
  blocked("cd-npx", "cd app; npx tsc", OUTSIDE)
  blocked("cd-absolute-npm", `cd ${join(OUTSIDE, "app")} && npm ci`, OUTSIDE)
  blocked("cd-subshell-npm", "(cd app && npm install)", OUTSIDE)
  blocked("cd-option-npm", "cd -P app && npm install", OUTSIDE)
  blocked("cd-then-option-npm", "cd app && npm --silent ci", OUTSIDE)
  blocked("cd-redirect-npm", "cd app && npm 2>&1 install", OUTSIDE)
  blocked("cd-redirect-glued-npm", "cd app && npm 2>/dev/null ci", OUTSIDE)
  blocked("cd-redirect-alone-npm", "cd app && npm > log.txt install", OUTSIDE)
  blocked("cd-redirect-both-npm", "cd app && npm --silent &>log.txt install", OUTSIDE)
  allowed("cd-pnpm", "cd app && pnpm install", OUTSIDE)
  allowed("cd-pnpm-redirect", "cd app && pnpm install 2>&1 | tail -5", OUTSIDE)
  allowed("cd-into-npm-repo-redirect", "cd legacy && npm 2>&1 install", OUTSIDE)
  allowed("cd-into-npm-repo", "cd legacy && npm install", OUTSIDE)
  allowed("cd-into-a-plain-folder", "cd plain && npm install", OUTSIDE)
  allowed("cd-subshell-ended", "(cd app) && npm install", OUTSIDE)
  allowed("no-cd-outside", "npm install", OUTSIDE)
  blocked("cd-out-of-npm-into-pnpm", `cd ${PNPM} && npm install`, NPM)
  allowed("cd-out-of-pnpm-into-npm", `cd ${NPM} && npm install`, PNPM)
})

describe("a pnpm repository — pnpm and the near-misses pass", () => {
  allowed("pnpm-install", "pnpm install")
  allowed("pnpm-add", "pnpm add -D prettier")
  allowed("pnpm-dlx", "pnpm dlx ctx7 library React")
  allowed("pnpm-run-script", "pnpm check")
  allowed("pnpm-dlx-tsc", "pnpm dlx tsc --noEmit")
  allowed("npx-substring", "npxfoo --help")
  allowed("npx-in-a-name", "pnpm add -D npx-import")
  allowed("npx-in-prose", 'git commit -m "docs: why npx is banned"')
  allowed("npm-substring", "npmsinstall")
  allowed("npm-in-a-path", "cat node_modules/.bin/npm-run-all")
  allowed("npm-in-prose", 'git commit -m "docs: why npm install is banned"')
  allowed("npm-bare-version", "npm --version")
  allowed("npm-unknown-subcommand", "npm whoami")
  allowed("bundle-not-bun", "bundle exec rspec")
  allowed("bunx-in-a-name", "bunxfoo --help")
  allowed("grep-for-yarn", "grep -rn yarn plugins/")
  allowed("empty-input", "")
  allowed("plain-ls", "ls -la")
})

describe("a repository with no Node lockfile — the guard is silent", () => {
  allowed("no-node-yarn-install", "yarn install", NO_NODE)
  allowed("no-node-npm-install", "npm install", NO_NODE)
  allowed("no-node-npx", "npx tsc", NO_NODE)
})

describe("a repository that declares npm — silent too", () => {
  allowed("npm-repo-npm-install", "npm install", NPM)
  allowed("npm-repo-yarn", "yarn add x", NPM)
})

describe("a declared pnpm beats a yarn lockfile", () => {
  blocked("declared-pnpm-yarn", "yarn install", DECLARED)
  allowed("declared-pnpm-pnpm", "pnpm install", DECLARED)
})
