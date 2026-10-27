# dw-sdlc

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
