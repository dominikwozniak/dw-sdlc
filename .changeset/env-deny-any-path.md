---
"dw-sdlc": minor
---

`guardrails.envFiles.deny` reaches any path, not only env-named files. The default `deny` gains `**/config/master.key` and `**/config/credentials/*.key`, a Rails app's keys. A `deny` list in a layer replaces the default one, and a local layer that leaves a default entry out loosens, so it is dropped. The setup writes a deny rule for each such file git knows.
