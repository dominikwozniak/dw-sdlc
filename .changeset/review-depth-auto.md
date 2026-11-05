---
"dw-sdlc": minor
---

`pr.review` takes `auto`, the new default, between `full` and `light`: strictest first full, auto, light, off. Under `auto` the Ship script routes the Review depth from the changes the Review would read, read through GitHub's compare from `details.since`, else the base, to the head. Lockfiles alone route `off`, posted as `off: lockfiles only`. A file under `.github/workflows/`, more than 100 changed lines outside lockfiles, or a change the script cannot size routes `full`: 300 files, more than the compare lists, or a file outside lockfiles the compare shows no patch for, such as a binary one. The rest routes `light`. The answer names `source: auto` and `details.reviewCommand` at every depth, so the agent may raise a routed `light` to `full`. An invalid layer still runs `full`. A carried status's `details` name only `since`: a carry reads at no depth.

A depth the dev names with `--review` beats a carried status: `full` and `light` read the whole diff since the base, and `off` posts the status as `off: --review off`.
