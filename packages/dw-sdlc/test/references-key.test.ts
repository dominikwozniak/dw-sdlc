// The contract of `.ai/references.json`: one case list through the parser the Sync runs and through
// the schema the package ships beside it, so the two never drift apart. The schema side runs on the
// package's validator here only; the Sync reads the file through the parser alone.

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { validate } from "../src/json-schema.ts"
import { parseFile, parseReferences } from "../src/references-key.ts"

const SCHEMA: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "config", "references.schema.json"), "utf8")
)

function entry(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dir: "kody",
    repository: "https://github.com/kody-hq/kody",
    ref: "main",
    what: "an agent cloud",
    when: "harness engineering",
    ...fields
  }
}

function without(field: string): Record<string, unknown> {
  const fields = entry()
  delete fields[field]
  return fields
}

/** The problem the parser names in `value`, or what it parsed. */
function problemOf(value: unknown): unknown {
  const parsed = parseReferences(value)
  return "problem" in parsed ? parsed.problem : parsed
}

/** The file holding `references`. */
function file(references: unknown): Record<string, unknown> {
  return { $schema: "../node_modules/dw-sdlc/config/references.schema.json", version: 1, references }
}

/** A value of the file's `references` key, and the path of its one problem; none when it is valid. */
type Case = { name: string; value: unknown; path?: string }

const CASES: Case[] = [
  { name: "an empty list", value: [] },
  { name: "an entry without skip", value: [entry()] },
  { name: "an empty skip", value: [entry({ skip: [] })] },
  { name: "nested skip paths", value: [entry({ skip: ["repos/", "packages/worker/src"] })] },
  { name: "a ref naming a package", value: [entry({ ref: "v{@scope/pkg}" })] },
  { name: "an scp-like repository", value: [entry({ repository: "git@github.com:kody-hq/kody.git" })] },
  { name: "a file URL", value: [entry({ repository: "file:///tmp/upstream" })] },
  { name: "a dir with a dot", value: [entry({ dir: "effect.ts" })] },
  { name: "a key that is not a list", value: { kody: entry() }, path: "references" },
  { name: "an entry that is not an object", value: ["kody"], path: "references[0]" },
  { name: "an unknown field", value: [entry({ branch: "main" })], path: "references[0]" },
  { name: "a missing field", value: [without("what")], path: "references[0]" },
  { name: "a dir that is not a string", value: [entry({ dir: 7 })], path: "references[0].dir" },
  { name: "a dir with a slash", value: [entry({ dir: "a/b" })], path: "references[0].dir" },
  { name: "a dir of ..", value: [entry({ dir: ".." })], path: "references[0].dir" },
  { name: "a hidden dir", value: [entry({ dir: ".cache" })], path: "references[0].dir" },
  { name: "an empty dir", value: [entry({ dir: "" })], path: "references[0].dir" },
  { name: "an empty repository", value: [entry({ repository: "" })], path: "references[0].repository" },
  {
    name: "a repository git would read as an option",
    value: [entry({ repository: "--upload-pack=touch" })],
    path: "references[0].repository"
  },
  {
    name: "a repository with a space",
    value: [entry({ repository: "https://x/a b" })],
    path: "references[0].repository"
  },
  { name: "a ref git would read as an option", value: [entry({ ref: "--upload-pack=x" })], path: "references[0].ref" },
  { name: "an empty ref", value: [entry({ ref: "" })], path: "references[0].ref" },
  { name: "a skip that is not a list", value: [entry({ skip: "repos/" })], path: "references[0].skip" },
  { name: "an absolute skip path", value: [entry({ skip: ["/repos"] })], path: "references[0].skip[0]" },
  {
    name: "a skip path that leaves the clone",
    value: [entry({ skip: ["ok/", "../x"] })],
    path: "references[0].skip[1]"
  },
  { name: "a skip path through ..", value: [entry({ skip: ["a/../../b"] })], path: "references[0].skip[0]" },
  { name: "a skip path ending in ..", value: [entry({ skip: ["a/.."] })], path: "references[0].skip[0]" },
  { name: "an empty skip path", value: [entry({ skip: [""] })], path: "references[0].skip[0]" },
  { name: "a skip path that is not a string", value: [entry({ skip: [1] })], path: "references[0].skip[0]" },
  { name: "only paths", value: [entry({ only: ["pstack/", "harness/pstack/", "docs/guide.md"] })] },
  {
    name: "only paths with a skip inside one",
    value: [entry({ only: ["pstack/", "harness/pstack/"], skip: ["pstack/vendor/"] })]
  },
  { name: "an only that is not a list", value: [entry({ only: "pstack/" })], path: "references[0].only" },
  { name: "an empty only", value: [entry({ only: [] })], path: "references[0].only" },
  { name: "an absolute only path", value: [entry({ only: ["/pstack/"] })], path: "references[0].only[0]" },
  {
    name: "an only path through ..",
    value: [entry({ only: ["pstack/", "harness/../../x"] })],
    path: "references[0].only[1]"
  },
  { name: "an empty only path", value: [entry({ only: [""] })], path: "references[0].only[0]" },
  { name: "an empty what", value: [entry({ what: "" })], path: "references[0].what" },
  { name: "a when that is not a string", value: [entry({ when: ["x"] })], path: "references[0].when" },
  {
    name: "a bad second entry",
    value: [entry(), entry({ dir: "other", ref: "-x" })],
    path: "references[1].ref"
  }
]

