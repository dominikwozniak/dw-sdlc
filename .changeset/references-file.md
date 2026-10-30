---
"dw-sdlc": minor
---

References live in `.ai/references.json`, an object with `$schema`, `version` and `references`, validated against `config/references.schema.json`. A `references` key in `.ai/agentic.config.json` is refused by `dw-sdlc references sync` and `dw-sdlc references setup`; the setup moves it into a missing `.ai/references.json` and drops it from the config, keeping the config's layout. A repository with neither gets the file with no References.
