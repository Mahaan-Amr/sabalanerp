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

### Biometric workstation configuration on existing images

Use `DEPLOYMENT_MODE=configuration DEPLOYMENT_BIOMETRIC_PROVISIONING_FILE=/private/path/erp-provisioning.json sh deploy/scripts/deploy.sh deploy/.env.prod` to register a new workstation without fetching source or rebuilding application images. This mode permits additive workstation registration only; it does not enable physical enrollment or rotate an existing workstation's keys.

All six existing containers must be running and healthy. Their image IDs must be immutable, and the three application IDs must agree with the running backend's complete release identity. The operation retains the running commit and source identity even when the checkout is newer. It uses the same host/database leases, recovery-drill preflight, maintenance boundary, verified local and remote checkpoint, idempotent migrations/reconciliation, fifteen-minute mutation deadline, mandatory gates and rollback as a code release.

Before preparing the session, workstation credentials and the exact previous environment bytes are stored with mode `0600` in the protected recovery-coordination volume. The checkpoint therefore encrypts and remotely verifies the configuration recovery snapshot. Only after the remote checkpoint passes may the environment file be atomically updated. Rollback restores its exact previous bytes and the previous runtime workstation setting before restarting previous images. Concurrent edits or a changed snapshot fail closed. Interrupted configuration state without an active deployment session blocks a new deployment pending inspection; it is never silently discarded.

A reviewed operations bundle can be staged separately from the application checkout. `DEPLOYMENT_REPO_ROOT` selects the existing clean production checkout while the helpers are loaded from the runner's own bundle. This does not change application source identity or omit any release gate. Keep the bundle immutable for the entire operation and recovery; retain its checksum record with operational evidence. Transfer provisioning exports through the approved private channel and remove them after successful registration and confirmation. Never print them in logs or issue bodies.

The original online launcher also accepts `prebuiltReleasePlan: {file, sha256}` for an already-qualified immutable release. It invokes `deploy.sh --prebuilt-release ENV PLAN SHA256` through the same original bootstrap pipes. The root-owned, single-link, mode-0400 plan (`sabalan-prebuilt-protected-release-plan/v1`) pins `applicationCommit`, its exact `applicationTree`, `applicationSourceHash`, the clean Inquiry gitlink, all three component source commits, the measured image-store namespace and immutable execution IDs, full INDEX/platform/CONFIG archive graphs, SHA-bound private build/archive receipts, and the original frontend/Inquiry native browser identities. `operations` pins the host-pack receipt SHA and its complete output-file SHA map. The exact application checkout and Inquiry checkout must already be installed and clean; this lane never fetches source, derives new tags or browser IDs, or rebuilds images.

Git commit/tree identity and build-input byte identity are separate. The qualified backend build receipt and immutable image label must agree on `applicationSourceHash`; a clean Linux checkout is verified by its Git tree, without claiming its LF bytes equal a Windows CRLF build hash. Component commits remain distinct: a retained frontend need not claim the backend's commit. Inquiry's native Next BUILD_ID also remains distinct from its deployment ID.

Before the host/database lease, before database preparation, and immediately before mutation, the helper verifies the pinned plan, full operations output map, clean source/tree/gitlink, original receipts and actual installed execution IDs, native descriptors and rootfs identities. Classic overlay2 selects CONFIG; the containerd image store selects the authenticated INDEX and requires its native descriptor to match. The original production controller observes this selection on the real source host and binds all three images, graphs, release, machine and boot identity into the private qualification request. Independent recovery continues to require the exact canonical CONFIG identities; the production execution binding never substitutes for those restore identities. Historical qualification without this binding accepts canonical CONFIG execution only. The normal owned cleanup runs on both hosts and explicitly protects the three selected execution IDs using its existing `--protected-image` port; unknown cache remains protected. Already-installed prebuilt images need no additional build/import workspace reservation. Canonical capacity checks still measure checkpoint, restore and safety reserves on both hosts; a capacity failure leaves the current release serving users. All canonical leases, checkpoint capture and independent remote verification, retention, owned migrations, health gates, rollback and original bootstrap boundaries remain mandatory. Plan data selects content and grants no public admission: only the same original master, independent restore, signed issuer and actual native browser/runtime gates can authorize promotion.

Before preparing a maintenance session, the built backend runs the same production-environment validator used at application startup. Missing runtime settings, including personnel-performance attestation configuration and release identity, abort while the current release remains online. Provision the approved attestation configuration and bind release identity to the measured candidate before retrying; do not fill these settings with placeholders or weaken startup validation.

Deployment derives performance commit/source identity and immutable image digests from the built candidate. It measures the database ledger and policy hashes before preflight, then measures them again after migrations and reconciliation, immediately before application startup. The resolved Compose infrastructure hash is refreshed with those final values. The previous running backend's nonsecret identity fields are captured in the deployment session and restored alongside its immutable images during rollback. Attestation keys remain separately provisioned; deployment never signs acceptance evidence or activates a performance rollout.

A host lock prevents concurrent local processes. A renewable PostgreSQL lease records the deployment ID, release ID, target commit, owner, phase, start time, heartbeat, and expiry. A second deployment reports the active lease and exits without changing state. An expired lease can be claimed only after recovery preflight proves the journaled state. Rollback remains owned by the same lease.

For images with native runtime ownership, the backend startup wrapper publishes ACTIVE before the application pool is constructed and keeps FD9 until descendants and tagged cluster-wide SQL have finished. Both release and rollback drains inspect this durable state under FD9 using the frozen operations bundle. An ACTIVE/unreadable record blocks capture, mutation, rollback and pre-mutation reopening even after container/process death; no timeout resets it. The 300-second Docker grace permits the application's completion-aware drain but is not proof of completion. A legacy image with no native record retains the existing maintenance-only drain/session checks; it receives no online admission. See [native ownership evidence](../../reports/qa/native-runtime-ownership-20261017.md).

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

