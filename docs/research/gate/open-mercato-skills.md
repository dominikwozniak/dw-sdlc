# open-mercato-skills — the config file and the routing table

Read from `R/open-mercato-skills` on 2026-10-25, the clone at its `main` ref of that day, plus the live
`.ai/agentic.config.json` of `open-mercato/open-mercato` through the GitHub API the same day.

## The routing table

- `AGENTS.md:7-16`, "Task routing": a table `| When the task involves… | Read first | Key rules |`,
  one row per area. Its rule for skills: "Config values (`baseBranch`, paths, labels, validation
  commands) always come from `.ai/agentic.config.json`, never hard-coded."
- `skills/om-setup-agent-pipeline/references/project-docs.md:1-9`: the setup generates an `AGENTS.md`
  when none exists, "all derived from _this_ repository": an overview, "A **task-routing table** — the
  core of the file", "The validation commands from the config, and pointers to `SDLC.md`,
  `CODE_REVIEW.md`, `BACKWARD_COMPATIBILITY.md`, and `.ai/agentic.config.json`". "Every skill in this
  collection reads them before working."

## The validation key

- `skills/om-setup-agent-pipeline/SKILL.md:60`: "`validation.commands` — ordered list of shell
  commands that constitute the full validation gate. Skills run them in order and treat any non-zero
  exit as a gate failure. Keep the list complete: typecheck, lint, tests, build — whatever proves the
  repo is healthy."
- `skills/om-setup-agent-pipeline/SKILL.md:68`: when CI exceeds `ci.maxWaitMinutes`, "the skill runs
  the local `validation.commands` gate as its completion evidence".
- The live config of `open-mercato/open-mercato` carries the keys `baseBranch`, `browser`, `help`,
  `labels`, `paths`, `qaGate`, `reviewChecklist`, `sessionShare`, `tracker`, `validation`, `version`
  and no `$schema`; `validation.commands` is eight yarn commands: `build:packages`, `generate`,
  `build:packages`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `test`, `build:app`. The list
  is run by skills, not by a script in the repository.

## Hooks

Neither `R/open-mercato-skills` nor `R/kody` has a `.claude/settings.json` or a `hooks` directory
outside `.git/hooks`; the gate and the map reach the agent through the files it reads.
