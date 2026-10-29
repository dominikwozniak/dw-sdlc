# dw-sdlc

## 0.5.0

### Minor Changes

- f30acad: `comment-budget` reads the JavaScript, TypeScript and shell (`.sh`) files under its `roots`, with one budget and one failure line for all three. A shell block is a run of `#` lines, each alone on its line. A `#` opens a comment only where it starts a word of code, so a quote, a `${…}`, an arithmetic `((…))`, a heredoc body and the shebang on line 1 hold none. A shell block over the budget fails the Gate, as a JavaScript one does.

## 0.4.0

### Minor Changes

- a3f8c96: `dw-sdlc check <name> [--json] [--root <dir>]` runs one Check of the Gate by its name: a script under `gate.checks.run` or a Check the package ships, without the Steps and the other Checks. A shipped Check runs on the setting `gate.checks` gives it, and on its defaults where the config sets it `false` or leaves it out. The lines, the exit codes and the `--json` document are the Gate's; a name no Check carries exits 2.
- e5ca2bc: `dw-sdlc setup` adopts the Gate in a repository with a `package.json`: `--add-package` pins `dw-sdlc` as a devDependency at the version that runs the setup, refused without the flag, and the committed config gains a `gate` key when it has none, with `agents-map`, `markdown-refs`, `temporal-language` and `comment-budget` on and every other Check `false`. A machine whose settings still enable `guardrails@dw-sdlc` or `references@dw-sdlc` gets a `by hand` line with the `enabledPlugins` edit.

## 0.3.0

### Minor Changes

- 7dd29fd: The doctor and the setup read the `sdlc` plugin, the one plugin of the dw-sdlc marketplace in place of `guardrails` and `references`, and the doctor's `package` line names a drift between the `dw-sdlc` the plugin links and the one the repository pins.

## 0.2.0

### Minor Changes

- a2a99c7: Four Checks over markdown: `markdown-budget` holds the files a glob matches to line and byte budgets, `markdown-refs` fails a relative link or heading anchor that does not resolve, `temporal-language` fails a changelog phrase in a durable document, and `decision-records` holds the decision records to numbers without a gap, a title and an allowed status.
- 8b6da18: The `file-size-ratchet` and `comment-budget` Checks, and `dw-sdlc gate --update-baseline`, which records a Ratchet's baseline where there is none and otherwise only tightens it.

## 0.1.0

### Minor Changes

- f3487cd: The first release: the `dw-sdlc` bin with `dw-sdlc gate`, and the config resolver with its JSON Schema, as JavaScript.
