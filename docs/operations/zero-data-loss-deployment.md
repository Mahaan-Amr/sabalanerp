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

### Preserving a qualified production scanner during prebuilt installation

The production prebuilt CLI requires an explicit `preservedClamav` selection in its authenticated plan. Missing selection refuses before maintenance; no implicit Compose recreation or scanner repair is permitted. The operator preparing the plan must freshly inspect the existing production scanner and select its exact container ID, immutable image, StartedAt, host PID and stable configuration hash. Initial identity/health receipt hashes record provenance; they never substitute for fresh canonical inspection.

The selection format is `sabalan-preserved-clamav/v1`, with exactly `format`, `containerId`, `image`, `startedAt`, `hostPid`, `stableConfigurationSha256`, `initialIdentitySha256` and `initialHealthSha256`. The stable hash is SHA-256 over recursively key-sorted compact JSON with Python-compatible ASCII escaping of `{Config, HostConfig, Mounts, Networks}` from the actual Docker inspection. Store and review the complete private inspection separately; never invent a digest from desired Compose configuration. The full pinned operations map includes the preservation helper/policy and all four canonical ClamAV verifier files.

Preservation keeps the existing scanner running through application preparation, abort and rollback. All application startup commands explicitly suppress dependency traversal and cannot select the scanner. Exact incarnation/configuration checks surround runtime changes; fresh canonical publisher/signature/updater/loaded-bank/CLEAN/EICAR inspection is required before admission. Naturally scheduled healthy bank advances are allowed and produce new private canonical health evidence. A deadline or failed inspector refuses qualification; it never signals or adopts business actors. A late inspector remains owned until actual child/pipes close.

The durable session and its first host-journal entry bind the complete selection and plan SHA. Matching metadata is stored in the existing reports and recovery-coordination directories and included by the unchanged complete business checkpoint. Interrupted recovery requires matching metadata before any Compose action. Missing, changed or unreadable selection retains the protected recovery boundary; it never falls through to ordinary scanner recreation. Repair and preservation are mutually exclusive.

Infrastructure identity uses a versioned descriptor binding the desired Compose digest separately from the actual preserved scanner configuration/image and selection. The desired `extra_hosts` alias is not claimed to have been installed on a preserved container. The existing independently verified PostgreSQL, Inquiry and business-file restore scope is unchanged: this lane does not capture signature banks, add a restore container or prove reconstruction of antivirus/host network infrastructure on a blank machine. Scanner replacement or that separate recovery operation requires its existing dedicated qualification.

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

### Retaining the same qualification master across update cycles

After `START_PROTECTED_INSTALL` and `ISSUE_ORIGIN`, send `FINISH_CLIENT` with
`mode: "BOOTSTRAP_RETAIN"` to that same original master. It internally performs
the existing `BOOTSTRAP` detach and waits for the actual terminal barrier and
normal original SSH exit with both pipes closed. The
`sabalan-original-master-bootstrap-retained/v1` event contains the validated
closure and its four-field `serviceReference`. Local and independent completion
tokens, guardian handles, stdin, the keeper, signal handlers and sequence remain
in that master; this event does not finish the master or grant admission.

Send `START_FOLLOWING_CLIENT` with the pinned launch-plan file/SHA and that exact
reference. The master compares it with its retained in-memory binding once and
checks the actual rebound service boot and launcher identity. Saved references
are lookup data, never a replacement for the original completion tokens. Run
`RUN_FOLLOWING_PROMOTION`, then `RUN_FOLLOWING_CURRENT_DATA_ROLLBACK`, each with
fresh deployment/release identities and its authenticated `prebuiltReleasePlan`.
Answer each actual online qualification request with `ISSUE_ONLINE_ORIGIN`;
wait for each workflow to complete before beginning the next. Finally send
`FINISH_CLIENT` with `mode: "FOLLOWING"` for the actual terminal client detach,
independent guardian closures and master completion. Ordinary terminal
`BOOTSTRAP` and `FOLLOWING` finish semantics are unchanged.

