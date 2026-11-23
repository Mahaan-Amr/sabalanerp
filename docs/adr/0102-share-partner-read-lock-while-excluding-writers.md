---
status: accepted
---

# Share the Partner read boundary while excluding writers

Partner read snapshots take a `FOR SHARE` lock on the legacy operations-control row, while mutations retain `FOR UPDATE`. This lets independent readers proceed concurrently instead of serializing long Accounting dashboard reads, and still makes a writer wait until every earlier authorized snapshot completes. Readers keep the repeatable-read transaction, audit decisions, and retry on serialization or deadlock failure. Reads that use command authorization keep its ordered resource locks.

The responder workspace uses the shared operations-control lock and evaluates inquiry, profile, assignment, and permission data from the same repeatable-read snapshot. Its authorization audit inserts do not need locks on those resources. Acquiring command locks during that projection lets a list request deadlock with a writer that already holds the profile and needs the inquiry. Displayed response availability is advisory. The response command authorizes again under its existing locks and records its own decision.
