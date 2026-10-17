# Registered backend census and composed v2 capture

The private coherent worker now checks the registered backend namespace before
its v2 capture. It proves actual capture ancestry and inherited FD9/10/11/12,
the same owner's durable CLOSING record, bounded exhaustive native/work inventories,
actual read-only grants and exact work/native identity links. Prepared namespaces
must be genuinely unclaimed/unlocked. Live HTTP actors retain their private lock
and have QUIESCENT work journals; closed actors retain valid native closure and
the exact original ACTIVE hash. Unknown entries and unfinished work are refused.

A fresh fully visible PostgreSQL observation allows idle serving pools, rejects
busy/transactional SQL, requires closed namespaces to have zero sessions across
the cluster and rejects prepared transactions. Inventories, directory identities,
source bytes and private locks are checked again before returning the observation.
No orphan is settled, owner killed or registration deleted by this helper.

The worker publishes the resulting observation and binds its hash in a new
`sabalan-coherent-component/v2` result. Legacy v1 remains unchanged. Both versions
still await actual native closure and independent recovery verification.

## Actual acceptance

`online-native-d69e9d9450d2d95dd3c52f265cf2a148.json` passed in the existing local
Compose project with all canonical service identities unchanged. Seven registered
backend namespaces were checked while two real native HTTP processes overlapped.
An earlier HTTP/SQL write committed, the later write stayed queued during capture,
and requests resumed only after actual capture closure.

The actual composed v2 worker captured PostgreSQL, immutable file objects and a
SQLite backup. Its logical dump was restored into a separate temporary database
in the SAME existing PostgreSQL service. The two pre-capture rows retained amount
`123456789.12345678` and quantity `0.00000001`; the queued later row was absent.
The exact PDF bytes and SQLite decimal strings were restored and checked. Native
closure passed, and temporary restore/source databases were dropped without FORCE
only after actual zero-session/prepared observations. This v2 diagnostic has one
business-probe table; it is not a production application recovery point.

The same read-only work validator rejected an actual dead HTTP actor's ACTIVE
work journal after its guardian had proved native/SQL completion. Existing worker
and capture-owner death fences, read-only grant guards, multipart upload, exact
lost-ack commits and durable pause tests also passed in this run.

Separately, the legacy full-schema capture/restoration regression passed with
427 migrations and 541 relations in
`coherent-capture-cd0e58694c620a55dc61bb8f17c1ae19.json`. Native ACTIVE reconstruction
in the packer and capture fixture now correctly excludes the newly retained
`activeClaimSha256` closure field, preserving old-record read compatibility.

Two earlier census attempts refused overly broad 0755 fixture parent directories.
Only fresh fixture provisioning was corrected to explicitly create 0700 parents;
the guard was not weakened. Those attempts' HTTP actors later completed graceful
native/SQL closure. Original CLOSING holds, bytes and databases remain; see
`online-backend-census-failed-attempt-closure-20261017.json`.

Backend TypeScript, architecture checks and independent Standards/Spec source
reviews passed. Native helpers are included in the backend image recipe; this
does not mean that a new application image has been built or deployed.

## Scope remaining

Host scope issuance must be frozen under actual worker ownership. The host
controller must additionally prove complete live container/image registration
and protocol identity; this observer does not grant that authority. Its explicit
`hostImageAdmission`, `inquiryBoundary` and `productionRecoveryPoint` fields remain
false. Inquiry/privacy/continuous WAL and full independent application restoration
remain required, as do main startup, semantic release/migration, browser and domain
admission. No production application/schema/traffic changed. Issue #405 stays open.