WAL sequence numbers belong to the actual acknowledged update cycle. The
transport arms a following cycle only after its matching original `ACQUIRE_NEXT`
completion. The previous cycle must have its certified point, metadata, terminal
coverage, original producer closure and matching `FINISH_CYCLE` completion. The
first WAL window can precede physical-point transfer: its runtime/capture pair
comes from the original launcher's checkpoint plan and must join the later
physical request exactly. Each cycle starts at sequence one, preserves prior
point records, and rejects reused runtime or capture identities. Caller JSON,
reconnects, timeouts, raw sequence one or an isolated terminal certificate cannot
reset a cycle. These controls still require the complete production and restore
evidence; this protocol description makes no claim that a real cycle passed.

### Explicit larger local QA candidate profile

The default local candidate remains 1536 MiB with a 1536 MiB Docker memory-plus-swap
limit. When that exact original cohort refuses the full catalog before starting an
actor, the reviewed replacement CLI can explicitly select
`--candidate-qa-memory-2048` with its actual completed 1536 MiB predecessor receipt
and a fresh authority cohort. This is a local QA resource transition only: candidate
memory and memory-plus-swap both become 2048 MiB; retained memory stays 768 MiB with
its existing 1536 MiB memory-plus-swap limit. CPU, reservation, PID, OOM policy and
all other service limits stay fixed. The new V3 receipt records both exact limits
and the immutable predecessor reference. Existing V1/V2 receipts retain their
original 1280/1536 MiB meanings. No default or production limit changes.

Both genuine Windows host observations immediately before and after V3 replacement
must show at least 2048 MiB available. Master admission remains at least 1536 MiB;
every original native actor still needs its existing actual headroom, including
384 MiB before the full catalog, without cache credit. Raising the limit does not
qualify a refused actor or any previous run.

After the new candidate replacement actually closes successfully, add
`candidateMemoryReceipt: {file, sha256}` to the pinned retained-browser plan, using
that exact completed V3 replacement receipt. The retained qualifier authenticates
its actual 1536 MiB predecessor and independently checks the live cgroup maximum.
`RUN_LOCAL` derives the same profile from its actual candidate receipt and requires
the retained report to match. The original prepared observer and candidate controller
revalidate that profile; missing or forged profile data keeps the strict 1536 MiB
default and cannot admit a 2048 MiB cgroup. No stopped service, alternate stack,
listener, browser lifecycle, native closure, database, backup or production health
exception is introduced.

A later ordinary candidate replacement supplies its actual completed 2048 MiB
predecessor receipt and the existing fresh authority cohort option, without
repeating the memory transition flag. The same canonical CLI authenticates the
initial V3 transition and its 1536 MiB predecessor, preserves the installed
2048 MiB candidate/swap limits, and writes a distinct preserved-profile receipt
with its immediate predecessor and initial transition pins. Both new host
observations still require 2048 MiB. Current container IDs, images and births must
match their authenticated predecessor; missing or changed ancestors refuse the
update. The transition flag itself remains an exact 1536-to-2048 operation and
refuses an already-2048 predecessor. Unselected/default installations remain1536.


A pinned failed local 2048 MiB transition remains FAILED_CLOSED. Its literal negative report, original tool-owner observation (not native completion), completed 1536 MiB ancestor, and independent current-slot inspection may select only a full fresh 2048-to-2048 authority-cohort replacement. Fresh installed-byte, namespace, native/SQL quietness, exact identity/resource and protected-service checks remain mandatory. The resulting recovery profile explicitly records `originalTransitionQualified: false`; later ordinary replacements retain this authenticated recovery anchor. After UP, host memory may be observed passively for at most 60 seconds, with every actual sample persisted before validation and two consecutive fresh samples at the unchanged 2048 MiB floor required. A deadline or interruption remains fail-closed; no cache credit or production limit changes apply.


