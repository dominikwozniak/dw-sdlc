---
"dw-sdlc": minor
---

`dw-sdlc setup` adopts the Gate in a repository with a `package.json`: `--add-package` pins `dw-sdlc` as a devDependency at the version that runs the setup, refused without the flag, and the committed config gains a `gate` key when it has none, with `agents-map`, `markdown-refs`, `temporal-language` and `comment-budget` on and the other Checks `false`. A machine whose settings still enable `guardrails@dw-sdlc` or `references@dw-sdlc` gets a `by hand` line with the `enabledPlugins` edit.
