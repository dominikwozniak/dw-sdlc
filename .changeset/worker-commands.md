---
"dw-sdlc": minor
---

`dw-sdlc worker start`, `worker ls` and `worker report` start, list and hear from a Lead's Workers in herdr, so a Lead no longer writes `hc` lines by hand. They refuse outside a herdr terminal.

`worker start --brief <file> --name <name>` runs `hc run` in the background with the name, the label `role=worker`, `--outlive-parent` and the repository as the folder, then `worker.command` with `--worktree`, `--model`, `--effort` and the Brief as the first message. The model and effort default to the config's `worker.model` and `worker.effort`. It refuses a fourth live Worker of the same Lead unless `--max-workers` allows it, names the Worker's herdr tab, and exits 1 when herdr did not deliver the first message.

`worker ls` lists the Lead's Workers with their state, status and folder. `worker report --to <lead> --recap <file>` delivers a Recap, as its path when it is long; while the Lead is blocked it waits and sends again, never with `--force`, and exits 1 when it gives up.
