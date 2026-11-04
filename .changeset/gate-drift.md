---
"dw-sdlc": minor
---

`dw-sdlc gate` watches every Step for Drift, on by default. Before and after each Step it records the content of every file git tracks or would track, and each file the Step created, changed or deleted fails the Gate, exit 1, as `packages/x/package.json: drift: "pnpm build" changed it — commit the change, or make the Step only read`; `created it` and `deleted it` name the other two. Drift does not stop the Steps after it or the Checks, `--json` carries each one in `failures` under the rule `drift`, and `--update-baseline` refreshes no baseline after it. Ignored files and edits made before the run never drift, so a stale generated file fails a local `pnpm check` as it fails a `git diff --exit-code` in CI. A tree the Gate cannot record, such as a directory outside git, makes it exit 2. The key `gate.drift` takes `"fail"`, the default, or `"allow"`, which turns the watch off for a repository whose Steps must write.
