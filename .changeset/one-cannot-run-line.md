---
"dw-sdlc": patch
---

`setup`, `config`, `doctor`, `references sync` and `references setup` print what stops them as `dw-sdlc <command>: <problem>`, as every other command does, in place of their `guardrails:setup:`, `agentic:check:`, `guardrails:doctor:`, `references:sync:` and `references:setup:` prefixes, and every exit code stays as it was; `setup` in a checkout whose git dir lies outside it, as a submodule's, writes the local layer and settings into the checkout instead of beside the git dir.
