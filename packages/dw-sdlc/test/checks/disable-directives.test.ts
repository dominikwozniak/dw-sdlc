// The `disable-directives` Check through `dw-sdlc gate`, on a throwaway repository whose source carries
// Disable directives: the exit code, each failure line word for word and the `--json` document.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { lines, repo, runBin } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"

/** A repository with `files` and the Check set to `setting`. */
function withCheck(files: Record<string, string>, setting: unknown = true): string {
  return repo({ files: { [CONFIG]: { version: 1, gate: { checks: { "disable-directives": setting } } }, ...files } })
}

/** The failure lines of a Gate run that ran the one Check, its own `gate: check` line and the verdict cut. */
function failures(stdout: string): string[] {
  return lines(stdout).slice(1, -1)
}

const REMEDY = "add one after `--` on its line, or in a comment on the line above"

/** The failure line of `directive` at `at`, a `file:line`. */
function bare(at: string, directive: string): string {
  return `${at}: disable-directives: ${directive} gives no reason — ${REMEDY}`
}

/** A Gate run over `files`, its failure lines. */
function judge(files: Record<string, string>, setting?: unknown): string[] {
  const run = runBin(["gate"], withCheck(files, setting))
  assert.equal(run.status, run.stdout.includes("failed") ? 1 : 0, run.stdout)
  return failures(run.stdout)
}

