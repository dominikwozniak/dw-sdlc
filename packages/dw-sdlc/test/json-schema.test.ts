import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { SchemaError, validate } from "../src/json-schema.ts"
import { CASES } from "./schema-cases.ts"

describe("validate", () => {
  for (const { name, schema, value, problems } of CASES) {
    it(name, () => {
      assert.deepEqual(validate(schema, value), problems)
    })
  }

  it("throws on a keyword outside the subset instead of ignoring it", () => {
    assert.throws(() => validate({ properties: { a: { oneOf: [] } } }, { a: 1 }), SchemaError)
    assert.throws(() => validate({ $defs: {} }, 1), SchemaError)
  })

  it("throws on a malformed operand", () => {
    assert.throws(() => validate({ type: "strnig" }, 1), SchemaError)
    assert.throws(() => validate({ enum: "a" }, 1), SchemaError)
    assert.throws(() => validate({ format: "email" }, "x"), SchemaError)
    assert.throws(() => validate("string", 1), SchemaError)
  })
})
