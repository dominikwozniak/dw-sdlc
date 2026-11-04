---
"dw-sdlc": minor
---

`agents-map` fails when `CLAUDE.md` at the repository root is missing, a file of its own, or a symbolic link to anything but the map's path from the root, so Claude Code reads the map the Gate judges in every clone. Each failure names the remedy, `ln -s AGENTS.md CLAUDE.md` for the default map. A map that `file` names `CLAUDE.md` needs no link.
