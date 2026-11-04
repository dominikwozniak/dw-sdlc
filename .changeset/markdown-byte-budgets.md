---
"dw-sdlc": minor
---

Markdown is held by byte budgets alone, and `file-size-ratchet` holds code. `agents-map` holds the agent map to 10240 bytes and counts no lines. `markdown-budget` holds each glob to `maxBytes`, by default `docs/agents/*.md` at 6144 bytes; a list of budgets replaces the default, such as one that adds `GLOSSARY.md` at a budget of its own. `file-size-ratchet` defaults to its `tests` and `source` groups, so it judges no markdown file; a baseline entry for a markdown file is a stale entry, which `dw-sdlc gate --update-baseline` drops. The schema refuses `maxLines` under `agents-map` and under a `markdown-budget` budget, so a config that sets it makes the Gate exit 2, naming the key, until the key goes.
