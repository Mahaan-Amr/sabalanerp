# Retired completed independent-restore PostgreSQL workspace

On 2026-10-17 the reviewed fixture retired the completed private DR server's
working PostgreSQL copy. Frozen source `821d3e53`, fixture SHA-256
`8e31f8f6db7c4a8c85146fab8cbd8856d6dbee129e49a1f786bbd52367a9fddf`.
Both independent Standards and Spec reviews passed before execution.

Under the private drill FD9 and backup storage locks, it reread both healthy,
inactive, unheld encrypted recovery archive hashes, the complete immutable image
archive and retained independently decryptable physical component. It verified
the prior full restore receipts and the exact private container/start identity,
isolated networking, unprivileged/non-host PID configuration and PGDATA mount.

Only container `1330c530d388bafae86368805e1e6af5118da892f00724bc5d361b694ff0ebb6`
was stopped, with no kill deadline. The native process owner proved actual
command/descendant completion. Docker reported exited status 0, PID 0 and no OOM;
container removal used no force. After checking all remaining container mounts,
private mount propagation, nested mounts, ownership and regular/non-hardlinked
entries, the fixture removed only
`/srv/sabalanerp-drill/20261014-independent/postgres` (4,909 working files).
The directory's measured Alpine owner was UID70; the initial unexecuted draft's
assumed UID999 and staged-helper filename were corrected and independently
reviewed before execution. The actual deletion source was the final hash above.

Free bytes changed from 3,242,442,752 to 3,936,952,320 during the operation;
the observed difference also includes concurrent foreign activity. A subsequent
read measured 3,927,035,904 bytes. This exceeds the 3.5 GiB full-drill working
budget at that instant, but each heavy operation still needs fresh preflight.
Both complete restore-verified archives, compatible image bytes, encrypted
physical component, keys and forensic evidence remain. Eleven stable Fintech
container identities/start times stayed unchanged. The created R2 forensic tool
was preserved. No production service or database was updated.

[Native receipts and before/after evidence](private-restore-postgres-retirement-20261017.json)
include the exact stop/remove descendant-reaping receipts and retained-point
identities. The private working PostgreSQL service and old restored file trees
are now absent: a future full drill must recreate an isolated working cluster
and restore it from the independent archives. Earlier successful full-restore
proof remains historical evidence, not a claim that a restored app is still up.
