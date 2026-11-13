# How a change lands

`main` is protected in `.ai/agentic.config.json`, so a change reaches it through a pull request, and
`quality-gate.yaml` runs `pnpm check` on it first, once it is ready: a draft skips the run. A squash
merge, with `(#NN)` in its subject, skips the run on `main`; any other push to `main` gets it.

A pull request whose every file is content, such as docs, skills and the catalogues under `.ai/`, runs
`pnpm test:content` in place of `pnpm test`: the tests that read the plugins' manifests and skills.
Every other test reads only code and tooling, so a content change cannot break it; a plugin's
release changes its manifest and runs them all. The run is one job of the Shared workflow,
`quality-gate` in the public `byarcadia-app/gh-actions-public`, pinned by its release tag's SHA,
which Dependabot moves.

On GitHub the `main` ruleset asks for a pull request and a green `Check / Check`, the job of
`quality-gate.yaml`. It allows squash merges only, refuses a force push and a deletion, and lets the
admin bypass it. For a small fix the agent commits on `main` and the push comes from Dominik's own
terminal: the guards judge only the agent's tool calls, and the bypass lets that push through. The
bypass also merges the version pull request, on which CI never runs.

Here `pr.merge` is `auto`, so the Ship script merges a pull request it finds ready, with no one asked.
