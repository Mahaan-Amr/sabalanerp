# Independent native restoration of the production physical component

The actual production physical base, independently RSA-decrypted on the backup
server, passed native `pg_verifybackup` and booted using its exact PostgreSQL
15.16 image. Both native owners completed successfully. PostgreSQL stopped
normally; the actual container is exited, PID zero, exit zero, without OOM or
`postmaster.pid`. The independent key never left the backup host.

| Restored observation | Result |
| --- | --- |
| System identifier | `7609810350852628513` |
| Server version number | `150016` |
| Finished, active migration records | 425 |
| Migration name/checksum identity MD5 | `e47df486d5c205d3bc44cb782dfbf09d` |
| Unfinished active migrations / prepared transactions | 0 / 0 |
| Users / sales contracts / ledger vouchers | 30 / 761 / 0 |
| Backup source SHA-256 | `c4b485ccc756ea48e08a72ea9c8dbdfd00aa9d1a892c63b0788985f699957c09` |
| Exact image config | `sha256:15283455b75304c90f51bf16b42c272a25fb52807945dc24830ec88e63cd896d` |

The migration identity is measured from all sorted active names and checksums,
not only their count. MD5 here identifies that SQL observation; SHA-256 binds
the actual base, manifests, encryption and immutable image bytes. These are
restored snapshot counts, not a comparison with the later live production DB.

The confined container reused the existing backup drill project, with no
network or ports, read-only root, dropped capabilities, UID70, bounded memory,
CPU, PIDs, tmpfs and native storage reserve. All mounts were explicit and
verified. Native backup verification preceded configuration sanitization of
the **fresh restore copy**. Inherited external hooks were disabled. The source
base and retained encrypted object were unchanged. Only read-only verification
queries ran against the restored database; no candidate migration was applied.

The first attempt queried before startup recovery finished. Its trap stopped
PostgreSQL normally, and both native owners issued exit-two reaping receipts.
The controller retained ownership. Reviewed exact closure bound original
lock descriptions, process births, source and log hashes, actual terminal
container and absent descendants before terminating only the idle diagnostic
holder by pidfd. A transient zombie guard prevented final closure in that
first closure invocation; a separately reviewed signal-free continuation
reacquired the same locks, reverified evidence and archived the exact failed
intent. Every failed attempt remains unaccepted and retained.

The corrected script waits for `pg_isready` within a bounded interval and sets
connection/query deadlines. The controller distinguishes proven failed-native
closure from successful restoration and natural shutdown. It removed only the
exact closed prior diagnostic container without force, preserving all bind
data and failure evidence. The successful operation durably recorded actual
native and daemon closure before observing foreign workloads and archiving
its own intent.

**The broader ambient comparison remains false:** foreign inventory changed
from 18 to 17 when one unrelated container disappeared. All surviving 17
identities/images/start times were unchanged. No causation or whole-host
acceptance is inferred. Spec and Standards reviews passed the frozen executed
sources and scoped evidence after execution.

Evidence:

- [Successful physical-component result](native-production-base-98b8b8d122ff42b990376b69eba155f9.json).
- [Successful operation intent and source hashes](native-production-base-98b8b8d122ff42b990376b69eba155f9-intent.json).
- [First failed operation](native-production-base-ebbdac10f1914036827d94e7069d8c01.json).
- [First failed operation source identity](native-production-base-ebbdac10f1914036827d94e7069d8c01-intent.json).
- [Initial closure refusal](failed-base-closure-87dfc2fa8f1a4c408f9e1ed8b2b943d6.json).
- [Final signal-free closure](failed-base-closure-8ae28338850c4adf802757bc56055c6a.json).

Frozen public controllers and both shell revisions are retained in
`production-base-private-orchestrators-20261018/`. This proves a restored
production **database component**. Continuous WAL after the base, coherent
business files, Inquiry/coordination/privacy state, the current application
image set and full application restore remain required. No new healthy
production recovery point, online release, DDL admission or traffic switch was
published. The successful diagnostic container is stopped and retained pending
its next explicit retirement/recovery step.
