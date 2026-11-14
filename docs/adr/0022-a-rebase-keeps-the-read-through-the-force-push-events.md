---
status: accepted
---

# A rebase keeps the Review's read through the timeline's force push events

`fix-conflicts` rebases the branch, and a rebase gives every commit a new oid. The `dw-sdlc/review`
statuses stay on the old commits, so the history holds no head a Review read. From the history alone
the Ship script reads the whole pull request from the base again, at the depth `auto` routes the whole
of it to. On #429 that cost a second `full` Review of own changes byte-equal to a head just reviewed clean. On a
large pull request every rebase restarts the loop ADR 0016 closes.

So when the history holds no read, the script reads the last 20 `HeadRefForcePushedEvent`s of the pull
request's timeline in the same GraphQL query. Each names the head it left behind, `beforeCommit`, with
that head's review status. The newest such head a Review read, clean or not, stands in for the read the
history lost. Then the rules of a merge of the base apply. A clean read whose own changes, compared
through GitHub against the base, are the head's carries its success as "carried from <sha>". Any other
read is `details.since`, and `details.paths` names the files whose own change moved. A read mark the
rebase left with its own changes as they were is passed over, since no fix answers its Findings yet,
and the read before it never carries. The read marks on left-behind heads count toward the
three-Review limit.

## Consequences

The read lives where GitHub keeps it, so a new session finds it as the old one left it. Three sources
were weighed. The timeline names every head a force push left behind, with its statuses, in the one
query the script already makes. The status API by context needs the commit first, and that commit is
the thing a rebase lost. A mark that names its own changes still sits on a commit the history no longer
holds, so it needs the timeline to be found too. Only the head a force push left behind is read, not
the commits under it. A read mark on a commit with a fix pushed after it and a rebase after that is
missed. The Review then reads from an older read, or from the base, which is a wider read, never a
narrower one, and that mark leaves the count. A compare GitHub refuses for a head left behind stops
the call with exit 2, as any compare it refuses does. After a rebase `<since>` is not an ancestor of the head. The skill diffs it with two dots
and fetches it by oid when the checkout lacks it.
