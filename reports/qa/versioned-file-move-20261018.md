# Private two-key file relocation

`VersionedFilePublication.move` binds an exact source version to a no-clobber
destination. It retains both durable key intents until independent destination
bytes, source deletion history and the pair receipt have been persisted and
read back. Ordinary writes to unrelated keys can continue. Interrupted pairs
retain their claims and cannot become a successful capture or implicit replay.
This is the storage primitive for later HR staging/restore integration, not an
activated HR route or physical privacy erasure implementation.

The initial native test failed because the interface was absent. A subsequent
independent review found that known, unstarted capacity refusals stranded both
claims. The two specific regressions reproduced that defect before repair:
[4 PASS / 2 FAIL evidence](versioned-file-move-capacity-red-20261018.json).
The pair owner now closes its internal iterator, verifies both original
heads/live identities and exact claims, and retires only these known refusals.
Other failures keep their intents.

Current writer SHA-256:
`cbc82e980372af9f7a57a2c8600ab7a3b2ba4d6981c5f9b7797f21e03d1c95cb`.

- [Move acceptance](versioned-file-move-5188d6b4dba820563b09d52049b191fc.json): 6/6, including real concurrent capacity ownership, full inventory, stale source/no-clobber restoration, both-key fencing with unrelated writes, foreign intent preservation and actual disposable Node process death after the destination head became durable.
- [Core publication](versioned-file-publication-b7d3751b09c40aba855cbf01ef16abfb.json): 10/10.
- [Legacy adoption](versioned-file-legacy-78d797d3bcd050f55b84a8881dda7464.json): 7/7.
- [Stream publication](versioned-file-stream-4843a08eb12a5bc597bdc77bd78ed4b9.json): 11/11.
- [Multipart](versioned-upload-b19f229111f9ca719066430bb3b4ea81.json): native regressions passed.

All reports identify their actual source and unchanged canonical local services.
Final backend TypeScript validation passed. Both independent reviewers accepted
the repaired focused slice; these tests do not grant public release authority.
