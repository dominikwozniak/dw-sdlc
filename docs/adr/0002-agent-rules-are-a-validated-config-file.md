---
status: accepted
---

# How a repository works for an agent is a validated config file, not prose

Every guard needs policy per repository: the commit pattern, the package manager, the protected
branches, the env-file rule. It lives in one committed `.ai/agentic.config.json`, with an optional
`.ai/agentic.config.local.json` over it, both validated against the JSON Schema the plugin ships, by a
TypeScript validator and its jq twin; a key nobody sets is inferred from the repository, so a
repository with no file still works. Bullets in `AGENTS.md` that a guard parses are frictionless to
edit and as easy to break silently, and Open Mercato's tooling already reads a file of this name, so
another tool family can share it.

## Consequences

A validator in two languages kept in step by one test list, and a schema `$id` to keep stable.
Unknown top-level keys are tolerated for that sharing; the keys named here refuse unknown children.
