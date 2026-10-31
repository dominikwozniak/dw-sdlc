// The one case list both validators answer: `validate` here and the sdlc plugin's
// `hooks/schema.jq`, whose test reads this file through the plugin's link.

import { readFileSync } from "node:fs"

import { COMMIT_PATTERNS, SCHEMA_PATH } from "../src/agentic-config.ts"

export type Case = { name: string; schema: unknown; value: unknown; problems: { path: string; message: string }[] }

/** The shipped agentic config schema, for the cases on the keys it names. */
const AGENTIC_SCHEMA: unknown = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"))
const RUN_CHECK = { name: "docs-fresh", command: "node scripts/docs-fresh.ts" }

export const CASES: Case[] = [
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
  ...[
    ["^\\d+", "\\d"],
    ["^\\D", "\\D"],
    ["^a\\sb", "\\s"],
    ["^\\w+$", "\\w"],
    ["\\bfix\\b", "\\b"],
    ["^(?:fix|feat): ", "(?"],
    ["^x\\\\\\s", "\\s"],
    ["^[a](?:x)", "(?"],
    ["^[]x]\\d", "\\d"],
    ["^[[:alpha:]]\\d", "\\d"]
  ].map(([value, construct]) => ({
    name: `format regex refuses ${construct} in ${value}, which grep -E reads differently by platform`,
    schema: { format: "regex" },
    value,
    problems: [
      {
        path: "",
        message: `${JSON.stringify(value)} uses ${construct}, which POSIX ERE lacks; grep -E runs the pattern`
      }
    ]
  })),
  {
    name: "format regex takes an escaped backslash before d",
    schema: { format: "regex" },
    value: "^\\\\d",
    problems: []
  },
  {
    name: "format regex takes an escaped paren before ?",
    schema: { format: "regex" },
    value: "^fix\\(?",
    problems: []
  },
  // Inside a bracket expression `(`, `?` and a backslash are plain characters.
  ...["^[(?]fix: .+", "^[^(?]x", "^[]\\d]x", "^[[:alpha:]\\d]x"].map((value) => ({
    name: `format regex takes the bracket expression in ${value}`,
    schema: { format: "regex" },
    value,
    problems: []
  })),
  ...Object.entries(COMMIT_PATTERNS).map(([convention, value]) => ({
    name: `format regex takes the ${convention} preset`,
    schema: { format: "regex" },
    value,
    problems: []
  })),
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
    name: "the agentic schema takes gate.command, gate.steps and gate.checks.run",
    schema: AGENTIC_SCHEMA,
    value: { version: 1, gate: { command: "pnpm check", steps: ["pnpm lint"], checks: { run: [RUN_CHECK] } } },
    problems: []
  },
  {
    name: "the agentic schema tolerates a validation key as an unknown top-level key",
    schema: AGENTIC_SCHEMA,
    value: { version: 1, validation: { commands: ["pnpm check"] } },
    problems: []
  },
  {
    name: "the agentic schema takes pr.merge auto or ask",
    schema: AGENTIC_SCHEMA,
    value: { pr: { merge: "auto" } },
    problems: []
  },
  {
    name: "the agentic schema refuses any other pr.merge and any other key under pr",
    schema: AGENTIC_SCHEMA,
    value: { pr: { merge: "yes", method: "squash" } },
    problems: [
      { path: "pr.merge", message: '"yes" is not one of "ask", "auto"' },
      { path: "pr", message: 'unknown key "method"' }
    ]
  },
  {
    name: "the agentic schema refuses a Check name the package does not ship",
    schema: AGENTIC_SCHEMA,
    value: { gate: { checks: { "no-such-check": true } } },
    problems: [{ path: "gate.checks", message: 'unknown key "no-such-check"' }]
  },
  {
    name: "the agentic schema refuses an unknown key under gate and in a run entry",
    schema: AGENTIC_SCHEMA,
    value: { gate: { parallel: true, checks: { run: [{ ...RUN_CHECK, timeout: 60 }] } } },
    problems: [
      { path: "gate.checks.run[0]", message: 'unknown key "timeout"' },
      { path: "gate", message: 'unknown key "parallel"' }
    ]
  },
  {
    name: "the agentic schema needs a run entry's name and command, the name in kebab case",
    schema: AGENTIC_SCHEMA,
    value: { gate: { checks: { run: [{ name: "Docs fresh" }] } } },
    problems: [
      { path: "gate.checks.run[0].name", message: '"Docs fresh" does not match /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/' },
      { path: "gate.checks.run[0]", message: 'missing required key "command"' }
    ]
  },
  {
    name: "the agentic schema takes a Check the package ships as true, false or its options",
    schema: AGENTIC_SCHEMA,
    value: {
      gate: {
        checks: {
          primitives: { file: ".ai/primitives.json", roots: ["src", "scripts"] },
          "agents-map": { file: "AGENTS.md", maxLines: 120, maxBytes: 8192 },
          "markdown-budget": { budgets: [{ glob: "docs/agents/*.md", maxLines: 80, maxBytes: 4096 }] },
          "markdown-refs": { files: ["**/*.md"], exempt: ["vendor/**"] },
          "temporal-language": { files: ["docs/**/*.md"], exempt: ["docs/adr/**"] },
          "decision-records": { dirs: ["docs/decisions"], statuses: ["active", "superseded"] }
        }
      }
    },
    problems: []
  },
  {
    name: "the agentic schema needs every key of a markdown budget and refuses one it does not take",
    schema: AGENTIC_SCHEMA,
    value: {
      gate: {
        checks: {
          "markdown-budget": {
            budgets: [
              { glob: "docs/*.md", maxLines: 0 },
              { glob: "", maxLines: 1, maxBytes: 1, words: 9 }
            ]
          },
          "markdown-refs": { files: "**/*.md" },
          "temporal-language": { exempt: ["docs/adr/**", "docs/adr/**"], phrases: [] },
          "decision-records": { dirs: [""], statuses: "accepted" }
        }
      }
    },
    problems: [
      { path: "gate.checks.markdown-budget.budgets[0].maxLines", message: "0 is below the minimum 1" },
      { path: "gate.checks.markdown-budget.budgets[0]", message: 'missing required key "maxBytes"' },
      { path: "gate.checks.markdown-budget.budgets[1].glob", message: "must not be empty" },
      { path: "gate.checks.markdown-budget.budgets[1]", message: 'unknown key "words"' },
      { path: "gate.checks.markdown-refs.files", message: 'expected array, got "**/*.md"' },
      { path: "gate.checks.temporal-language.exempt", message: 'duplicate item "docs/adr/**"' },
      { path: "gate.checks.temporal-language", message: 'unknown key "phrases"' },
      { path: "gate.checks.decision-records.dirs[0]", message: "must not be empty" },
      { path: "gate.checks.decision-records.statuses", message: 'expected array, got "accepted"' }
    ]
  },
  {
    name: "the agentic schema refuses a Check's unknown option, a value of the wrong type and a budget below 1",
    schema: AGENTIC_SCHEMA,
    value: {
      gate: { checks: { primitives: { roots: "src", exempt: [] }, "agents-map": { maxLines: 0, maxBytes: 1.5 } } }
    },
    problems: [
      { path: "gate.checks.primitives.roots", message: 'expected array, got "src"' },
      { path: "gate.checks.primitives", message: 'unknown key "exempt"' },
      { path: "gate.checks.agents-map.maxLines", message: "0 is below the minimum 1" },
      { path: "gate.checks.agents-map.maxBytes", message: "expected integer, got 1.5" }
    ]
  },
  {
    name: "the agentic schema takes the file-size Ratchet's groups and the comment budget's options",
    schema: AGENTIC_SCHEMA,
    value: {
      gate: {
        checks: {
          "file-size-ratchet": { groups: [{ name: "source", maxLines: 500, files: ["src/**/*.ts"] }] },
          "comment-budget": { maxProseLines: 3, roots: ["src"] }
        }
      }
    },
    problems: []
  },
  {
    name: "the agentic schema refuses a group without its files, with an unknown key or a limit below 1",
    schema: AGENTIC_SCHEMA,
    value: {
      gate: {
        checks: {
          "file-size-ratchet": {
            groups: [
              { name: "Source", maxLines: 0, files: [] },
              { name: "tests", maxLines: 2000, glob: "**/*.test.ts" }
            ]
          },
          "comment-budget": { maxProseLines: 0, dirs: ["src"] }
        }
      }
    },
    problems: [
      {
        path: "gate.checks.file-size-ratchet.groups[0].name",
        message: '"Source" does not match /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/'
      },
      { path: "gate.checks.file-size-ratchet.groups[0].maxLines", message: "0 is below the minimum 1" },
      { path: "gate.checks.file-size-ratchet.groups[0].files", message: "has 0 items, needs at least 1" },
      { path: "gate.checks.file-size-ratchet.groups[1]", message: 'missing required key "files"' },
      { path: "gate.checks.file-size-ratchet.groups[1]", message: 'unknown key "glob"' },
      { path: "gate.checks.comment-budget.maxProseLines", message: "0 is below the minimum 1" },
      { path: "gate.checks.comment-budget", message: 'unknown key "dirs"' }
    ]
  },
  {
    name: "the agentic schema refuses a Check set to neither a boolean nor an object",
    schema: AGENTIC_SCHEMA,
    value: { gate: { checks: { primitives: false, "agents-map": "yes" } } },
    problems: [{ path: "gate.checks.agents-map", message: 'expected boolean or object, got "yes"' }]
  },
  {
    name: "the agentic schema refuses an empty step and an empty Gate command",
    schema: AGENTIC_SCHEMA,
    value: { gate: { command: "", steps: ["pnpm lint", ""] } },
    problems: [
      { path: "gate.command", message: "must not be empty" },
      { path: "gate.steps[1]", message: "must not be empty" }
    ]
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
