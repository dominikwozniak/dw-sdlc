// The Review's standing at a pull request's head, through its interface: a history as the reply gives it,
// GitHub's compares from an in-memory adapter, and the Review the head gets under the depth set for it.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { ReviewDepth } from "../src/agentic-config.ts"
import type { ChangedFile } from "../src/pr/route.ts"
import {
  type Commit,
  type Compares,
  type History,
  type OwnChange,
  reviewCall,
  type ReviewPolicy,
  type Standing,
  standingOf
} from "../src/pr/standing.ts"

const HEAD = "e36732e33915969ef4449becafeecd2e2846d544"
const BASE = "8ba44d6f750333be72a05ca309e37b5984e3a0b9"
const CLEAN = "ad212a6aa5e5c0ffee0ddba11c0de5ca1ab1e0dd"
const READ = "5ae684e1c0ffee0ddba11c0de5ca1ab1e0ddba11"
const SECOND = "b01dfacec0ffee0ddba11c0de5ca1ab1e0ddba11"
const THIRD = "c0ffee00c0ffee0ddba11c0de5ca1ab1e0ddba11"
const PUSHED = "ebf4833f00dfacade0ddba11c0de5ca1ab1e0ddb"

const FULL: ReviewPolicy = { depth: "full", source: "config" }
const AUTO: ReviewPolicy = { depth: "auto", source: "config" }
const OFF: ReviewPolicy = { depth: "off", source: "config" }

function flag(depth: ReviewDepth): ReviewPolicy {
  return { depth, source: "flag" }
}

const PAYWALL: OwnChange = { path: "src/paywall.tsx", status: "modified", previous: null, lines: ["+  const a = 1"] }
const ADDED: OwnChange = { path: "src/retry.ts", status: "added", previous: null, lines: ["+export const RETRIES = 3"] }
const LOCKFILE: ChangedFile = { path: "pnpm-lock.yaml", previous: null, lines: 4 }
const RETRY: ChangedFile = { path: "src/retry.ts", previous: null, lines: 3 }
const BASE_FILE: ChangedFile = { path: "src/base.ts", previous: null, lines: 600 }

function clean(oid: string, merge = false): Commit {
  return { oid, posted: "clean", merge }
}

function marked(oid: string, merge = false): Commit {
  return { oid, posted: "findings", merge }
}

function pushed(oid: string, merge = false): Commit {
  return { oid, posted: null, merge }
}

/** The history to HEAD, a merge when `headMerge` says so, and the heads force pushes left behind, newest first. */
function upTo(
  commits: Commit[],
  { headMerge = false, leftBehind = [] }: Partial<History> & { headMerge?: boolean } = {}
): History {
  return { commits: [...commits, pushed(HEAD, headMerge)], leftBehind, head: HEAD, base: BASE }
}

/**
 * The in-memory adapter of the compares: the own changes at each commit, the files changed since each, and
 * every compare asked, once each as the gh adapter asks it. A compare the test did not state fails it.
 */
function inMemory(
  own: Record<string, OwnChange[] | null> = {},
  changed: Record<string, ChangedFile[] | "unsized"> = {}
): Compares & { asked: string[] } {
  const asked: string[] = []
  const ask = (from: string, to: string): void => {
    if (!asked.includes(`${from}...${to}`)) {
      asked.push(`${from}...${to}`)
    }
  }
  return {
    asked,
    ownChanges: (base, commit) => {
      ask(base, commit)
      const found = own[commit]
      if (found === undefined) {
        throw new Error(`no own changes stated at ${commit}`)
      }
      return found
    },
    changed: (from, head) => {
      ask(from, head)
      const found = changed[from]
      if (found === undefined) {
        throw new Error(`no changed files stated from ${from}`)
      }
      return found
    }
  }
}

const AWAITS = { awaits: true, sized: false }
const SIZED = { awaits: true, sized: true }
const NO_MARK = { count: 0, since: null }

