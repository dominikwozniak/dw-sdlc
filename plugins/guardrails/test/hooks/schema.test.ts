// hooks/schema.jq against the case list the dw-sdlc package's `validate` answers, read through the
// plugin's link.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { describe, it } from "node:test"

import { CASES } from "../../dw-sdlc/test/schema-cases.ts"

const JQ_MODULES = join(import.meta.dirname, "..", "..", "hooks")

/** The same validation through hooks/schema.jq, the copy the guards run. */
function jqValidate(schema: unknown, value: unknown): { problems: unknown } | { error: string } {
  const filter = 'include "schema"; $value | validate($schema)'
  const args = [
    "-cn",
    "-L",
    JQ_MODULES,
    "--argjson",
    "schema",
    JSON.stringify(schema),
    "--argjson",
    "value",
    JSON.stringify(value),
    filter
  ]
  const result = spawnSync("jq", args, { encoding: "utf8" })
  if (result.error !== undefined) {
    throw new Error(`jq is required to test hooks/schema.jq: ${result.error.message}`)
  }
  if (result.status !== 0) {
    return { error: result.stderr.trim() }
  }
  return { problems: JSON.parse(result.stdout) }
}

describe("hooks/schema.jq agrees with validate", () => {
  for (const { name, schema, value, problems } of CASES) {
    it(name, () => {
      assert.deepEqual(jqValidate(schema, value), { problems })
    })
  }

  it("fails where validate throws", () => {
    const broken: [unknown, unknown][] = [
      [{ properties: { a: { oneOf: [] } } }, { a: 1 }],
      [{ $defs: {} }, 1],
      [{ type: "strnig" }, 1],
      [{ enum: "a" }, 1],
      [{ format: "email" }, "x"],
      ["string", 1]
    ]
    for (const [schema, value] of broken) {
      assert.ok("error" in jqValidate(schema, value), JSON.stringify(schema))
    }
  })
})
