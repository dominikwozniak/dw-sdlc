// The `comment-budget` Check through `dw-sdlc gate`, on a throwaway repository whose source carries
// one comment block at a time: the exit code and each failure line word for word.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { lines, repo, runBin } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"

/** A repository with `files` and the Check set to `setting`. */
function withBudget(files: Record<string, string>, setting: unknown = true): string {
  return repo({ files: { [CONFIG]: { version: 1, gate: { checks: { "comment-budget": setting } } }, ...files } })
}

/** The failure lines of a Gate run that ran the one Check, its own `gate: check` line and the verdict cut. */
function failures(stdout: string): string[] {
  return lines(stdout).slice(1, -1)
}

/** `count` lines of `//` prose. */
function slashes(count: number): string {
  return Array.from({ length: count }, (_, index) => `// prose line ${index + 1}\n`).join("")
}

/** `count` lines of `#` prose. */
function hashes(count: number): string {
  return Array.from({ length: count }, (_, index) => `# prose line ${index + 1}\n`).join("")
}

const OVER = "cut it to what the code cannot say, or move the reasoning into a doc and point at it"

/**
 * A shell file whose line 1 leaves four `#` lines inside the string or heredoc `opener` starts, until
 * `closer` ends it, then a block of four. Read right, only that last block fails, on line 7 for a one-line closer.
 */
function trapped(opener: string, closer: string): string {
  return `${opener}\n${hashes(4)}${closer}\n${hashes(4)}`
}

/** The failure line of a block of `count` prose lines that starts at `at`, a `file:line`. */
function over(at: string, count = 4): string {
  return `${at}: comment-budget: a comment block of ${count} prose lines, over the 3-line budget — ${OVER}`
}

describe("the comment-budget Check", () => {
  it("passes a block of three prose lines", () => {
    const run = runBin(["gate"], withBudget({ "src/a.ts": `${slashes(3)}export const a = 1\n` }))
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: check comment-budget — pass", "gate: green — 0 steps, 1 check"])
  })

  it("fails a block of four prose lines with the file, the line it starts on and the count", () => {
    const run = runBin(["gate"], withBudget({ "src/a.ts": `export const a = 1\n\n${slashes(4)}export const b = 2\n` }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `src/a.ts:3: comment-budget: a comment block of 4 prose lines, over the 3-line budget — ${OVER}`
    ])
  })

  it("counts the prose of a /* */ block, not its delimiters or its blank lines", () => {
    const doc = "/**\n * One.\n *\n * Two.\n * Three.\n */\nexport const a = 1\n"
    const long = "  /* One.\n     Two.\n     Three.\n     Four. */\n"
    const run = runBin(["gate"], withBudget({ "src/doc.ts": doc, "src/long.js": `function f() {\n${long}}\n` }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `src/long.js:2: comment-budget: a comment block of 4 prose lines, over the 3-line budget — ${OVER}`
    ])
  })

  it("splits // lines at a blank line or a line of code, and leaves a comment after code out", () => {
    const source = [
      "// one",
      "// two",
      "",
      "// three",
      "// four",
      "const a = 1 // trailing",
      "// five",
      "// six",
      "const b = 2",
      "// seven",
      "//",
      "// eight",
      "// nine",
      ""
    ].join("\n")
    const run = runBin(["gate"], withBudget({ "src/a.ts": source }))
    assert.equal(run.status, 0, run.stdout)
  })

  it("reads no comment inside a string, a template literal or a regular expression", () => {
    const source = [
      'const url = "https://example.com/a"',
      "const glob = '/* not a comment */'",
      "const template = `${url}//${glob ? `//${1}` : '/*'}`",
      "const doc = `",
      slashes(4).trimEnd(),
      "`",
      "const quote = /[\"'`]/g",
      "const slashes = /\\/\\/[/*]/",
      "const ratio = 4 / 2 / 1",
      slashes(4).trimEnd(),
      "export { doc, quote, ratio, slashes, template }",
      ""
    ].join("\n")
    const run = runBin(["gate"], withBudget({ "src/a.ts": source }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `src/a.ts:13: comment-budget: a comment block of 4 prose lines, over the 3-line budget — ${OVER}`
    ])
  })

  it("judges only JavaScript, TypeScript and shell under the roots, by default packages, plugins, scripts and src", () => {
    const run = runBin(
      ["gate"],
      withBudget({
        "packages/a/index.mts": slashes(4),
        "plugins/b/hook.cjs": slashes(4),
        "plugins/b/hook.sh": hashes(4),
        "plugins/b/config.jq": hashes(4),
        "scripts/c.tsx": slashes(4),
        "docs/d.ts": slashes(9),
        "docs/e.sh": hashes(9),
        "notes.md": slashes(9)
      })
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      over("packages/a/index.mts:1"),
      over("plugins/b/hook.cjs:1"),
      over("plugins/b/hook.sh:1"),
      over("scripts/c.tsx:1")
    ])
  })
})

