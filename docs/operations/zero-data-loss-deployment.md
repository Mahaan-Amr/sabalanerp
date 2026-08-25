# Zero-data-loss production deployment

## Purpose

Every production deployment must preserve every write acknowledged before maintenance begins and must either open one fully verified new release or restore one fully verified previous release. A partially promoted or unproven state never receives public traffic.

The target normal maintenance duration is under five minutes. The ordinary hard limit is fifteen minutes after mutation begins. Safety overrides availability: rollback or emergency recovery may keep maintenance active beyond that limit until a complete release is proven healthy.

## Non-negotiable invariants

- Only one deployment or rollback may be active.
- Public ERP and Inquiry traffic sees an Nginx-owned Persian maintenance page throughout the protected window.
- No production write is accepted between the checkpoint boundary and completion of the final release gate.
- No mutation starts without a verified local checkpoint and a verified encrypted off-server copy.
- PostgreSQL, Inquiry SQLite, business-owned files, recovery coordination data, and the application release set move together.
- Rollback uses immutable pre-built image digests; it never rebuilds the previous release during an incident.
- No `force`, bypass, partial success, or manual lock deletion path exists.
- If neither the new nor previous complete release can be proven, the system remains fail-closed in maintenance.

## Deployment lease

A host lock prevents concurrent local processes. A renewable PostgreSQL lease records the deployment ID, release ID, target commit, owner, phase, start time, heartbeat, and expiry. A second deployment reports the active lease and exits without changing state. An expired lease can be claimed only after recovery preflight proves the journaled state. Rollback remains owned by the same lease.

If database sessions are already saturated and even the durable lease cannot be written, the host lock and checksum-chained host journal own a pre-mutation drain: Nginx enters maintenance, the old backend and Inquiry stop gracefully, and the PostgreSQL advisory lease plus durable database lease are then acquired. No checkpoint or mutation is permitted until both database leases are proven. This path exists specifically to recover connection headroom automatically without accepting a write during the drain boundary.

## Release checkpoint

The checkpoint manifest identifies:

- deployment and release IDs;
- source commit and immutable backend, frontend, Inquiry, and supporting image digests;
- PostgreSQL version, database identity, dump checksum, and restore-list verification;
- Inquiry SQLite backup checksum and SQLite integrity result;
- every protected volume and file entry with size and checksum;
- recovery coordination state;
- application and backup format versions;
- sanitized configuration identity without secret values;
- encryption envelopes, remote object identity, creation time, and retention class.

SQLite is captured using its supported online backup mechanism after Inquiry has drained; an open database file is never copied raw. PostgreSQL uses a consistent backup that is restored and validated in a staged database. Files are captured from a quiescent boundary and later restored into staging before atomic directory promotion.

## Encryption and remote durability

Each checkpoint uses a fresh random data-encryption key. That key is wrapped independently for local automatic rollback and for off-server disaster recovery. Raw keys, credentials, password-bearing URLs, and sensitive data never enter the repository, image, manifest, audit report, or logs.

The local rollback key is restricted to the deployment service. The off-server recovery key or KMS authority is held outside the production host. Manual ADMIN recovery packages retain their independent passphrase flow.

Before mutation, the deployment locally decrypt-validates and restore-validates the encrypted checkpoint, uploads it, and performs one complete streaming read-back of the remote object to prove byte equality with the validated local artifact. The remote sidecar is then read back independently. Repeating decryption of byte-identical remote bytes is intentionally avoided because it adds a full off-server transfer without adding a distinct integrity proof. An unavailable remote store, missing key authority, unreadable manifest, or checksum mismatch aborts the deployment and reopens the unchanged current release. The deployment lease is renewed while checkpoint creation, upload, and read-back are running so a valid long operation cannot lose ownership merely because it exceeds one lease interval.

## Storage management

Capacity decisions use measured component sizes and worst-case staging needs rather than a rigid free-space percentage. Preflight estimates checkpoint, restore staging, rollback safety, PostgreSQL working space, Docker working space, and operational headroom.

Before blocking a deployment, cleanup proceeds in this order:

1. Remove expired incomplete artifacts whose lease is proven stale.
2. Prune eligible checkpoints under the retention policy.
3. Remove older local checkpoints only after their remote objects and checksums are verified.
4. Remove safe build caches that are not referenced by the active or rollback release sets.
5. Recalculate required and available capacity.

The active checkpoint, last known-good local checkpoint, any checkpoint without a verified remote copy, and evidence for an open incident are protected. At least the two most recent successful local checkpoints are retained when capacity permits; at least one verified local rollback checkpoint is mandatory. Remote retention keeps the ten most recent releases and twelve monthly recovery points unless a stricter legal or operational policy supersedes it. Every prune records artifact identity, size, checksum, retention reason, and result. Insufficient capacity after eligible cleanup aborts the deployment; protected recovery evidence is never deleted to force progress.

## Deployment state machine

The journal uses durable, monotonic phases:

1. `PREFLIGHT`
2. `LEASE_ACQUIRED`
3. `MAINTENANCE_REQUESTED`
4. `TRAFFIC_BLOCKED`
5. `SERVICES_DRAINED`
6. `LOCAL_CHECKPOINT_VERIFIED`
7. `REMOTE_CHECKPOINT_VERIFIED`
8. `MUTATION_STARTED`
9. `MIGRATIONS_APPLIED`
10. `RELEASE_STARTED`
11. `GATES_PASSED`
12. `TRAFFIC_OPENED`
13. `COMPLETED`

Failure before `MUTATION_STARTED` removes maintenance and resumes the unchanged current release. Failure after mutation transitions once to `ROLLBACK_STARTED`; the journal makes each restore and promotion step idempotent and prevents blind retry of destructive operations. Successful rollback ends at `ROLLED_BACK`. An unprovable rollback ends at `RECOVERY_REQUIRED` and retains maintenance, lease evidence, checkpoints, safety copies, and logs.

