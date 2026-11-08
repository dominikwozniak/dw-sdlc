---
"dw-sdlc": patch
---

`dw-sdlc doctor` warns on its `hc` line when `hc` is absent and `sdlc-sessions` is enabled, since `/sdlc-delegate` then has nothing to start Workers with; without that plugin the line stays INFO. The `sessions` line of a machine without the plugin names all three of its skills and the command that installs it.
