---
status: accepted
---

# Share the Partner read boundary while excluding writers

Partner read snapshots take a `FOR SHARE` lock on the legacy operations-control row, while mutations retain `FOR UPDATE`. This lets independent readers proceed concurrently instead of serializing long Accounting dashboard reads, and still makes a writer wait until every earlier authorized snapshot completes. Readers keep the repeatable-read transaction, ordered resource authorization locks, audit decisions, and retry on serialization or deadlock failure; removing the boundary or serving a cached authority decision would be faster but could admit a mixed or stale permission view.
