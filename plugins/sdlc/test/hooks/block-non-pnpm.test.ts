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
  allowed("bunx-not-bun-space", "bunx tsc")
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