describe("the parser and the schema agree on one case list", () => {
  for (const { name, value, path } of CASES) {
    it(name, () => {
      const schemaPaths = validate(SCHEMA, file(value)).map((problem) => problem.path)
      assert.deepEqual(schemaPaths, path === undefined ? [] : [path], "the schema")
      const parsed = parseFile(file(value))
      assert.equal("problem" in parsed ? parsed.problem.path : undefined, path, JSON.stringify(parsed))
    })
  }
})

describe("parseReferences", () => {
  it("reads each entry, an absent only or skip as none", () => {
    const parsed = parseReferences([
      entry(),
      entry({ dir: "dw-mc", skip: ["repos/"] }),
      entry({ dir: "pstack", only: ["pstack/", "harness/pstack"], skip: ["pstack/vendor/"] })
    ])
    assert.deepEqual(parsed, {
      references: [
        {
          dir: "kody",
          repository: "https://github.com/kody-hq/kody",
          ref: "main",
          only: [],
          skip: [],
          what: "an agent cloud",
          when: "harness engineering"
        },
        {
          dir: "dw-mc",
          repository: "https://github.com/kody-hq/kody",
          ref: "main",
          only: [],
          skip: ["repos/"],
          what: "an agent cloud",
          when: "harness engineering"
        },
        {
          dir: "pstack",
          repository: "https://github.com/kody-hq/kody",
          ref: "main",
          only: ["pstack/", "harness/pstack"],
          skip: ["pstack/vendor/"],
          what: "an agent cloud",
          when: "harness engineering"
        }
      ]
    })
  })

  it("refuses a dir another entry holds, which the schema cannot say", () => {
    const value = [entry(), entry({ dir: "kody" })]
    assert.deepEqual(validate(SCHEMA, file(value)), [])
    assert.deepEqual(parseReferences(value), {
      problem: { path: "references[1].dir", message: '"kody" is the dir of references[0] too' }
    })
  })

  it("refuses a skip path outside every only path, which the schema cannot say", () => {
    for (const outside of ["docs/", "pstack", "pstack/", "pstackish/x", "harness/x"]) {
      const value = [entry({ only: ["pstack/", "harness/pstack"], skip: ["pstack/vendor/", outside] })]
      assert.deepEqual(validate(SCHEMA, file(value)), [], outside)
      assert.deepEqual(parseReferences(value), {
        problem: {
          path: "references[0].skip[1]",
          message: `${JSON.stringify(outside)} must lie inside one of the only paths`
        }
      })
    }
    const inside = parseReferences([entry({ only: ["pstack/", "harness/pstack"], skip: ["harness/pstack/x"] })])
    assert.ok("references" in inside, JSON.stringify(inside))
  })

  it("names the field and the reason", () => {
    assert.deepEqual(problemOf([entry({ branch: "main" })]), {
      path: "references[0]",
      message: 'unknown field "branch"'
    })
    assert.deepEqual(problemOf([without("when")]), { path: "references[0]", message: 'missing field "when"' })
    assert.deepEqual(problemOf([entry({ skip: ["../x"] })]), {
      path: "references[0].skip[0]",
      message: '"../x" must be relative to the clone and stay inside it'
    })
    assert.deepEqual(problemOf({}), { path: "references", message: "must be a list of entries, not an object" })
  })
})

/** A whole file, and the path of its one problem, `""` for its root. */
const FILE_CASES: { name: string; value: unknown; path?: string }[] = [
  { name: "a file without $schema", value: { version: 1, references: [] } },
  { name: "a file that is not an object", value: [], path: "" },
  { name: "an unknown key", value: { ...file([]), extra: true }, path: "" },
  { name: "a missing version", value: { references: [] }, path: "" },
  { name: "a missing references key", value: { version: 1 }, path: "" },
  { name: "a version other than 1", value: { ...file([]), version: 2 }, path: "version" },
  { name: "a $schema that is not a string", value: { ...file([]), $schema: 1 }, path: "$schema" }
]

describe("the parser and the schema agree on the file around the key", () => {
  for (const { name, value, path } of FILE_CASES) {
    it(name, () => {
      const schemaPaths = validate(SCHEMA, value).map((problem) => problem.path)
      assert.deepEqual(schemaPaths, path === undefined ? [] : [path], "the schema")
      const parsed = parseFile(value)
      assert.equal("problem" in parsed ? parsed.problem.path : undefined, path, JSON.stringify(parsed))
    })
  }
})