The separately typed local capsule-preflight recovery baseline applies only to
the pinned failed `4d9e5e57a12e985025bc06d59f08e050` replacement after successful
UP. Its original tool exit is authenticated as an owner observation, with no
reconstructed native closure or adoption. Fresh owner absence, exact physical
slots and historical read-only mounts, installed bytes, empty authority namespaces,
native/SQL quietness and unchanged resource limits precede a new ordinary
authority-cohort replacement. The failed receipt remains negative; only the new
replacement's complete gates, including both full capsule probes, can qualify it.
This local recovery gives no production admission or rollback exception.

The acceptance view is explicitly nonempty: its two historical capsule mounts
and two exact retained-browser history directories remain protected. A separate
source-pinned proof authenticates their original closed provenance, complete
stable inventories, native terminal records and lock identities, and retains
the original parent device/inode/owner/mode lineage while recording its current
metadata. Unknown entries or changed evidence refuse recovery. Neither this
proof nor the new receipt claims that the physical acceptance directory is empty;
the legacy empty-directory verifier remains unchanged.

### Optional suspended local development frontend

Build and qualify the current candidate while all ten local services are healthy. Only explicit operator authorization permits `scripts/run-local-dev-frontend-suspension.mjs --suspend --candidate-replacement-receipt <file> --candidate-replacement-sha256 <sha>` afterward. This owner stops only the inspected frontend container ID, records its original child close and both EOFs, and creates a durable restoration obligation. It changes no QA UI coverage, native memory floor, production gate, or deployment authority.

The retained plan may select `localDevSuspension: {file, sha256}` together with `localDevMasterEvidence: {planFile, evidenceDirectory}` (future absolute supervisor-plan and evidence paths, without a circular future hash). Actual retained execution binds the same original Windows master PID and exact string native birth to that produced supervisor plan before QA. Genuine retained completion carries the selection into local QA, crypto, legacy UI and both checkpoint producer guards; default and production paths remain strict. Only the development frontend may be genuinely exited. All ten services remain in the census; controlled QA UI slot recreation keeps its existing original-owner checks.

Keep the frontend suspended through the entire bootstrap, following promotion, current-data rollback and terminal master closure. Then run the same owner with `--restore <stopped-or-pending-file> <sha>`. Restoration requires the bound original start/closed evidence and fresh matching-incarnation absence, local native/grant quietness and strict local SQL quietness (only the exact baseline health pools are allowed). A preparation failure before any master was bound can restore only after the same fresh absence/quiet checks. Control-file exclusion prevents restoration racing retained enrollment. Interruptions retain the actual original child until close/EOF and never publish success. Unknown lost-owner control files remain held.

The normal start targets the same container ID and configuration, verifies actual healthy state and other current service identities, and then clears the pinned pending obligation. A new StartedAt from that normal start is recorded honestly. Restoration pending or unknown means the full operation is not finished; no permanent production owner is stopped by this local lifecycle.

### Offline full-catalog qualification budget

The private full catalog has a source-owned two-hour Playwright global timeout and a 122-minute diagnostic ownership deadline, including its closure margin. These limits do not change the ten-minute affected production workflow pause/recovery budget, checkpoint or restore deadlines. The same original CLI, browser handles and SQL ownership remain retained to actual closure on failure or expiry. Standard max-failures=1 stops scheduling after one terminal failed test; existing retries and all canonical tests remain unchanged. Only the exact authenticated list inventory, with every case finally passed, may qualify; skipped, interrupted or unrun cases never do.

The catalog reserves 1 GiB before starting: existing 67 MiB diagnostic/closure reserve, 48 MiB inner logs, at most 1466 full 32 KiB resource rows, 384 MiB test artifacts including the bounded 16 MiB JSON result, 256 MiB private browser work, and closure overhead. Sampling covers the complete two-hour budget and its terminal state. Oversized rows, byte/count limits, disk exhaustion and observation failures remain sticky negative; no bound sends a signal, deletes artifacts, adopts an actor or turns truncated evidence into success. Inner logs continue draining to EOF after their storage limit, and browser ownership parsing consumes every stderr byte.