Immutable application images are built sequentially before maintenance. The canonical storage preflight performs only its verified, owned cleanup before building. Unknown builder cache remains protected: deployment never runs a global Docker prune. Actual free space is measured again after all image exports; a build failure or insufficient capacity aborts before maintenance while the current release continues serving users. The complete release and all checkpoint gates are still required before promotion.

Before blocking a deployment, cleanup proceeds in this order:

1. Remove expired incomplete artifacts whose lease is proven stale.
2. Prune eligible checkpoints under the retention policy.
3. Remove older local checkpoints only after their remote objects and checksums are verified.
4. Remove only owned images and containers proven eligible by the canonical storage preflight; retain unknown builder cache.
5. Recalculate required and available capacity.

The active checkpoint, last known-good local checkpoint, any checkpoint without a verified remote copy, and evidence for an open incident are protected. At least the two most recent successful local checkpoints are retained when capacity permits; at least one verified local rollback checkpoint is mandatory. ADR-0131 supersedes the former ten-release/twelve-month remote count: keep the two newest complete healthy restore-verified independently read-back recovery points. Verify the replacement before pruning the oldest, and preserve incident holds and all required restore dependencies. See `online-deployment.md` for implementation status. Every prune records artifact identity, size, checksum, retention reason, and result. Insufficient capacity after eligible cleanup aborts the deployment; protected recovery evidence is never deleted to force progress.

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

### Explicit reconciliation of a failed pre-mutation capture

If capture-only configuration verification fails after a container was recreated, ordinary reopening remains blocked. The incident owner may run the separately reviewed `reconcile-premutation-capture.mjs PLAN SHA256` under the original host FD9 using a fresh private operations directory. This is a recovery of the previous release, not a successful capture or a new-release promotion. Preserve the original terminal checksum-chained journal, snapshot, failed configuration hashes, timing failure, database row and every attempt's private audit. Never change the original evidence to make its guard pass.

The root-owned, checksum-pinned plan and `verify-premutation-configuration-repair.mjs` must prove the deployed previous Git commit, unchanged tracked source and exact reviewed historical untracked inventory, all six immutable images and actual service incarnations, protected configuration bytes, and the complete canonical previous backend configuration against its immutable image and resolved previous Compose service. Ordered commands remain ordered; unique-key environment comparison and explicitly proven ordering-only permutations do not waive unknown fields or semantic differences. The repair records `originalCaptureGuardPassed: false`. It requires actual public maintenance responses for both origins, the original no-mutation journal, identical PostgreSQL identity and migration ledger against the previous source, and full checksum read-back of the verified local and independent remote checkpoint plus remote sidecar. No database or business-file rewind occurs.

Only the same fixed host lock, an actual owned PostgreSQL advisory session and an atomically acquired durable incident lease authorize the next steps. A held lease from an interrupted attempt is never cleared merely because it expired. The exceptional closed-predecessor reader is restricted to the explicitly pinned historical attempt and helper version; it additionally checks the original SSH closure and stdout provenance, private lease/failure audits, exact expired token and timestamps, unchanged business row, absent original tagged database sessions and absent running deployment transports. A second locked-row comparison precedes a fresh token. New owners record their process birth and token digest before claiming the lease; failures retain maintenance and durable private child stdout/stderr and closure audits.

Run all fourteen canonical `PREVIOUS_UNCHANGED` gates through the immutable control image with the normal entrypoint and explicit `BACKEND_RUNTIME_ROLE=control`. The business image identity remains the actual previous backend image. Together with the four separately recorded incident proofs, these are fourteen release gates plus four incident checks, not eighteen canonical gates. Reobserve configuration, all six container IDs/start times/restart counts, source inventory, ledger, both public maintenance responses and original evidence. Immediately before removing the exact owned maintenance marker, verify the same advisory session, FD9 and an unexpired matching lease under a locked database row. Finish the failed operation as `ABORTED` with its original report retained and explicit reconciliation evidence; never relabel it a qualified capture. Any incomplete proof keeps maintenance and incident evidence protected. This protocol provides no ordinary deployment bypass or general stale-lock reset.

## Timeouts and retries

- Target total normal maintenance: less than five minutes.
- Checkpoint creation and remote verification before mutation: a configurable 10-minute to 4-hour fail-closed window (1 hour by default), sized for the independent off-server store; expiry aborts without rollback.
- Migration, startup, and mandatory gates after mutation: at most fifteen minutes, then begin rollback.
- Transient idempotent operations may retry three times with bounded exponential backoff.
- Remote checkpoint checksum read-back uses bounded 1 MiB reads and may restart the complete hash up to three times after a transient storage or connection error, including a stream-close error. Persistent read failures and checksum mismatches still abort before mutation; a partial read never establishes verification.
- Migration, promotion, database rename, filesystem swap, and restore are never blindly repeated; the durable journal determines resume or rollback.
- Rollback has operational timeouts and alerts but never opens an unverified state merely to meet a duration target.

## Mandatory release gates

Before public traffic opens, all of the following pass:

- migration history and expected schema identity;
- PostgreSQL, Inquiry SQLite, and protected-storage availability;
- backend readiness and database query;
- frontend, Inquiry, Nginx, and ClamAV health;
- contract-product-graph migration audit and every release-specific acceptance command;
- Partner customer contracts are audited through their canonical Case owner rather than migrated from customer display rows. The audit verifies reciprocal ownership, current revision provenance, canonical graph schema and hash, rebuilt projections, persisted customer output, currency and payable amount in one read snapshot. Missing or inconsistent evidence blocks release; valid Partner rows remain unchanged and are reported separately from migratable ordinary contracts;
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
