---
status: accepted
---

# A repository's References are a key of its agentic config that the references plugin owns

The References a repository reads are the top-level `references` key of `.ai/agentic.config.json`:
per entry the directory, the repository, the ref, the paths to skip, what it is and when to reach
for it. The `references` plugin ships the key's schema and validates it on every Sync. The guardrails
schema does not name the key, so it is one of the unknown top-level keys ADR 0002 tolerates: ADR 0003
drops an invalid layer whole and runs the strictest set, and a typo in a Reference would otherwise
refuse lease pushes and every env file. A markdown table read by its header names breaks on a
renamed column, and a separate `.ai/references.json` splits a repository's agent rules across two
files.

## Consequences

An editor completes nothing under `references`, since the file's `$schema` is the guardrails schema.
The Router keeps the rules for reading References and carries a table of each one's `dir` and `when`,
which the setup writes from the key between two markers, so an agent learns from that one file which
clone to open and reads `what` and the other fields in the key when it needs them. The key stays the
only source: a table behind it is one line at session start and a failed check, never a second list.
