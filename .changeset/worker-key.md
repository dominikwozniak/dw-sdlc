---
"dw-sdlc": minor
---

The agentic config takes a `worker` key: `command`, the words that start a Worker's Claude Code session before its own flags (default `claude`), `model` (default `sonnet`) and `effort`, one of Claude Code's levels `low`, `medium`, `high`, `xhigh` and `max` (default `high`). Any layer sets any key; the key has no strictness order, and an invalid layer keeps what the valid layers name. `dw-sdlc config` shows the resolved key. `dw-sdlc setup` writes `worker.command` as `cswap run -- --dangerously-skip-permissions` into the local layer when `cswap` is on PATH, keeps a command already there, writes nothing without `cswap`, and shows the write on `--dry-run`.
