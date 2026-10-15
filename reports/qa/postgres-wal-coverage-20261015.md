# PostgreSQL WAL byte coverage prerequisite

Issue #405 work in progress. No production recovery point or online release is
admitted by this helper. Continuous capture, base-backup identity, independent
physical replay, file/SQLite/privacy coherence and release integration remain
required.

`scripts/postgres-recovery-coverage.mjs` enumerates exact end-exclusive WAL
coverage using the cluster's actual segment size and timeline. It rejects
ambiguous LSN text, reversed/empty ranges, unsupported sizes and unbounded ranges.
The private Linux file verifier requires complete files, owner-only access,
single-link regular files, exact lengths, matching full hashes and unchanged
file identities during reading. It publishes no metadata and removes no WAL.

Three mapping tests passed. An actual native test used the existing local
PostgreSQL 15.18 service, a uniquely created schema and its own ledger fixture.
It captured a closed 16,777,216-byte WAL segment and parsed the real records with
`pg_waldump`. Existing-backend Linux verification rejected missing/partial files,
wrong-timeline evidence, same-size damage, hardlinks and symlinks. Flipping the
CRC of an actual parsed WAL record made native PostgreSQL reject it. The final
test passed without skips in 15.89 seconds; the inner Linux file fixture passed
without skips. All generated schema/files were cleaned, all cleanup targets
were checked, and a cleanup failure would be reported. No second PostgreSQL
container, daemon or Compose project was started.

Read-only production inspection found PostgreSQL 15.16, timeline 1, 16MiB WAL
segments, `wal_level=replica`, ten sender slots with zero active senders, no
nondefault tablespaces and `archive_mode=off`. `max_slot_wal_keep_size=-1` is
unbounded, so creating an unattended physical slot is not acceptable. The native
base/receive/verify/WAL tools exist in the PostgreSQL image; the backend has the
receive/base tools. No parameter, role, slot, receiver or application was changed
by this investigation.

PostgreSQL documents that [receivewal](https://www.postgresql.org/docs/15/app-pgreceivewal.html)
can stream a running server's WAL and requires `--synchronous` for immediate disk
flush. A slot helps prevent gaps but needs a storage bound. A
[base backup](https://www.postgresql.org/docs/15/app-pgbasebackup.html) can be
taken while clients work. Its native
[verification](https://www.postgresql.org/docs/15/app-pgverifybackup.html) also
checks required WAL, but does not replace a real restore. These facts do not
establish coherent recovery of this application's external files or Inquiry.

Independent Standards and Spec reviews found no actionable issue within the
private captured-file contract. The helper does not fence another writer;
callers must keep captured objects immutable and bind expected hashes to trusted
source and independently read-back evidence.
