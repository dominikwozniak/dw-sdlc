# Contributing

`dw-sdlc` is the tooling one person holds their agentic workflow with, published so a few others can
use it. It is shared as it is: issues are welcome and answered when there is time, and the guards,
skills and commands change between minor versions when the workflow does.

## Issues, not pull requests

Open an issue for a bug, a guard that refuses or lets through the wrong command, or an idea. Pull
requests from outside the repository are not merged; a fix worth having comes back as an issue, with
the reproduction, and lands from here.

A security issue never goes in a public issue: see [SECURITY.md](./SECURITY.md).

## Setup

```sh
pnpm install
pnpm check
```

Node 24 and pnpm, the version pinned in `package.json`. `pnpm check` is the Gate, the one command a
change must pass, and what CI runs. The rest is in [docs/contributing/](./docs/contributing/development.md);
[GLOSSARY.md](./GLOSSARY.md) says what a word means here, and `docs/adr/` why it works this way.

## License

By contributing you agree that your contributions are licensed under the [MIT License](./LICENSE).
