---
name: sdlc-doctor
description: >-
  Check this machine and repository for the sdlc plugin: one PASS / WARN / FAIL line each for jq,
  the plugin enabled, rtk, Safe Chain, pnpm's release age, commit signing and the resolved config.
  Read-only.
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
user asks for it.
