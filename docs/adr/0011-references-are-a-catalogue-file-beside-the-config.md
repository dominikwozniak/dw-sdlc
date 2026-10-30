---
status: accepted
---

# A repository's References are a catalogue file beside its agentic config

The References a repository reads live in `.ai/references.json`: a `$schema`, a `version` and a
`references` list, per entry the directory, the repository, the ref, the paths to keep or skip, what
it is and when to reach for it. The file sits at a fixed path, and no config key moves it.
`.ai/agentic.config.json` holds the rules an agent works by: the guards, the commit convention, the
Gate. A list of repositories with a paragraph of prose each is a catalogue, the same kind of thing as
`.ai/primitives.json`. Kept as a key of the config, it took most of the file and buried the rules.
A file of its own also points its `$schema` at the References schema, so an editor completes and
checks every entry, which no key of the config could get while the file's `$schema` is the guardrails
schema.

## Consequences

A repository's agent setup spans two committed files, each validated against its own schema. A
`references` key left in the agentic config is refused by the Sync and the setup alike, so the file
stays the only list; `dw-sdlc references setup` moves such a key into a missing file and drops it
from the config, and refuses when both hold References. A config the guards cannot read never stops
the Sync, since the Sync reads the config only to find that key. The setup writes the Router's
table from the file, between its two markers.
