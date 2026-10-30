// `removeKey` on the text of a JSON object: the member goes, whatever its place, and every other
// byte of the file stays.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { removeKey } from "../src/json-text.ts"

describe("removeKey", () => {
  const cases: [name: string, text: string, want: string][] = [
    ["the first member", '{\n  "references": [],\n  "version": 1\n}\n', '{\n  "version": 1\n}\n'],
    [
      "a middle member, the layout around it kept",
      '{\n  "version": 1,\n  "references": [{ "dir": "a" }],\n  "worktree": { "setup": [] }\n}\n',
      '{\n  "version": 1,\n  "worktree": { "setup": [] }\n}\n'
    ],
    ["the last member", '{\n  "version": 1,\n  "references": []\n}\n', '{\n  "version": 1\n}\n'],
    ["the only member", '{\n  "references": []\n}\n', "{\n}\n"],
    ["a member on one line", '{"a":1,"references":[],"b":2}', '{"a":1,"b":2}'],
    [
      "a value whose strings hold quotes, backslashes, braces and commas",
      '{"references":[{"what":"a \\"},{\\" b\\\\","when":"x, ]"}],"b":2}',
      '{"b":2}'
    ],
    ["every copy of a key that repeats", '{"references":[1],"a":1,"references":[2]}', '{"a":1}'],
    ["no member: the same key nested deeper stays", '{"a":{"references":1}}', '{"a":{"references":1}}'],
    ["no member: the key's name as a value stays", '{"a":"references"}', '{"a":"references"}']
  ]
  for (const [name, text, want] of cases) {
    it(name, () => {
      const got = removeKey(text, "references")
      assert.equal(got, want)
      assert.deepEqual(JSON.parse(got), JSON.parse(want))
    })
  }

  it("returns on a string that never closes", () => {
    assert.equal(removeKey('{"a":"never closes', "references"), '{"a":"never closes')
  })
})
