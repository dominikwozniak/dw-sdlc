# kcd-skills — scripts decide, agents judge

Read from `R/kcd-skills` on 2026-10-25, the clone at its `main` ref of that day.

## Distribution

- `README.md:20-31`: installed with `npx skills add kentcdodds/kcd-skills`, whole or `--skill <name>`.
- `README.md:47`: "one version has all of them. Node 20+, no runtime dependencies."
- `README.md:61, 67`: the loop runs without Kody as `npx kcd-skills@latest autopilot ship-pr --input
  state.json --risk low --json`; "`ship-pr --schema`" prints the JSON format it expects.

## The contract between a script and an agent

- `skills/autopilot/SKILL.md:25`, rung 2 of the autopilot ladder: "One small `AGENTS.md` map and one
  verify command (local == CI)."
- `skills/autopilot/SKILL.md:32`, rung 5: "Scripts decide anything checkable (audit facts, CI, PR
  state); agents judge."
- `skills/autopilot/scripts/ship-pr.mjs:610-622`, `exitCodeFor(step)`: 20 for `wait` and
  `wait-for-review`, 10 for `fix-ci`, `fix-conflicts`, `address-review`, `deploy-failed` and the host
  actions (`mark-ready`, `update-branch`, `merge`), 0 otherwise. The exit code tells the caller
  whether to act, wait or stop; `test/kcd-skills-cli.test.mjs:404` asserts the 10.
- `skills/autopilot/references/templates.md:321-322`: the config is `.github/ship-pr.json` or
  `ship-pr.json`, or `--config`; "Whole-line `//` comments are allowed".

## A thin skill

`skills/ship-pr/SKILL.md:1-40`: a description, when to use it, a risk policy of three bullets, and a
Command section with one invocation; the loop itself is a Kody package or the npm CLI. The skill
carries no procedure of its own.
