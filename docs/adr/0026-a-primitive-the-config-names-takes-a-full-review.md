---
status: accepted
---

# A Primitive the config names takes a full Review whatever its size

Under `pr.review: auto` the depth follows the size of the change (ADR 0013), so a 20-line change to a
guard gets the `light` read, though a small wrong change there does damage that is hard to undo. A
repository needs a way to name those parts and have them always read in `full`.

`pr.reviewFull` in `.ai/agentic.config.json` is a list of Primitive ids: exact ids, no globs and no
groups. Under `auto`, a changed file, or its name before a rename, that the `code` of a listed Primitive
names routes `full` whatever the size. The match is the one `dw-sdlc primitives --paths` makes: the
Primitive whose `code` entry is nearest the path, a file over the directory holding it. The rule lives
in the config (ADR 0002, ADR 0011), the paths in the catalogue the `primitives` Check holds to the tree,
found through `gate.checks.primitives.file`. `.github/workflows/` stays a built-in rule, and lockfiles
alone still route `off`.

- The dev's `--review <depth>` and a `pr.review` set to a depth still stand (ADR 0013). The agent may
  raise a depth `auto` routed, never lower one.
- It fails closed: the key is set and the catalogue is missing or unreadable, or a listed id is not in
  it, and every change routes `full`. The `primitives` Check reports each such id as a Finding.
- The local layer adds ids. The resolved list is the union of the layers, so a layer never removes an
  id. This keeps the strictness rule of ADR 0003: a layer only tightens.
- dw-sdlc ships no default ids; ids belong to each repository's catalogue. The schema says to list
  narrowly, only Primitives where a small wrong change does damage that is hard to undo. A wide list
  turns every change into a `full` Review.

## Considered Options

- Path globs in the config. Rejected: a second list of paths beside the catalogue that nothing holds to
  the tree, and a rename leaves it stale.
- A field on the Primitive in the catalogue. Rejected: the catalogue says what is true of the tree, not
  how closely to review it, and the local layer could not add to it.
- The agent only being told, in the skill. Rejected: the agent may raise a depth but it is not
  repeatable, and nothing fails when it does not.
- Asking the dev on each pull request. Rejected: the Review depth exists so no one is asked (ADR 0013).

## Consequences

A repository's guards, its release script and its config resolver can take a full Review on a one-line
change. A listed Primitive whose code is a broad directory pulls most changes into `full`, so the list
stays short. Renaming or removing a listed Primitive fails the `primitives` Check until the list agrees.
