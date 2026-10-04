import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { describe, it } from "node:test"

import { SchemaError, validate } from "../../scripts/json-schema.ts"

type Case = { name: string; schema: unknown; value: unknown; problems: { path: string; message: string }[] }

const CASES: Case[] = [
  { name: "type accepts a match", schema: { type: "string" }, value: "x", problems: [] },
  {
    name: "type names the mismatch",
    schema: { type: "string" },
    value: 3,
    problems: [{ path: "", message: "expected string, got 3" }]
  },
  { name: "type takes a list", schema: { type: ["string", "null"] }, value: null, problems: [] },
  {
    name: "integer refuses a fraction",
    schema: { type: "integer" },
    value: 1.5,
    problems: [{ path: "", message: "expected integer, got 1.5" }]
  },
  { name: "enum accepts a member", schema: { enum: ["a", "b"] }, value: "b", problems: [] },
  {
    name: "enum lists the members",
    schema: { enum: ["a", "b"] },
    value: "c",
    problems: [{ path: "", message: '"c" is not one of "a", "b"' }]
  },
  { name: "const", schema: { const: 1 }, value: 2, problems: [{ path: "", message: "2 is not 1" }] },
  {
    name: "properties descend with a dotted path",
    schema: { properties: { a: { properties: { b: { type: "number" } } } } },
    value: { a: { b: "x" } },
    problems: [{ path: "a.b", message: 'expected number, got "x"' }]
  },
  {
    name: "required names the missing key at the object",
    schema: { properties: { a: { required: ["b"] } } },
    value: { a: {} },
    problems: [{ path: "a", message: 'missing required key "b"' }]
  },
  {
    name: "additionalProperties false refuses an unknown key",
    schema: { properties: { a: {} }, additionalProperties: false },
    value: { a: 1, b: 2 },
    problems: [{ path: "", message: 'unknown key "b"' }]
  },
  {
    name: "additionalProperties as a schema validates the extra keys",
    schema: { properties: { a: {} }, additionalProperties: { type: "string" } },
    value: { a: 1, b: 2 },
    problems: [{ path: "b", message: "expected string, got 2" }]
  },
  {
    name: "items index each element",
    schema: { items: { type: "string" } },
    value: ["a", 1],
    problems: [{ path: "[1]", message: "expected string, got 1" }]
  },
  {
    name: "uniqueItems",
    schema: { uniqueItems: true },
    value: ["a", "b", "a"],
    problems: [{ path: "", message: 'duplicate item "a"' }]
  },
  {
    name: "minItems",
    schema: { minItems: 2 },
    value: [1],
    problems: [{ path: "", message: "has 1 item, needs at least 2" }]
  },
  {
    name: "minLength 1 reads as empty",
    schema: { minLength: 1 },
    value: "",
    problems: [{ path: "", message: "must not be empty" }]
  },
  {
    name: "minLength above 1 gives the count",
    schema: { minLength: 3 },
    value: "ab",
    problems: [{ path: "", message: '"ab" is shorter than 3 characters' }]
  },
  {
    name: "pattern",
    schema: { pattern: "^[a-z]+$" },
    value: "A1",
    problems: [{ path: "", message: '"A1" does not match /^[a-z]+$/' }]
  },
  { name: "format regex accepts a valid expression", schema: { format: "regex" }, value: "^a(b|c)$", problems: [] },
  {
    name: "format regex refuses a broken one",
    schema: { format: "regex" },
    value: "(",
    problems: [{ path: "", message: '"(" is not a valid regular expression' }]
  },
  { name: "minimum", schema: { minimum: 1 }, value: 0, problems: [{ path: "", message: "0 is below the minimum 1" }] },
  { name: "true accepts anything", schema: true, value: { any: [1] }, problems: [] },
  { name: "false refuses anything", schema: false, value: 1, problems: [{ path: "", message: "is not allowed here" }] },
  {
    name: "annotations are ignored",
    schema: { $schema: "x", $id: "y", title: "t", description: "d", default: 1, examples: [1], $comment: "c" },
    value: "anything",
    problems: []
  },
  {
    name: "keywords that only apply to another type are skipped",
    schema: {
      properties: { a: {} },
      required: ["a"],
      additionalProperties: false,
      items: false,
      minItems: 1,
      minLength: 9
    },
    value: 42,
    problems: []
  }
]

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
