---
"dw-sdlc": minor
---

The Gate ships `skill-sections`, a Check that holds each README section a skill copies between `<!-- README.md#<anchor> -->` and `<!-- /README.md#<anchor> -->` to its source. It fails a part that differs from its section, a part whose anchor names no heading, a part no Primitive lists among its docs, and a marker without its pair. `dw-sdlc check skill-sections --write` writes each part from its section.
