---
"dw-sdlc": patch
---

`setup`, `config`, `doctor`, `references sync` and `references setup` print what stops them as `dw-sdlc <command>: <problem>`, as every other command does, in place of their `guardrails:setup:`, `agentic:check:`, `guardrails:doctor:`, `references:sync:` and `references:setup:` prefixes; every exit code stays as it was.
