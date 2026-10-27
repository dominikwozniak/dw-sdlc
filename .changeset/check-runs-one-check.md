---
"dw-sdlc": minor
---

`dw-sdlc check <name> [--json] [--root <dir>]` runs one Check of the Gate by its name: a script under `gate.checks.run` or a Check the package ships, without the Steps and the other Checks. A shipped Check runs on the setting `gate.checks` gives it, and on its defaults where the config sets it `false` or leaves it out. The lines, the exit codes and the `--json` document are the Gate's; a name no Check carries exits 2.
