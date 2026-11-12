---
"dw-sdlc": minor
---

The `disable-directives` Check fails every Disable directive in a comment that gives no reason: `oxlint-disable*` and `eslint-disable*` in every form, `@ts-expect-error` and `@ts-ignore`, `rubocop:disable` and `noqa`. A reason is text after `--` on the directive's line, text after an `@ts-` directive, or a comment on the line above. A directive inside a string is none. Its options are `true` or `{ files, exempt }`, and `exempt` defaults to `references/**`, `**/vendor/**` and `**/node_modules/**`. A failure in `--json` carries `directive` beside `file` and `line`.
