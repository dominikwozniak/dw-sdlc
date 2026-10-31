// PROTOTYPE (wayfinder #146): runs `decide` over hand-made PR states no live PR reached and prints
// what the stub would answer. `node packages/dw-sdlc/test/pr-next.fixtures.ts [name...]` dumps the
// full JSON of the named fixtures after the table.

import { decide, type Options, type PrState } from "../src/commands/pr-next.ts"

const NOW = new Date("2026-10-31T12:00:00Z")
const HEAD = "e36732e33915969ef4449becafeecd2e2846d544"
const RUN = "https://github.com/byarcadia-app/foundation/actions/runs/41116749914/job/124272841543"
const ASK: Options = { merge: "ask", waitBudgetMinutes: 40 }
const AUTO: Options = { merge: "auto", waitBudgetMinutes: 40 }

const passing = {
  name: "Check",
  bucket: "pass" as const,
  required: false,
  link: RUN,
  log: null,
  startedAt: "2026-10-31T11:01:00Z"
}
const reviewed = {
  name: "dw-sdlc/review",
  bucket: "pass" as const,
  required: false,
  link: null,
  log: null,
  startedAt: "2026-10-31T11:05:00Z"
}
const failing = {
  ...passing,
  bucket: "fail" as const,
  log: ["gh", "run", "view", "--job", "124272841543", "-R", "byarcadia-app/foundation", "--log-failed"]
}
const thread = {
  id: "PRRT_kwDOexample",
  path: "packages/payments/src/paywall.tsx",
  line: 42,
  author: "dominikwozniak",
  body: "This hook re-renders on every purchase event; memoise the offerings."
}

const green: PrState = {
  url: "https://github.com/byarcadia-app/foundation/pull/40",
  repo: "byarcadia-app/foundation",
  state: "OPEN",
  draft: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  head: HEAD,
  headCommittedAt: "2026-10-31T11:00:00Z",
  branch: "feat/example",
  base: "main",
  rollup: "SUCCESS",
  checks: [passing, reviewed],
  unresolvedThreads: []
}

const FIXTURES: [string, PrState, Options][] = [
  ["draft, CI failing", { ...green, draft: true, rollup: "FAILURE", checks: [failing] }, ASK],
  ["draft, all green", { ...green, draft: true }, ASK],
  ["mergeability unknown", { ...green, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }, ASK],
  ["conflicts, CI failing", { ...green, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", checks: [failing] }, ASK],
  ["behind, CI failing", { ...green, mergeStateStatus: "BEHIND", rollup: "FAILURE", checks: [failing] }, ASK],
  ["CI failing", { ...green, mergeStateStatus: "UNSTABLE", rollup: "FAILURE", checks: [failing] }, ASK],
  ["no check, pushed 30 s ago", { ...green, rollup: null, checks: [], headCommittedAt: "2026-10-31T11:59:30Z" }, ASK],
  ["no check, version PR", { ...green, rollup: null, checks: [], mergeStateStatus: "UNSTABLE" }, AUTO],
  ["only the review status", { ...green, checks: [reviewed] }, AUTO],
  [
    "CI running 9 min",
    { ...green, rollup: "PENDING", checks: [{ ...passing, bucket: "pending", startedAt: "2026-10-31T11:51:00Z" }] },
    ASK
  ],
  ["CI running 59 min", { ...green, rollup: "PENDING", checks: [{ ...passing, bucket: "pending" }] }, ASK],
  ["open thread, not reviewed", { ...green, checks: [passing], unresolvedThreads: [thread] }, ASK],
  ["changes requested", { ...green, reviewDecision: "CHANGES_REQUESTED" }, ASK],
  ["green, not reviewed", { ...green, checks: [passing] }, ASK],
  ["review required", { ...green, reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED" }, ASK],
  ["all green, ask", green, ASK],
  ["all green, auto", green, AUTO],
  ["merged", { ...green, state: "MERGED" }, ASK],
  ["closed", { ...green, state: "CLOSED" }, ASK]
]

const rows = FIXTURES.map(([name, pr, options]) => ({ name, pr, result: decide(pr, NOW, options) }))
const width = Math.max(...rows.map((row) => row.name.length)) + 2
for (const { name, result } of rows) {
  const blockers = result.blockers.length > 0 ? ` [+${result.blockers.join(", ")}]` : ""
  process.stdout.write(
    `${name.padEnd(width)}${`${result.status}/${result.action}`.padEnd(24)}${result.actor.padEnd(8)}${result.reason}${blockers}\n`
  )
}
for (const wanted of process.argv.slice(2)) {
  const row = rows.find((candidate) => candidate.name === wanted)
  if (row !== undefined) {
    const out = { pr: row.pr.url, head: row.pr.head, base: row.pr.base, ...row.result }
    process.stdout.write(`\n## ${wanted}\n${JSON.stringify(out, null, 2)}\n`)
  }
}
