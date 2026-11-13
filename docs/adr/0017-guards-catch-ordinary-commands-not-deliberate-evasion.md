---
status: accepted
---

# The guards catch an agent's ordinary commands, not a deliberate evasion

The guards read a Bash command with a word walker in bash, and bash accepts more spellings of a command
than any walker reads: one adversarial pass of 376 inputs (#318) found 35 causes that let an input past
a guard's own rule. A guard is held to the commands an agent writes in ordinary work. A spelling only a
deliberate evasion writes is a Known limit: the plugin's README lists it under Known limits, and it is
fixed only when the fix of an ordinary command closes it in passing. Two things hold whatever the
spelling: no input turns every guard off at once, and a payload the dispatcher cannot read is refused,
not passed. A machine without `jq` still passes every call, since the setup's `permissions.deny` rules
and the doctor's `jq` FAIL stand behind it. A rule names the commands it refuses, not every route to
the same effect: `find -exec rm`, `git submodule foreach` or a Read of `~/.ssh/id_rsa` stay outside a
rule until that rule is widened as a decision of its own.

## Considered Options

Holding the guards to a deliberate evasion as well is rejected: no walker reads every spelling bash
accepts. A real shell parser closes the cut points but not the rules on globs, `cd`, options and
spellings; whether one fits a hook that runs on every Bash call is measured in #331 and answered in
ADR 0018, which keeps the word walker.

## Consequences

An agent that sets out to get past a guard can; the guards stop a mistake, not an adversary. A Known
limit that turns up in ordinary work leaves the list and gets a regression test. A Bash call whose
payload holds a byte the dispatcher cannot split is refused, even when the command itself is harmless.