## Timeouts and retries

- Target total normal maintenance: less than five minutes.
- Checkpoint creation and remote verification before mutation: a configurable 10-minute to 4-hour fail-closed window (1 hour by default), sized for the independent off-server store; expiry aborts without rollback.
- Migration, startup, and mandatory gates after mutation: at most fifteen minutes, then begin rollback.
- Transient idempotent operations may retry three times with bounded exponential backoff.
- Migration, promotion, database rename, filesystem swap, and restore are never blindly repeated; the durable journal determines resume or rollback.
- Rollback has operational timeouts and alerts but never opens an unverified state merely to meet a duration target.

## Mandatory release gates

Before public traffic opens, all of the following pass:

- migration history and expected schema identity;
- PostgreSQL, Inquiry SQLite, and protected-storage availability;
- backend readiness and database query;
- frontend, Inquiry, Nginx, and ClamAV health;
- contract-product-graph migration audit and every release-specific acceptance command;
- a retained contract-by-contract financial-evidence preflight report with zero unresolved results; case resolution is atomic and is skipped entirely when any contract is unresolved;
- while legacy Hiring onboarding rows remain, the read-only Start Preparation retirement audit proving zero open manual tasks, zero missing or duplicate system rows, and zero drift from contract, Payroll Participation, and insurance evidence;
- isolated read/write smoke tests with deterministic cleanup;
- checkpoint and release manifest integrity;
- protected file counts, checksums, and database-to-file reference validation;
- proof that the previous backend stopped and released its database sessions;
- durable final deployment report.

Any failed or timed-out mandatory gate triggers rollback. There is no override that opens the new release.

## Connection safety

The backend owns one canonical Prisma client and one bounded pool. Deployment, migration, audit, recovery, and administrator capacity are separately budgeted. Connection counts are grouped by application identity and state. The initial alerts are 60 percent warning and 75 percent critical utilization. At 85 percent, deployment preflight must prove that draining the old backend restores the reserved migration and recovery headroom; otherwise it aborts before mutation.

## Observability and notification

The immutable deployment report records the redacted timeline, commit, release and deployment IDs, image digests, checkpoint manifests and checksums, capacity decisions, connection utilization, every gate result, retries, rollback actions, and final state.

ADMINs receive the final result. A failure or rollback generates a high-severity alert immediately. Notification failure does not undo a proven rollback, but produces `COMPLETED_WITH_NOTIFICATION_FAILURE` and blocks the next deployment until resolved. Telemetry and reports exclude secrets, raw credentials, password-bearing connection strings, and protected business content.

## Retention and recovery proof

The latest remote checkpoint is restored monthly into an isolated, non-public environment. The exercise validates PostgreSQL, SQLite, files, manifests, checksums, image compatibility, migrations, smoke tests, and database-to-file relationships. Production data is protected or sanitized according to the existing recovery policy.

A full supervised rehearsal runs quarterly and measures the zero-loss recovery point and fifteen-minute normal recovery target. A failed, missing, or overdue mandatory drill removes the affected checkpoint's healthy status and blocks the next production deployment until the failure is resolved.

## Implementation plan

### Phase 0 — Connection ownership (complete locally)

- Canonicalize the runtime Prisma client.
- Bound the Prisma pool and timeout in Compose.
- Add graceful drain and disconnect behavior.
- Enforce ownership through ESLint, architecture checks, CI, documentation, and ADR-0038.

### Phase 1 — Deployment control plane

- Add the durable deployment journal and two-layer lease.
- Add the Nginx-owned maintenance switch and internal-only health routes.
- Drain backend and Inquiry and prove database-session release.
- Make interrupted pre-mutation deployment recovery deterministic.

### Phase 2 — Coordinated local checkpoint

- Capture PostgreSQL, SQLite, all protected volumes, and coordination state.
- Generate and validate the versioned manifest and checksums.
- Add capacity estimation, protected-artifact classification, safe cleanup, and audit records.
- Abort and reopen the unchanged release on every pre-mutation failure.

### Phase 3 — Encryption and remote checkpoint adapter

- Implement per-checkpoint data keys and dual key wrapping.
- Define a remote-object adapter so provider choice does not leak into deployment orchestration.
- Add resumable upload, read-back verification, retention, and remote inventory reconciliation.
- Require both verified copies before mutation.

### Phase 4 — Immutable release promotion and rollback

- Build and record immutable image digests as one release set.
- Stage and validate database, SQLite, and file restores.
- Implement journaled atomic promotion and one automatic rollback attempt.
- Preserve fail-closed `RECOVERY_REQUIRED` behavior.

### Phase 5 — Gates, telemetry, and alerts

- Implement mandatory health, schema, storage, reference-integrity, audit, and isolated smoke gates.
- Record connection, pool, capacity, duration, and retention metrics.
- Produce redacted immutable reports and ADMIN notifications.
- Block subsequent deployments on unresolved critical or notification failures.

### Phase 6 — Recovery drills and operational acceptance

- Automate monthly isolated remote restore verification.
- Define and rehearse the quarterly supervised runbook.
- Prove interruption recovery at every journal phase.
- Accept production use only after zero acknowledged-write loss, deterministic rollback, retention safety, and concurrency tests pass.

## Acceptance evidence

Implementation is not complete until tests prove concurrent deployment exclusion, pre-mutation abort, interruption recovery at every phase, full-source checkpoint integrity, remote corruption detection, storage-pressure cleanup without protected-artifact deletion, immutable-image rollback, migration failure rollback, gate failure rollback, rollback failure fail-closed behavior, secret redaction, notification failure blocking, and repeated restore reproducibility.