describe("the Review's standing at a pull request's head", () => {
  it("reads the whole pull request at the depth set when no Review read it, asking no compare", () => {
    const compares = inMemory()
    const standing = standingOf(upTo([pushed(PUSHED)]), compares, AWAITS)
    const none = {
      lastRead: null,
      open: null,
      marks: NO_MARK,
      carried: false,
      changed: null,
      scope: null,
      fixTested: false
    }
    assert.deepEqual(standing, none)
    assert.deepEqual(reviewCall(standing, FULL), {
      kind: "review",
      depth: "full",
      source: "config",
      since: null,
      paths: null,
      open: null
    })
    assert.deepEqual(compares.asked, [])
  })

  it("reads the fix from the last read after a commit of the branch's own, comparing from a read mark alone", () => {
    const cases: [Commit, string[]][] = [
      [clean(READ), []],
      [marked(READ), [`${READ}...${HEAD}`]]
    ]
    for (const [read, asked] of cases) {
      const compares = inMemory({}, { [READ]: [RETRY] })
      const call = reviewCall(standingOf(upTo([read, pushed(PUSHED)]), compares, AWAITS), FULL)
      assert.deepEqual(
        call,
        { kind: "review", depth: "full", source: "config", since: READ, paths: null, open: null },
        String(read.posted)
      )
      assert.deepEqual(compares.asked, asked, String(read.posted))
    }
    const unchanged = standingOf(upTo([marked(READ), pushed(PUSHED)]), inMemory({}, { [READ]: [] }), AWAITS)
    assert.deepEqual(reviewCall(unchanged, FULL), {
      kind: "review",
      depth: "full",
      source: "config",
      since: null,
      paths: null,
      open: READ
    })
  })

  it("carries a clean read over merges of the base that leave the own changes as they were", () => {
    const compares = inMemory({ [READ]: [PAYWALL], [HEAD]: [PAYWALL] })
    const standing = standingOf(upTo([clean(READ), pushed(PUSHED, true)], { headMerge: true }), compares, AWAITS)
    assert.equal(standing.carried, true)
    assert.deepEqual(reviewCall(standing, FULL), { kind: "carry", from: READ })
    assert.deepEqual(compares.asked, [`${BASE}...${READ}`, `${BASE}...${HEAD}`])
    const whole = { kind: "review", depth: "light", source: "flag", since: null, paths: null, open: null }
    assert.deepEqual(reviewCall(standing, flag("light")), whole, "the dev's depth over a carry reads the whole diff")
  })

  it("keeps a Review after a merge of the base to the files whose own change moved, and sizes only those", () => {
    const compares = inMemory({ [READ]: [PAYWALL], [HEAD]: [PAYWALL, ADDED] }, { [READ]: [RETRY, BASE_FILE] })
    const standing = standingOf(upTo([marked(READ), pushed(PUSHED, true)]), compares, SIZED)
    assert.deepEqual([standing.carried, standing.scope, standing.changed], [false, [ADDED.path], [RETRY]])
    assert.deepEqual(reviewCall(standing, AUTO), {
      kind: "review",
      depth: "light",
      source: "auto",
      since: READ,
      paths: [ADDED.path],
      open: null
    })
  })

  it("routes lockfiles alone off after a clean read, and light while a Finding is open", () => {
    const cases: [Commit, object][] = [
      [clean(READ), { depth: "off", source: "auto", why: "lockfiles only" }],
      [marked(READ), { depth: "light", source: "auto" }]
    ]
    for (const [read, depth] of cases) {
      const compares = inMemory({}, { [READ]: [LOCKFILE] })
      const call = reviewCall(standingOf(upTo([read, pushed(PUSHED)]), compares, SIZED), AUTO)
      assert.deepEqual(call, { ...depth, kind: "review", since: READ, paths: null, open: null }, String(read.posted))
    }
  })

  it("parks at three Reviews that left a Finding open, at every depth but the dev's own", () => {
    const history = upTo([clean(CLEAN), marked(READ), marked(SECOND), marked(THIRD), pushed(PUSHED)])
    const standing = standingOf(history, inMemory({}, { [THIRD]: [LOCKFILE] }), SIZED)
    const limit = { kind: "limit", count: 3, since: CLEAN }
    for (const policy of [FULL, AUTO, OFF]) {
      assert.deepEqual(reviewCall(standing, policy), limit, policy.depth)
    }
    assert.deepEqual(reviewCall(standing, flag("light")), {
      kind: "review",
      depth: "light",
      source: "flag",
      since: THIRD,
      paths: null,
      open: null
    })
    assert.deepEqual(reviewCall(standing, flag("off")), {
      kind: "review",
      depth: "off",
      source: "flag",
      why: "--review off",
      since: THIRD,
      paths: null,
      open: null
    })
    const fixed = inMemory({}, { [PUSHED]: [RETRY] })
    const fourth = standingOf(upTo([...history.commits.slice(0, -2), marked(PUSHED)]), fixed, AWAITS)
    assert.deepEqual(reviewCall(fourth, flag("light")), { kind: "limit", count: 4, since: CLEAN })
  })

  it("at the limit, has a fix that carries its test wait for a green Gate, then read once at light", () => {
    const marks = [clean(CLEAN), marked(READ), marked(SECOND), marked(THIRD)]
    const light = { kind: "review", depth: "light", source: "limit", since: THIRD, paths: null, open: null }
    const tests = ["src/retry.test.ts", "spec/models/user_spec.rb", "pkg/retry_test.go", "tests/test_retry.py"]
    for (const path of tests) {
      const changed = inMemory({}, { [THIRD]: [RETRY, { path, previous: null, lines: 4 }] })
      const standing = standingOf(upTo([...marks, pushed(PUSHED)]), changed, AWAITS)
      assert.equal(standing.fixTested, true, path)
      assert.deepEqual(reviewCall(standing, FULL), { kind: "gate", count: 3, since: CLEAN }, path)
      assert.deepEqual(reviewCall(standing, FULL, { gateGreen: true }), light, path)
      assert.equal(reviewCall(standing, flag("full"), { gateGreen: true }).kind, "review", "the dev's word first")
    }
    for (const path of ["src/testing.ts", "src/latest.ts"]) {
      const changed = inMemory({}, { [THIRD]: [RETRY, { path, previous: null, lines: 4 }] })
      const standing = standingOf(upTo([...marks, pushed(PUSHED)]), changed, AWAITS)
      assert.equal(reviewCall(standing, FULL, { gateGreen: true }).kind, "limit", path)
    }
    const test: OwnChange = { path: "src/paywall.test.tsx", status: "added", previous: null, lines: ["+it()"] }
    const merged = upTo([...marks, pushed(PUSHED)], { headMerge: true })
    const own = inMemory({ [THIRD]: [PAYWALL], [HEAD]: [PAYWALL, test] })
    const standing = standingOf(merged, own, AWAITS)
    assert.deepEqual(reviewCall(standing, FULL, { gateGreen: true }), {
      ...light,
      paths: ["src/paywall.test.tsx"]
    })
  })

  it("names open a read mark only merges of the base came after, and reads the whole pull request", () => {
    const history = upTo([clean(CLEAN), marked(READ, true)], { headMerge: true })
    const compares = inMemory({}, { [BASE]: [RETRY] })
    const standing = standingOf(history, compares, SIZED)
    assert.deepEqual(standing, {
      lastRead: null,
      open: READ,
      marks: { count: 1, since: CLEAN },
      carried: false,
      changed: [RETRY],
      scope: null,
      fixTested: false
    })
    assert.deepEqual(reviewCall(standing, AUTO), {
      kind: "review",
      depth: "light",
      source: "auto",
      since: null,
      paths: null,
      open: READ
    })
    assert.deepEqual(compares.asked, [`${BASE}...${HEAD}`])
  })

  it("routes lockfiles alone light over an open read mark, though a success under off came after it", () => {
    const history = upTo([marked(READ), { oid: SECOND, posted: "off", merge: true }], { headMerge: true })
    const standing = standingOf(history, inMemory({}, { [BASE]: [LOCKFILE] }), SIZED)
    assert.deepEqual([standing.open, standing.marks], [READ, { count: 0, since: SECOND }])
    assert.deepEqual(reviewCall(standing, AUTO), {
      kind: "review",
      depth: "light",
      source: "auto",
      since: null,
      paths: null,
      open: READ
    })
  })

  it("names open a read mark a rebase left with the own changes as it read them, and carries a clean one", () => {
    const leftBehind: History["leftBehind"] = [
      { oid: READ, posted: "findings", forksAt: -1 },
      { oid: CLEAN, posted: "clean", forksAt: -1 }
    ]
    const compares = inMemory({ [READ]: [PAYWALL], [HEAD]: [PAYWALL] })
    const standing = standingOf(upTo([pushed(PUSHED)], { leftBehind }), compares, AWAITS)
    const expected: Standing = {
      lastRead: null,
      open: READ,
      marks: { count: 1, since: CLEAN },
      carried: false,
      changed: null,
      scope: null,
      fixTested: false
    }
    assert.deepEqual(standing, expected)
    const same = inMemory({ [CLEAN]: [PAYWALL], [HEAD]: [PAYWALL] })
    const carried = standingOf(upTo([pushed(PUSHED)], { leftBehind: leftBehind.slice(1) }), same, AWAITS)
    assert.deepEqual(reviewCall(carried, FULL), { kind: "carry", from: CLEAN })
  })

  it("reads from a read mark a force push left behind after the last clean read, and carries nothing past it", () => {
    const leftBehind: History["leftBehind"] = [{ oid: SECOND, posted: "findings", forksAt: 0 }]
    const history = upTo([clean(READ), pushed(PUSHED, true)], { headMerge: true, leftBehind })
    // The clean read's own changes match the head's, so only the mark keeps the clean read from carrying.
    const own = { [READ]: [PAYWALL], [SECOND]: [PAYWALL], [HEAD]: [PAYWALL] }
    const unanswered = standingOf(history, inMemory(own), AWAITS)
    assert.equal(unanswered.carried, false)
    assert.deepEqual(reviewCall(unanswered, FULL), {
      kind: "review",
      depth: "full",
      source: "config",
      since: null,
      paths: null,
      open: SECOND
    })
    const answered = standingOf(history, inMemory({ [SECOND]: [PAYWALL], [HEAD]: [ADDED] }), AWAITS)
    assert.deepEqual(reviewCall(answered, FULL), {
      kind: "review",
      depth: "full",
      source: "config",
      since: SECOND,
      paths: ["src/paywall.tsx", "src/retry.ts"],
      open: null
    })
  })

  it("counts the marks posted after the newest success, a line an amend left behind after the commit it was pushed on", () => {
    const amended: History["leftBehind"] = [
      { oid: THIRD, posted: "findings", forksAt: 1 },
      { oid: SECOND, posted: "clean", forksAt: 1 },
      { oid: READ, posted: "findings", forksAt: 0 }
    ]
    const history = upTo([marked(PUSHED), clean(CLEAN)], { leftBehind: amended })
    const standing = standingOf(history, inMemory(), { awaits: false, sized: false })
    assert.deepEqual(standing.marks, { count: 1, since: SECOND })
  })

  it("asks no compare for a head no Review awaits", () => {
    const compares = inMemory()
    const standing = standingOf(upTo([clean(READ)], { headMerge: true }), compares, { awaits: false, sized: true })
    assert.deepEqual(standing, {
      lastRead: { commit: READ, clean: true, baseOnly: true, baseMoved: true },
      open: null,
      marks: { count: 0, since: READ },
      carried: false,
      changed: null,
      scope: null,
      fixTested: false
    })
    assert.deepEqual(compares.asked, [])
  })
})
