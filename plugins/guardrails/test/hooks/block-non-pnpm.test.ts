// What block-non-pnpm.sh refuses (exit 2) and lets through (exit 0), fed the real hook payload
// against throwaway repositories: one whose lockfile says pnpm, one with no Node lockfile at all,
// one that declares npm, one that declares pnpm over a yarn lockfile. The guard fires only where the
// resolved config says pnpm.

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