describe("the comment-budget Check on shell", () => {
  it("fails a # block of four prose lines with the file, the line it starts on and the count, and passes three", () => {
    const files = { "src/a.sh": `${hashes(3)}set -eu\n`, "src/b.sh": `set -eu\n\n${hashes(4)}exit 0\n` }
    const run = runBin(["gate"], withBudget(files))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [over("src/b.sh:3")])
  })

  it("splits # lines at a blank line or a line of code, not at a blank # line, and leaves a comment after code out", () => {
    const split = "# one\n# two\n\n# three\n# four\necho a # trailing\n# five\n# six\ntrue\n# seven\n"
    const trailing = "echo a # one\necho b # two\n# three\necho c # four\n# five\n# six\n"
    const joined = "# one\n#\n# two\n# three\n# four\n"
    const run = runBin(
      ["gate"],
      withBudget({ "src/split.sh": split, "src/trailing.sh": trailing, "src/joined.sh": joined })
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [over("src/joined.sh:1")])
  })

  it("skips the shebang on line 1 and reads a #! line further down as a comment", () => {
    const files = {
      "src/first.sh": `#!/usr/bin/env bash\n${hashes(3)}`,
      "src/later.sh": `set -eu\n#!/bin/sh\n${hashes(3)}`
    }
    const run = runBin(["gate"], withBudget(files))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [over("src/later.sh:2")])
  })

  it("reads no comment inside '…', \"…\", $'…' or a backtick span, nor after an escaped quote", () => {
    const files = {
      "src/single.sh": trapped("echo 'C:\\' '", "'"),
      "src/double.sh": trapped('echo "say \\" # not a comment', '"'),
      "src/escaped.sh": trapped("echo \\' '", "'"),
      "src/substitution.sh": trapped(`echo "$(printf '"')" '`, "'"),
      "src/ansi.sh": trapped("echo $'it\\'s' '", "'"),
      "src/backtick.sh": trapped("stamp=`echo \\`date +%s\\` # seconds`; echo '", "'")
    }
    const run = runBin(["gate"], withBudget(files))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      over("src/ansi.sh:7"),
      over("src/backtick.sh:7"),
      over("src/double.sh:7"),
      over("src/escaped.sh:7"),
      over("src/single.sh:7"),
      over("src/substitution.sh:7")
    ])
  })

  it("reads a # as a comment only where it starts a word", () => {
    const files = {
      "src/word.sh": trapped("echo foo#bar \\# '", "'"),
      "src/base.sh": trapped("echo $((16#ff)) '", "'"),
      "src/pattern.sh": trapped("[[ $a == *#* ]] && echo '", "'"),
      "src/operator.sh": `true;# it's a comment\n${hashes(4)}`,
      "src/continued.sh": `echo a \\\n# it's a comment\n${hashes(3)}`
    }
    const run = runBin(["gate"], withBudget(files))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      over("src/base.sh:7"),
      over("src/continued.sh:2"),
      over("src/operator.sh:2"),
      over("src/pattern.sh:7"),
      over("src/word.sh:7")
    ])
  })

  it("reads no comment in $#, ${#x}, ${x#pattern}, ${x##*/} or anywhere else inside ${…}", () => {
    const files = {
      "src/count.sh": trapped("[ $# -gt 0 ] && echo '", "'"),
      "src/length.sh": trapped("echo ${#x} '", "'"),
      "src/prefix.sh": trapped("echo ${x#*/} '", "'"),
      "src/longest.sh": trapped("echo ${x##*/} '", "'"),
      "src/default.sh": trapped("echo ${x:- #y} '", "'")
    }
    const run = runBin(["gate"], withBudget(files))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      over("src/count.sh:7"),
      over("src/default.sh:7"),
      over("src/length.sh:7"),
      over("src/longest.sh:7"),
      over("src/prefix.sh:7")
    ])
  })

  it("reads no comment in a heredoc body, whatever its delimiter, and none of <<< or a shift opens one", () => {
    const files = {
      "src/plain.sh": trapped("cat <<EOF", "EOF"),
      "src/tabs.sh": trapped("\tcat <<-EOF", "\tEOF"),
      "src/single.sh": trapped("cat <<'EOF'", "EOF"),
      "src/double.sh": trapped('cat <<"EOF"', "EOF"),
      "src/substitution.sh": trapped(`msg="$(cat <<'EOF'`, 'EOF\n)"'),
      "src/string.sh": `read -r a <<<"$1"\n${hashes(4)}`,
      "src/shift.sh": trapped("echo $((1 << 2)) '", "'"),
      "src/command.sh": trapped("(( n = 1 << 2 )) && echo '", "'")
    }
    const run = runBin(["gate"], withBudget(files))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      over("src/command.sh:7"),
      over("src/double.sh:7"),
      over("src/plain.sh:7"),
      over("src/shift.sh:7"),
      over("src/single.sh:7"),
      over("src/string.sh:2"),
      over("src/substitution.sh:8"),
      over("src/tabs.sh:7")
    ])
  })

  it("counts a # shellcheck directive as prose", () => {
    const run = runBin(["gate"], withBudget({ "src/a.sh": `# shellcheck disable=SC2016\n${hashes(3)}echo '$HOME'\n` }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [over("src/a.sh:1")])
  })
})

describe("the comment-budget Check's options", () => {
  it("holds each block under roots to maxProseLines", () => {
    const files = { "lib/a.ts": slashes(2), "lib/b.ts": slashes(1), "src/c.ts": slashes(9) }
    const run = runBin(["gate"], withBudget(files, { maxProseLines: 1, roots: ["lib"] }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `lib/a.ts:1: comment-budget: a comment block of 2 prose lines, over the 1-line budget — ${OVER}`
    ])
  })
})
