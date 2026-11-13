# Security policy

## Supported versions

| What                                   | Supported               |
| -------------------------------------- | ----------------------- |
| the `dw-sdlc` package on npm, `0.x`    | the latest release only |
| the `sdlc` and `sdlc-sessions` plugins | the latest release only |

Fixes land on the latest version. There are no backports.

## Reporting a vulnerability

**Do not open a public issue for a security report.**

Use GitHub's private reporting instead:
[**Report a vulnerability**](https://github.com/dominikwozniak/dw-sdlc/security/advisories/new). It
opens a draft advisory only you and the maintainer can read.

Include what you can:

- what the issue is, and what an attacker gets out of it
- the versions: `dw-sdlc` from the repository's lockfile, and the plugin's from `claude plugin list`
- steps to reproduce, or a proof of concept: the tool call payload, the command, the config
- the operating system, and `bash --version` and `jq --version`

## What to expect

| Step                                    | When                            |
| --------------------------------------- | ------------------------------- |
| Acknowledgement                         | within 72 hours                 |
| Assessment, and whether it is confirmed | within 7 days                   |
| A fix or a mitigation plan              | within 30 days of confirming it |

This is one person's project, not a staffed security team. The timings are what is realistic, and
you will hear if something slips.

## Scope

The guards, the bin and the skills run on your machine, under your account, with your `gh` token. In
scope:

- a command a guard documents as refused or asked about that reaches the shell unasked
- a machine's layer of the config, `.ai/agentic.config.local.json`, loosening a rule it may only tighten
- the content of a pull request, an issue, a branch name or a reference reaching a shell, a spawned
  process's arguments or a hook in a way that was not intended
- a write to git or GitHub by the Ship script, the Sweep or a skill beyond what its docs name
- a credential or token written, printed or sent where it should not be

Out of scope: vulnerabilities in Claude Code, `gh`, `git`, `jq`, Bash or Node themselves, which go to
their own projects; anything that needs an attacker to already have your shell; a guard that stays
silent without `jq`, which the doctor reports.

## Disclosure

Coordinated. Give the fix reasonable time before you go public, and you will be credited in the
release notes unless you would rather not be.
