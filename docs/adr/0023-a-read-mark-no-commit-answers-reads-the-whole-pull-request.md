---
status: accepted
---

# A read mark no commit answers makes the Review read the whole pull request

A read mark stands open when only merges of the base come after it, or when a rebase leaves the own
changes as the mark read them. No fix answers its Findings. The Findings live only in the conversation
of the session that reviewed. Take a clean read, then a read mark on the same own changes, then a merge
or a rebase. A Review from the clean read finds nothing to read, so a fresh session posts a success over
Findings that still stand. On the merge path the script even carried the clean read's success over the
mark with no Review at all.

So the Ship script names that read mark in `details.open` and takes no read in its place. The Review
reads the whole pull request from the base, routed on the whole diff, and nothing carries. A session that
holds the mark's Findings fixes them and pushes first, and the next call reads the fix from the mark. A
session that holds none runs the whole Review. Its Findings stand in for the mark's, and only a clean one
clears it.

The three-Review count reads each head a force push left behind and the commits under it. The walk goes
down first parents, at most 20 of that head's history, and stops where it meets the history or a newer
push's line. A fix pushed after a read mark hides the mark from the force push event, which names only
the fix. The walk finds the mark again, and it counts.

## Consequences

The narrowest reads were weighed and rejected. A Review from the read before the mark finds the mark's
Findings again only when the mark's Review read that same range. A dev's `--review` over a carry reads
the whole diff, and a Review from the clean read then reads nothing. Naming the mark while keeping
`since` leaves a range the agent never uses and routes `auto` on the wrong diff. Carrying the mark in a
field outside `details` keeps the range out of the place the agent reads it. The whole read costs one
full Review for a session that lost the Findings. A session that kept them pays nothing.

The first-parent walk stays on the branch: the first parent of a merge of the base is the branch. Past
the fork point it reaches the base's own line, where no commit carries a review status, because the
script squash-merges. A read mark deeper than 20 commits under a left-behind head leaves the count, as
one past the 100 commits of the history does. A read mark on the head itself is not open: a Review reads
from the read before it, as before.