describe("the disable-directives Check", () => {
  it("passes every directive form with a reason", () => {
    const run = runBin(
      ["gate"],
      withCheck({
        "src/a.ts": [
          "// eslint-disable-next-line no-console -- the CLI prints",
          "console.log(1)",
          "console.log(2) // eslint-disable-line no-console -- the CLI prints",
          "/* eslint-disable no-console -- the CLI prints */",
          "// oxlint-disable-next-line no-console -- the CLI prints",
          "console.log(3)",
          "/* oxlint-disable no-console -- the CLI prints */",
          "// oxlint-disable-line no-console -- the CLI prints",
          "// @ts-expect-error: the fixture is wrong on purpose",
          "const a: number = 'x'",
          "// @ts-ignore the typings lag",
          "const b: number = 'y'",
          ""
        ].join("\n"),
        "app/a.rb": "x = 1 # rubocop:disable Style/Foo -- the API names it so\n",
        "app/a.py": "import os  # noqa: F401 -- re-exported\n"
      })
    )
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: check disable-directives — pass", "gate: green — 0 steps, 1 check"])
  })

  for (const [name, file, text, directive] of [
    ["eslint-disable", "src/a.ts", "/* eslint-disable */\n", "eslint-disable"],
    [
      "eslint-disable-next-line",
      "src/a.ts",
      "// eslint-disable-next-line no-console\nconsole.log(1)\n",
      "eslint-disable-next-line"
    ],
    ["eslint-disable-line", "src/a.js", "console.log(1) // eslint-disable-line no-console\n", "eslint-disable-line"],
    ["oxlint-disable", "src/a.ts", "/* oxlint-disable no-console */\n", "oxlint-disable"],
    [
      "oxlint-disable-next-line",
      "src/a.tsx",
      "// oxlint-disable-next-line no-console\nconsole.log(1)\n",
      "oxlint-disable-next-line"
    ],
    ["oxlint-disable-line", "src/a.mjs", "console.log(1) // oxlint-disable-line\n", "oxlint-disable-line"],
    ["@ts-expect-error", "src/a.ts", "// @ts-expect-error\nconst a: number = 'x'\n", "@ts-expect-error"],
    ["@ts-ignore", "src/a.ts", "// @ts-ignore:\nconst a: number = 'x'\n", "@ts-ignore"],
    ["rubocop:disable", "app/a.rb", "x = 1 # rubocop:disable Style/Foo\n", "rubocop:disable"],
    ["noqa", "app/a.py", "import os  # noqa: F401\n", "noqa"]
  ] as const) {
    it(`fails ${name} with no reason, with the file and line`, () => {
      assert.deepEqual(judge({ [file]: text }), [bare(`${file}:1`, directive)])
    })
  }

  it("carries the file, the line and the directive in --json", () => {
    const run = runBin(
      ["gate", "--json"],
      withCheck({ "src/a.ts": "const a = 1\n// @ts-ignore\nconst b: number = 'x'\n" })
    )
    assert.equal(run.status, 1)
    assert.deepEqual(JSON.parse(run.stdout).failures, [
      {
        file: "src/a.ts",
        line: 2,
        rule: "disable-directives",
        message: "@ts-ignore gives no reason",
        remedy: REMEDY,
        directive: "@ts-ignore"
      }
    ])
  })

  it("accepts a reason after `--`, after an @ts- directive and on the line above", () => {
    assert.deepEqual(
      judge({
        "src/after-dashes.ts": "// eslint-disable-next-line no-console -- why\nconsole.log(1)\n",
        "src/after-ts.ts": "// @ts-expect-error because\n// @ts-ignore: because\n",
        "src/above.ts": "// the CLI prints\n// eslint-disable-next-line no-console\nconsole.log(1)\n",
        "src/above-block.ts": "/* the CLI prints */\n// oxlint-disable-next-line no-console\nconsole.log(1)\n",
        "app/above.rb": "# the API names it so\nx = 1 # rubocop:disable Style/Foo\n",
        "app/above.py": "# re-exported\nimport os  # noqa\n"
      }),
      []
    )
  })

  it("does not take a comment two lines above, or another directive, as a reason", () => {
    assert.deepEqual(
      judge({
        "src/far.ts": "// the CLI prints\n\n// eslint-disable-next-line no-console\nconsole.log(1)\n",
        "src/stacked.ts": "// eslint-disable-next-line a\n// eslint-disable-next-line b\nconsole.log(1)\n"
      }),
      [
        bare("src/far.ts:3", "eslint-disable-next-line"),
        bare("src/stacked.ts:1", "eslint-disable-next-line"),
        bare("src/stacked.ts:2", "eslint-disable-next-line")
      ]
    )
  })

  it("does not take a trailing comment on the line above, or a bare `--` after an @ts- directive, as a reason", () => {
    assert.deepEqual(
      judge({
        "src/trailing.ts": "const a = 1 // about a\n// eslint-disable-next-line no-console\nconsole.log(1)\n",
        "src/dashes.ts": "// @ts-ignore --\nconst b: number = 'x'\n"
      }),
      [bare("src/dashes.ts:1", "@ts-ignore"), bare("src/trailing.ts:2", "eslint-disable-next-line")]
    )
  })

  it("reads the line of a directive inside a block comment", () => {
    assert.deepEqual(judge({ "src/a.ts": "/**\n * about it\n * @ts-ignore\n */\nconst a = 1\n" }), [
      bare("src/a.ts:3", "@ts-ignore")
    ])
  })

  it("passes a directive inside a string, a template or a regular expression", () => {
    assert.deepEqual(
      judge({
        "src/a.ts": [
          'const a = "// eslint-disable-next-line no-console"',
          "const b = `/* oxlint-disable */ ${a}`",
          "const c = /\\/\\/ @ts-ignore/",
          "const d = '// @ts-expect-error'",
          ""
        ].join("\n"),
        "app/a.rb": [
          'a = "# rubocop:disable Style/Foo"',
          "b = '# rubocop:disable Style/Foo'",
          'c = "#{a} # rubocop:disable Style/Foo"',
          "d = <<~DOC",
          "  it's # rubocop:disable Style/Foo",
          "DOC",
          "e = /#{a}/",
          "=begin",
          "# rubocop:disable Style/Foo",
          "=end",
          ""
        ].join("\n"),
        "app/a.py": ['a = "# noqa"', "b = '# noqa: E501'", 'c = """', "# noqa", '"""', ""].join("\n")
      }),
      []
    )
  })

  it("reads a directive after a string on the same line", () => {
    assert.deepEqual(
      judge({ "app/a.rb": 'a = "#{1}"  # rubocop:disable Style/Foo\n', "app/a.py": 'a = "x"  # noqa\n' }),
      [bare("app/a.py:1", "noqa"), bare("app/a.rb:1", "rubocop:disable")]
    )
  })

  it("does not read a directive that only a comment mentions", () => {
    assert.deepEqual(judge({ "src/a.ts": "// how eslint-disable works\n// the @ts-ignore comment\nconst a = 1\n" }), [])
  })

  it("leaves a rule set to off in a lint config alone", () => {
    assert.deepEqual(
      judge({
        ".eslintrc.json": '{ "rules": { "no-console": "off" } }\n',
        ".oxlintrc.json": '{ "rules": { "no-console": "off" } }\n'
      }),
      []
    )
  })

  it("exempts references, vendor and node_modules by default", () => {
    const text = "// @ts-ignore\n"
    assert.deepEqual(
      judge({
        "references/x/a.ts": text,
        "lib/vendor/a.ts": text,
        "node_modules/x/a.ts": text,
        "src/a.ts": text
      }),
      [bare("src/a.ts:1", "@ts-ignore")]
    )
  })

  it("never reads an ignored file", () => {
    assert.deepEqual(judge({ ".gitignore": "dist/\n", "dist/a.ts": "// @ts-ignore\n" }), [])
  })

  it("takes the files and exempt of its options over the defaults", () => {
    const text = "// @ts-ignore\n"
    assert.deepEqual(
      judge(
        { "src/a.ts": text, "lib/b.ts": text, "app/c.rb": "# rubocop:disable A\n" },
        { files: ["src/**", "lib/**", "app/**"], exempt: ["lib/**"] }
      ),
      [bare("app/c.rb:1", "rubocop:disable"), bare("src/a.ts:1", "@ts-ignore")]
    )
    assert.deepEqual(judge({ "references/a.ts": text }, { exempt: [] }), [bare("references/a.ts:1", "@ts-ignore")])
  })
})
