---
name: sdlc-doctor
description: >-
  Check this machine and repository for the sdlc plugin: one PASS / WARN / FAIL line each for jq,
  the plugin enabled, the plugin's dw-sdlc package against the one the repository pins, rtk, Safe
  Chain, pnpm's release age, commit signing and the resolved config. Read-only.
argument-hint: "[repository path]"
disable-model-invocation: true
---

# sdlc-doctor

Run the doctor from the repository's root and show its lines as they are. With a path in
`$ARGUMENTS`, add `--root <path>` to diagnose that repository instead.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" doctor
```

It installs nothing and exits 1 on a FAIL. Each WARN and FAIL names its remedy; run one only when the
user asks for it. A `package` line that starts with `drift:` means the plugin's hooks and skills run
another `dw-sdlc` than the repository's Gate; the line names the update that brings the two in step.
