# Research — the Gate

Verified findings behind ADR 0008, ADR 0009 and ADR 0010 and the spec in issue #90. Everything here
was read or run on 2026-10-25 unless a line says otherwise. `R/` is `references/` in this repo, cloned
by the references plugin; a cited path is as it read on that date. A line that could not be verified
sits under Still open, not among the findings. The facts are split by source: `kody.md`,
`kcd-skills.md`, `open-mercato-skills.md`, `own-repositories.md`, `toolchain.md`, `claude-code.md`.

## What the sources agree on

- One command is the gate, and a small agent map names it. Kody: "`npm run validate` is the single
  authoritative local gate" in a 23-line `AGENTS.md` (`R/kody/AGENTS.md:7`). kcd-skills: rung 2 of
  autopilot is "One small `AGENTS.md` map and one verify command (local == CI)"
  (`R/kcd-skills/skills/autopilot/SKILL.md:25`). Open Mercato: a task-routing table in `AGENTS.md`
  and `validation.commands` in `.ai/agentic.config.json`, which every skill reads
  (`R/open-mercato-skills/AGENTS.md:7-16`, `skills/om-setup-agent-pipeline/SKILL.md:60`).
- A check is a script with an exit code and a line that names the remedy; the agent judges only what
  no script can. "Scripts decide anything checkable (audit facts, CI, PR state); agents judge."
  (`R/kcd-skills/skills/autopilot/SKILL.md:32`). Kody's ladder puts lint and validate first, tests
  second, scripts third and docs last, where a doc "point[s] at the check or test"
  (`R/kody/docs/contributing/harness-engineering.md:38-44`).
- A static fact lives in the map, not in a session hook. None of the three repositories wires a
  Claude Code hook; Claude Code's own docs say "For static context that doesn't require a script, use
  CLAUDE.md instead" (`claude-code.md`).
- A limit worth keeping is a ratchet with a committed baseline that only tightens: kody's file-size
  groups with a snapshot allowlist, grateful-me's word-count baseline that "may shrink freely and
  grows only through a commit that re-records this file" (`kody.md`, `own-repositories.md`).
- A catalogue of primitives is a small file a check validates: kody's `primitives.yaml`, 76 entries,
  summaries of one line under 120 characters, every path on disk (`kody.md`).

## Where they differ

| question             | kody                                                          | kcd-skills                                          | open-mercato-skills                                                | grateful-me                                     |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| after a failed check | the group runs on, "so one member does not hide the next"     | one exit code per step: 0 done, 10 act, 20 wait     | commands run in order, "any non-zero exit as a gate failure"       | one `STEPS` list run in order                   |
| where checks live    | 41 `tools/check-*.ts` in the repo                             | npm package `kcd-skills`, "no runtime dependencies" | skills copied into each repo through skills.sh, scripts duplicated | `scripts/check-*.mjs` in the repo               |
| config               | none beyond `package.json` scripts                            | `.github/ship-pr.json`, `//` comments allowed       | `.ai/agentic.config.json`, no schema                               | constants inside each script                    |
| output               | a count, one sentence, a pointer to the doc, then the matches | `--json`, `--schema` prints the format              | prose for the agent                                                | `path:line — <measure>, past the <limit>` lines |

## The drift the package replaces

The anti-slop rules are vendored by design (`toolchain.md`), and four repositories hold four states of
them (`own-repositories.md`): the template eleven rules at commit `c44ef22`, dw-mc four rules at the
same commit, grateful-me 42 rule files on tag `v0.1.2` plus rules of its own, foundation a package of
its own with rules added one at a time. No copy learns a fix made in another, and the check scripts
beside them are copies too.

## What the package must ship

A `.ts` bin does not run from a consumer's `node_modules`: Node refuses type stripping there, and
the experiment in `toolchain.md` reproduces the refusal on Node 24.22.1 while a symlink to a directory
outside `node_modules` runs. This repository and a workspace link run the source; the published
artifact is JavaScript.

## Still open

- The Stop hook's limits were not read; nothing in the design depends on them.
