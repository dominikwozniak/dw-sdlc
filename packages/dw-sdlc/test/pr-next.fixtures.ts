// PROTOTYPE (wayfinder #146): runs `decide` over hand-made PR states no live PR reached and prints
// what the stub would answer. `node packages/dw-sdlc/test/pr-next.fixtures.ts [name...]` dumps the
// full JSON of the named fixtures after the table.

import { decide, type PrState } from "../src/commands/pr-next.ts"

const NOW = new Date("2026-10-31T12:00:00Z")
const HEAD = "e36732e33915969ef4449becafeecd2e2846d544"
const RUN = "https://github.com/byarcadia-app/foundation/actions/runs/41116749914/job/124272841543"

const passing = { name: "Check", bucket: "pass" as const, required: false, link: RUN, log: null }

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
  checks: [passing],
  unresolvedThreads: []
}

const failingCheck = {
  name: "Check",
  bucket: "fail" as const,
  required: false,
  link: RUN,
  log: ["gh", "run", "view", "--job", "124272841543", "-R", "byarcadia-app/foundation", "--log-failed"]
}
const thread = {
  id: "PRRT_kwDOexample",
  path: "packages/payments/src/paywall.tsx",
  line: 42,
  author: "dominikwozniak",
  body: "This hook re-renders on every purchase event; memoise the offerings."
}

const FIXTURES: [string, PrState, "auto" | "ask"][] = [
  ["draft, CI failing", { ...green, draft: true, rollup: "FAILURE", checks: [failingCheck] }, "ask"],
  ["draft, all green", { ...green, draft: true }, "ask"],
  ["mergeability unknown", { ...green, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }, "ask"],
  ["conflicts", { ...green, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }, "ask"],
  ["behind, CI failing", { ...green, mergeStateStatus: "BEHIND", rollup: "FAILURE", checks: [failingCheck] }, "ask"],
  ["CI failing", { ...green, mergeStateStatus: "UNSTABLE", rollup: "FAILURE", checks: [failingCheck] }, "ask"],
  [
    "CI failing, other CI",
    {
      ...green,
      checks: [{ name: "ci/circleci", bucket: "fail", required: false, link: "https://circleci.com/x", log: null }]
    },
    "ask"
  ],
  ["no check, pushed 30 s ago", { ...green, rollup: null, checks: [], headCommittedAt: "2026-10-31T11:59:30Z" }, "ask"],
  ["no check, version PR", { ...green, rollup: null, checks: [], mergeStateStatus: "UNSTABLE" }, "auto"],
  ["CI running", { ...green, rollup: "PENDING", checks: [{ ...passing, bucket: "pending" }] }, "ask"],
  ["open thread", { ...green, unresolvedThreads: [thread] }, "ask"],
  ["changes requested", { ...green, reviewDecision: "CHANGES_REQUESTED" }, "ask"],
  ["review required", { ...green, reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED" }, "ask"],
  ["all green, ask", green, "ask"],
  ["all green, auto", green, "auto"],
  ["merged", { ...green, state: "MERGED" }, "ask"],
  ["closed", { ...green, state: "CLOSED" }, "ask"]
]

const rows = FIXTURES.map(([name, pr, merge]) => ({ name, merge, result: decide(pr, NOW, merge) }))
const width = Math.max(...rows.map((row) => row.name.length)) + 2
for (const { name, result } of rows) {
  process.stdout.write(
    `${name.padEnd(width)}${`${result.status}/${result.step}`.padEnd(30)}${result.actor.padEnd(8)}${result.reason}\n`
  )
}
for (const wanted of process.argv.slice(2)) {
  const row = rows.find((candidate) => candidate.name === wanted)
  if (row !== undefined) {
    const pr = FIXTURES.find(([name]) => name === wanted)?.[1]
    process.stdout.write(
      `\n## ${wanted}\n${JSON.stringify({ pr: pr?.url, head: pr?.head, base: pr?.base, ...row.result }, null, 2)}\n`
    )
  }
}
