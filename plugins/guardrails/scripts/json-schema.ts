// The subset of JSON Schema draft 2020-12 the shipped schemas use, validated without a dependency: Node
// has no validator built in, and a config file does not justify pulling one in. A keyword outside the
// subset throws instead of passing silently, so a schema never promises more than this file enforces.
// `format` is enforced, not annotative: `regex` is the one format, compiled with `RegExp` and refused
// when it holds a construct POSIX ERE lacks, because `grep -E` runs the pattern and BSD and GNU grep
// read those differently. `enum` and `const` compare by JSON text, exact for the scalars and arrays
// the schemas use.

export type SchemaProblem = { path: string; message: string }

export class SchemaError extends Error {}

type JsonObject = { [key: string]: unknown }

const ANNOTATIONS = new Set(["$schema", "$id", "$comment", "title", "description", "default", "examples"])

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function show(value: unknown): string {
  return value === undefined ? "undefined" : JSON.stringify(value)
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function at(path: string): string {
  return path === "" ? "(root)" : path
}

function child(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`
}

function operandMust(condition: boolean, path: string, keyword: string, expectation: string): void {
  if (!condition) {
    throw new SchemaError(`${at(path)}: ${keyword} must be ${expectation}`)
  }
}

function typeMatches(value: unknown, type: unknown, path: string): boolean {
  switch (type) {
    case "object":
      return isObject(value)
    case "array":
      return Array.isArray(value)
    case "string":
      return typeof value === "string"
    case "number":
      return typeof value === "number"
    case "integer":
      return Number.isInteger(value)
    case "boolean":
      return typeof value === "boolean"
    case "null":
      return value === null
    default:
      throw new SchemaError(`${at(path)}: unknown type ${show(type)}`)
  }
}

// `\d`, `\s`, `\w`, `\b`, their capitals and a `(?` group, each behind an even run of backslashes.
const NOT_ERE = /(?:^|[^\\])(?:\\\\)*(\\[dDsSwWbB]|\(\?)/

function compile(value: string): RegExp | undefined {
  try {
    return new RegExp(value)
  } catch {
    return undefined
  }
}

/** Every problem in `value` against `schema`, in schema order; empty when it validates. */
export function validate(schema: unknown, value: unknown): SchemaProblem[] {
  const problems: SchemaProblem[] = []
  check(schema, value, "", problems)
  return problems
}

function check(schema: unknown, value: unknown, path: string, problems: SchemaProblem[]): void {
  if (schema === true) {
    return
  }
  if (schema === false) {
    problems.push({ path, message: "is not allowed here" })
    return
  }
  if (!isObject(schema)) {
    throw new SchemaError(`${at(path)}: a schema must be an object or a boolean`)
  }
  for (const [keyword, operand] of Object.entries(schema)) {
    checkKeyword(schema, keyword, operand, value, path, problems)
  }
}

function checkKeyword(
  schema: JsonObject,
  keyword: string,
  operand: unknown,
  value: unknown,
  path: string,
  problems: SchemaProblem[]
): void {
  switch (keyword) {
    case "type": {
      const types = Array.isArray(operand) ? operand : [operand]
      if (!types.some((type) => typeMatches(value, type, path))) {
        problems.push({ path, message: `expected ${types.join(" or ")}, got ${show(value)}` })
      }
      return
    }
    case "enum": {
      operandMust(Array.isArray(operand), path, keyword, "an array")
      const members = Array.isArray(operand) ? operand : []
      if (!members.some((member) => sameJson(member, value))) {
        problems.push({ path, message: `${show(value)} is not one of ${members.map(show).join(", ")}` })
      }
      return
    }
    case "const": {
      if (!sameJson(operand, value)) {
        problems.push({ path, message: `${show(value)} is not ${show(operand)}` })
      }
      return
    }
    case "properties": {
      operandMust(isObject(operand), path, keyword, "an object")
      if (!isObject(operand) || !isObject(value)) {
        return
      }
      for (const [key, subschema] of Object.entries(operand)) {
        if (Object.hasOwn(value, key)) {
          check(subschema, value[key], child(path, key), problems)
        }
      }
      return
    }
    case "required": {
      operandMust(Array.isArray(operand) && operand.every((key) => typeof key === "string"), path, keyword, "string[]")
      if (!Array.isArray(operand) || !isObject(value)) {
        return
      }
      for (const key of operand) {
        if (!Object.hasOwn(value, String(key))) {
          problems.push({ path, message: `missing required key ${show(key)}` })
        }
      }
      return
    }
    case "additionalProperties": {
      if (!isObject(value)) {
        return
      }
      const declared = isObject(schema.properties) ? schema.properties : {}
      for (const [key, member] of Object.entries(value)) {
        if (Object.hasOwn(declared, key)) {
          continue
        }
        if (operand === false) {
          problems.push({ path, message: `unknown key ${show(key)}` })
        } else if (operand !== true) {
          check(operand, member, child(path, key), problems)
        }
      }
      return
    }
    case "items": {
      if (Array.isArray(value)) {
        value.forEach((element, index) => check(operand, element, `${path}[${index}]`, problems))
      }
      return
    }
    case "uniqueItems": {
      if (operand !== true || !Array.isArray(value)) {
        return
      }
      const seen = new Set<string>()
      for (const element of value) {
        const text = JSON.stringify(element)
        if (seen.has(text)) {
          problems.push({ path, message: `duplicate item ${text}` })
        }
        seen.add(text)
      }
      return
    }
    case "minItems": {
      operandMust(typeof operand === "number", path, keyword, "a number")
      if (Array.isArray(value) && typeof operand === "number" && value.length < operand) {
        const noun = value.length === 1 ? "item" : "items"
        problems.push({ path, message: `has ${value.length} ${noun}, needs at least ${operand}` })
      }
      return
    }
    case "minLength": {
      operandMust(typeof operand === "number", path, keyword, "a number")
      if (typeof value !== "string" || typeof operand !== "number" || value.length >= operand) {
        return
      }
      const message = operand === 1 ? "must not be empty" : `${show(value)} is shorter than ${operand} characters`
      problems.push({ path, message })
      return
    }
    case "pattern": {
      operandMust(typeof operand === "string", path, keyword, "a string")
      if (typeof value === "string" && typeof operand === "string" && !new RegExp(operand).test(value)) {
        problems.push({ path, message: `${show(value)} does not match /${operand}/` })
      }
      return
    }
    case "format": {
      operandMust(operand === "regex", path, keyword, '"regex", the one format enforced here')
      if (typeof value !== "string") {
        return
      }
      const construct = NOT_ERE.exec(value)?.[1]
      if (compile(value) === undefined) {
        problems.push({ path, message: `${show(value)} is not a valid regular expression` })
      } else if (construct !== undefined) {
        problems.push({
          path,
          message: `${show(value)} uses ${construct}, which POSIX ERE lacks; grep -E runs the pattern`
        })
      }
      return
    }
    case "minimum": {
      operandMust(typeof operand === "number", path, keyword, "a number")
      if (typeof value === "number" && typeof operand === "number" && value < operand) {
        problems.push({ path, message: `${show(value)} is below the minimum ${operand}` })
      }
      return
    }
    default: {
      if (!ANNOTATIONS.has(keyword)) {
        throw new SchemaError(`${at(path)}: unsupported keyword ${show(keyword)}`)
      }
    }
  }
}
