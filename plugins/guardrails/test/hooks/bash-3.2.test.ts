// The half of the bash 3.2 proof that CI runs: the hook tests there run on bash 5, where a bash 4
// construct passes, so this file reads every hook's code lines and holds those constructs out. `|&`
// and `;&` stay out of the list: the guards match them as text, which a source scan cannot tell apart.

import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { HOOKS_DIR } from "../harness.ts"

type Construct = { name: string; pattern: RegExp; caught: string[]; passed: string[] }

/** A parameter name with an optional subscript, as it opens a `${…}` expansion. */
const PARAMETER = String.raw`[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?`

const CONSTRUCTS: Construct[] = [
  {
    name: "associative array or nameref",
    pattern: /\b(?:declare|local|typeset)(?:\s+-[A-Za-z]+)*\s+-[A-Za-z]*[An]/,
    caught: ["declare -A seen", "local -n ref=$1", "declare -gA map", "typeset -r -n x"],
    passed: ["local -a parts", "declare -r MAX=3", "local name", "declare -i n"]
  },
  {
    name: "mapfile or readarray",
    pattern: /\b(?:mapfile|readarray)\b/,
    caught: ["mapfile -t lines <f", "readarray x"],
    passed: ["read -r line"]
  },
  {
    name: "case modification",
    pattern: new RegExp(String.raw`\$\{${PARAMETER}[,^]`),
    caught: ["${x,,}", "${x,}", "${x^^}", "${x^}", "${a[0],,}"],
    passed: ["${x:-a,b}", "${x//,/ }", "${#x}", "${x#^}"]
  },
  {
    name: "transformation",
    pattern: new RegExp(String.raw`\$\{${PARAMETER}@[A-Za-z]\}`),
    caught: ["${x@Q}", "${a[@]@Q}"],
    passed: ["${a[@]}", "${@}", "$@"]
  },
  {
    name: "coproc",
    pattern: /\bcoproc\b/,
    caught: ["coproc cat"],
    passed: ["proc=1"]
  },
  {
    name: "&>>",
    pattern: /&>>/,
    caught: ["cmd &>>log"],
    passed: ["cmd >>log 2>&1", "cmd &>log"]
  },
  {
    name: "negative subscript",
    pattern: /\$\{[A-Za-z_][A-Za-z0-9_]*\[\s*-/,
    caught: ["${a[-1]}", "${a[ -2]}"],
    passed: ["${a[0]}", "${a[@]: -1}", "${x:-1}"]
  }
]

/** A hook's lines by number, with a whole-line comment and a `#` after a blank, and all past it, dropped. */
function codeLines(text: string): Array<{ line: number; code: string }> {
  return text.split("\n").map((raw, index) => ({ line: index + 1, code: raw.replace(/(?:^|\s+)#.*$/, "") }))
}

const HOOKS = readdirSync(HOOKS_DIR)
  .filter((name) => name.endsWith(".sh"))
  .map((name) => ({ name, lines: codeLines(readFileSync(join(HOOKS_DIR, name), "utf8")) }))

describe("the hooks' code holds no bash 4 construct", () => {
  it("reads every hook", () => {
    assert.ok(HOOKS.some(({ name }) => name === "bash-guard.sh"))
  })
  for (const { name, pattern } of CONSTRUCTS) {
    it(`no ${name}`, () => {
      const found = HOOKS.flatMap((hook) =>
        hook.lines
          .filter(({ code }) => pattern.test(code))
          .map(({ line, code }) => `${hook.name}:${line}: ${code.trim()}`)
      )
      assert.deepEqual(found, [])
    })
  }
})

describe("each construct's pattern reads its spellings and nothing near them", () => {
  it("a comment is not code", () => {
    const lines = codeLines("#!/bin/bash\n  # mapfile\nn=${#x} # readarray\n")
    assert.deepEqual(
      lines.map(({ code }) => code),
      ["", "", "n=${#x}", ""]
    )
  })
  for (const { name, pattern, caught, passed } of CONSTRUCTS) {
    it(name, () => {
      assert.deepEqual(
        caught.filter((code) => !pattern.test(code)),
        [],
        "a spelling the pattern misses"
      )
      assert.deepEqual(
        passed.filter((code) => pattern.test(code)),
        [],
        "a near miss the pattern catches"
      )
    })
  }
})
