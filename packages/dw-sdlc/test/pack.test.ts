// The package as a consumer gets it: `pnpm pack`, the tarball installed into a throwaway repository,
// and the `dw-sdlc` bin run from its `node_modules`, where Node refuses to strip types from a `.ts` file.

import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { before, describe, it } from "node:test"

import { lines, PACKAGE_ROOT, repo, runCommand, type Run, scratch } from "./harness.ts"

const CONFIG = ".ai/agentic.config.json"
const INSTALLED_SCHEMA = "node_modules/dw-sdlc/config/agentic.config.schema.json"
/** The bin link pnpm writes in the consumer, run by path: the PATH a test inherits holds this repository's. */
const INSTALLED_BIN = "node_modules/.bin/dw-sdlc"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** `result` when the command exited 0; otherwise fails the test with everything it printed. */
function succeeded(what: string, result: Run): Run {
  assert.equal(result.status, 0, `${what} exited ${result.status}\n${result.stdout}\n${result.stderr}`)
  return result
}

type Packed = { tarball: string; files: string[]; manifest: Record<string, unknown> }

/** Packs this package the way a release does and reads back what the tarball holds. */
function pack(): Packed {
  const tarball = join(scratch("pack"), "dw-sdlc.tgz")
  succeeded("pnpm pack", runCommand("pnpm", ["pack", "--out", tarball], PACKAGE_ROOT))
  const listing = succeeded("tar -t", runCommand("tar", ["-tzf", tarball], PACKAGE_ROOT))
  const files = lines(listing.stdout)
    .map((entry) => entry.replace(/^package\//, ""))
    .toSorted()
  const manifest: unknown = JSON.parse(
    succeeded("tar -x", runCommand("tar", ["-xzOf", tarball, "package/package.json"], PACKAGE_ROOT)).stdout
  )
  assert.ok(isRecord(manifest), "the packed package.json is not an object")
  return { tarball, files, manifest }
}

/** Every file path a manifest value names: a string, or the leaves of an object of them. */
function namedPaths(value: unknown): string[] {
  if (typeof value === "string") {
    return [value.replace(/^\.\//, "")]
  }
  return isRecord(value) ? Object.values(value).flatMap(namedPaths) : []
}

describe("the packed package", () => {
  let packed: Packed
  before(() => {
    packed = pack()
  })

  it("ships the built JavaScript and the schema, nothing from the source or the tests", () => {
    const built = packed.files.filter((file) => file.startsWith("dist/"))
    assert.ok(built.includes("dist/cli.js"), `no dist/cli.js in ${packed.files.join(", ")}`)
    assert.deepEqual(
      built.filter((file) => !/\.(js|d\.ts)$/.test(file)),
      [],
      "dist/ holds something besides JavaScript and its declarations"
    )
    assert.deepEqual(
      packed.files.filter((file) => !file.startsWith("dist/")),
      ["config/agentic.config.schema.json", "config/references.schema.json", "package.json", "templates/router.md"]
    )
  })

  it("names the built bin and exports in its manifest, each one in the tarball, and no runtime dependency", () => {
    assert.deepEqual(packed.manifest["bin"], { "dw-sdlc": "dist/cli.js" })
    const named = [...namedPaths(packed.manifest["bin"]), ...namedPaths(packed.manifest["exports"])]
    assert.deepEqual(
      named.filter((file) => !packed.files.includes(file)),
      [],
      "the manifest names a file the tarball lacks"
    )
    assert.deepEqual(
      named.filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts")),
      [],
      "the manifest names a TypeScript source file"
    )
    assert.ok(!("dependencies" in packed.manifest), "the packed manifest declares runtime dependencies")
  })

  describe("installed into a throwaway repository", () => {
    let consumer: string
    before(() => {
      consumer = repo({
        files: {
          "package.json": { name: "consumer", private: true },
          [CONFIG]: { $schema: `../${INSTALLED_SCHEMA}`, version: 1, gate: { steps: ["true"] } }
        }
      })
      succeeded(
        "pnpm add",
        runCommand("pnpm", ["add", "--save-dev", packed.tarball, "--store-dir", scratch("store")], consumer)
      )
    })

    it("runs dw-sdlc gate from node_modules on the consumer's config", () => {
      assert.ok(existsSync(join(consumer, INSTALLED_SCHEMA)), "the schema is not where $schema points")
      const gate = runCommand(join(consumer, INSTALLED_BIN), ["gate"], consumer)
      assert.equal(gate.status, 0, gate.stderr)
      assert.deepEqual(lines(gate.stdout), ["gate: step true", "gate: green — 1 step, 0 checks"])
    })

    it("exports the config resolver as JavaScript", () => {
      const script = `const { resolveConfig } = await import("dw-sdlc")
console.log(JSON.stringify(resolveConfig(process.cwd()).config.gate.steps))`
      const imported = runCommand(process.execPath, ["--input-type=module", "--eval", script], consumer)
      assert.equal(imported.status, 0, imported.stderr)
      assert.equal(imported.stdout, '["true"]\n')
    })
  })
})
