---
status: accepted
---

# A read mark no commit answers makes the Review read the whole pull request

A read mark stays open when no fix shows after it. That is a read mark on the head itself, or one any
commit came after with the own changes as it read them: a merge of the base, a rebase, or a commit of the
branch's own, as an empty one that runs CI again. After the branch's own commits alone, the compare of the
changes since the mark shows none. After a merge or a rebase, the own changes at both commits are the
same, compared through GitHub against the base, and a compare that cannot show them whole, as with a
binary file, shows no fix either.
No fix answers its Findings. The Findings live only
in the conversation of the session that reviewed. Take a clean read, then a read mark on the same own
changes, then a merge or a rebase. A Review from the clean read has nothing to read, so a fresh session
would post a success over Findings that still stand. A carry of the clean read's success would post one
with no Review at all.

So the Ship script names that read mark in `details.open` and takes no read in its place. The Review
reads the whole pull request from the base, routed on the whole diff, and nothing carries. A session that
holds the mark's Findings fixes them and pushes first, and the next call reads the fix from the mark. A
session that holds none runs the whole Review. Its Findings stand in for the mark's, and only a clean one
clears it. A read mark with only merges after it is open with no compare.

The three-Review count reads each head a force push left behind and the commits under it. The walk goes
down first parents, within the first 20 commits of that head's history, and stops where it meets the
history or a newer push's line. A fix pushed after a read mark hides the mark from the force push event,
which names only the fix. The walk finds the mark again, and it counts.

## Consequences

The compare after a read mark decides whether the mark's Findings still stand: it shows whether a fix
came after them. When GitHub refuses it, the script cannot tell a fix from none, so `pr ship` exits 2
naming the compare and posts no success.

The narrowest reads were weighed and rejected. A Review from the read before the mark finds the mark's
Findings again only when the mark's Review read that same range. A dev's `--review` over a carry reads
the whole diff, and a Review from the clean read then reads nothing. Naming the mark while keeping
`since` leaves a range the agent never uses and routes `auto` on the wrong diff. Carrying the mark in a
field outside `details` keeps the range out of the place the agent reads it. The whole read costs one
full Review for a session that lost the Findings. A session that kept them pays nothing.

A pull request with a file the compare shows no patch for, as a binary file, gets a whole Review after
each merge or rebase that follows a read mark, the fix or not. A fix GitHub cannot show is no fix the
script can see. Under `off`, the dev's word, the script still posts its success over an open
mark: its description says no one read the head.

The first-parent walk stays on the branch: the first parent of a merge of the base is the branch. Past
the fork point it reaches the base's own line, where no commit carries a review status, because the
script squash-merges. GitHub's history of a head holds the base's commits a merge brought in too, so a
busy base shortens the walk. A read mark past it leaves the count, as one past the 100 commits of the
history does.
