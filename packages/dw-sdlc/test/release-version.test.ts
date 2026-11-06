// What the release workflow's version job leaves behind, run on a throwaway workspace with this
// repository's formatter config and binaries: a changelog the formatter accepts, from a changeset of
// more than one paragraph, which `changeset version` alone writes in a shape oxfmt rewrites.

import assert from "node:assert/strict"
import { copyFileSync, readFileSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { REPO_ROOT, runCommand, scratch, write, writeJson } from "./harness.ts"

const SCRIPT = "release:version"
const BIN_DIR = join(REPO_ROOT, "node_modules", ".bin")
const UNFORMATTED = "#  Left as it is\n"

function versionScript(): string {
  const { scripts } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>
  }
  const script = scripts[SCRIPT]
  assert.ok(script !== undefined, `package.json has no ${SCRIPT} script`)
  return script
}

/** A workspace of one package with a pending changeset of two paragraphs and an unformatted file. */
function workspace(): string {
  const root = scratch("release")
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"))
  copyFileSync(join(REPO_ROOT, "vite.config.ts"), join(root, "vite.config.ts"))
  writeJson(join(root, "package.json"), { name: "root", private: true })
  write(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n')
  writeJson(join(root, "packages/thing/package.json"), { name: "thing", version: "1.0.0" })
  write(join(root, "packages/thing/notes.md"), UNFORMATTED)
  writeJson(join(root, ".changeset/config.json"), { access: "public" })
  write(
    join(root, ".changeset/two-paragraphs.md"),
    '---\n"thing": minor\n---\n\nThe first paragraph.\n\nThe second one.\n'
  )
  return root
}

describe("the version job", () => {
  it("runs the script through the workflow", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/release.yaml"), "utf8")
    assert.match(workflow, new RegExp(`changesets/action/version@.*\\n\\s+with:\\n\\s+script: pnpm ${SCRIPT}\\n`))
  })

  it("formats the changelog of a changeset of two paragraphs, and no other file", () => {
    const root = workspace()
    const env = { PATH: `${BIN_DIR}:${process.env.PATH ?? ""}` }

    const version = runCommand("sh", ["-c", versionScript()], root, env)
    assert.equal(version.status, 0, `${version.stdout}${version.stderr}`)

    const changelog = readFileSync(join(root, "packages/thing/CHANGELOG.md"), "utf8")
    assert.match(changelog, /The first paragraph\./)
    assert.match(changelog, /The second one\./)
    const formatter = runCommand("vp", ["fmt", "--check", "packages/thing/CHANGELOG.md"], root, env)
    assert.equal(formatter.status, 0, `${formatter.stdout}${formatter.stderr}\n${changelog}`)
    assert.equal(readFileSync(join(root, "packages/thing/notes.md"), "utf8"), UNFORMATTED)
  })
})
