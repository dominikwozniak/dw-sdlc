// How the two setups write a file: only when its text would change, nothing under --dry-run, a link
// never over what sits at its path, and one line a file.

import assert from "node:assert/strict"
import { existsSync, readFileSync, readlinkSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { stepLines, Writer } from "../src/setup-writer.ts"
import { scratch, write } from "./harness.ts"

describe("the setup's Writer", () => {
  it("writes a changed file, leaves an equal one, and refuses where the change says so", () => {
    const dir = scratch("writer")
    write(join(dir, "same.txt"), "same\n")
    const writer = new Writer(false)
    writer.apply("new.txt", join(dir, "sub", "new.txt"), { text: "new\n", detail: "made" })
    writer.apply("same.txt", join(dir, "same.txt"), (current) => ({ text: current ?? "" }))
    writer.apply("bad.json", join(dir, "bad.json"), { refusal: "is not a JSON object" })
    assert.equal(readFileSync(join(dir, "sub", "new.txt"), "utf8"), "new\n")
    assert.deepEqual(stepLines(writer.steps, false), [
      "wrote       new.txt — made",
      "unchanged   same.txt",
      "refused     bad.json — is not a JSON object"
    ])
  })

  it("writes nothing under a dry run and says what it would write", () => {
    const dir = scratch("writer")
    const writer = new Writer(true)
    writer.apply("new.txt", join(dir, "new.txt"), { text: "new\n" })
    writer.create("link", join(dir, "link"), (path) => {
      symlinkSync("new.txt", path)
    })
    assert.ok(!existsSync(join(dir, "new.txt")))
    assert.deepEqual(stepLines(writer.steps, true), ["would write new.txt", "would write link"])
  })

  it("never replaces what sits at a link's path, a dangling link included", () => {
    const dir = scratch("writer")
    symlinkSync("gone.md", join(dir, "link"))
    const writer = new Writer(false)
    writer.create("link", join(dir, "link"), (path) => {
      symlinkSync("AGENTS.md", path)
    })
    assert.equal(readlinkSync(join(dir, "link")), "gone.md")
    assert.deepEqual(writer.steps, [{ file: "link", outcome: "unchanged" }])
  })
})
