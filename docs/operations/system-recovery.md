# System recovery operations

Sabalan ERP exposes **پشتیبان‌گیری و بازیابی** on the main dashboard only to users whose system role is `ADMIN`. API authorization is enforced independently of the page.

## Runtime requirements

The production Compose stack supplies:

- PostgreSQL 15 client utilities to the backend for `pg_dump`, `pg_restore`, and staged database promotion.
- SQLite tooling and a shared read/write mount of the inquiry data volume.
- A dedicated encrypted-package volume at `/app/storage/recovery`.
- A coordination volume shared by the backend and inquiry supervisor.
- persistent volumes for contracts, HR hiring files, accounting contract files, and general uploads.

`APP_VERSION` and `APP_COMMIT` must describe the deployed release. Restore rejects packages from newer application, backup-format, or PostgreSQL versions before maintenance begins.

Production must keep `ALLOW_SANITIZED_RECOVERY=false`. A local Docker environment may set it to `true`; the backend still rejects sanitized restore whenever `NODE_ENV=production`.

## Creating and storing a backup

1. Choose **Complete Recovery Backup**.
2. Enter the current ADMIN account password.
3. Enter a unique Backup Passphrase of at least 12 characters containing letters and numbers.
4. Wait until the background operation is `READY`.
5. Download the `.sabrec` file by verifying the ADMIN password again.
6. Store the file and passphrase separately, outside the application server.

The server deletes package bytes after 24 hours. Audit metadata remains. A package left only on the same server is not disaster protection.

## Restoring

1. Deploy the same application release that created the package, or a newer release that still contains every required migration.
2. Upload the `.sabrec` package and provide its Backup Passphrase.
3. Review checksum, source release, PostgreSQL version, package type, and compatibility.
4. When more than one active ADMIN exists, a different ADMIN must approve the exact checksum. Approval expires after 30 minutes.
5. If only one active ADMIN exists, record the mandatory break-glass reason.
6. Enter `RESTORE SABALAN ERP` exactly and start restore.

The backend places the application in maintenance mode, stops the inquiry service through the shared coordination volume, restores into a staged PostgreSQL database, applies available forward migrations, revokes every active session, preserves current database and files as a safety point, promotes the staged database and files, and restarts. Startup either proves and finalizes the promoted state or rolls back the interrupted operation before reopening writes.

If neither the restored nor previous state can be proven healthy, the application remains in maintenance mode. Inspect backend logs, the `recovery_coordination` volume (`state.json` and `pending-restore.json`), PostgreSQL database availability, and the inquiry supervisor before changing any recovery files manually.

## Sanitized local restore

Sanitized packages are rejected in production. In the explicitly enabled local Docker stack, restore:

- deterministically pseudonymizes user, personnel, customer, contact, candidate, address, and financial identifiers;
- removes sessions and authentication evidence;
- replaces original stored files with harmless placeholders;
- preserves business relationships, permissions, prices, quantities, and workflow states;
- creates `local_recovery_admin` with a one-time temporary password displayed only in the initiating browser; and
- permanently marks the recovered environment as sanitized test data.

The temporary local ADMIN must change its password at first login.

## Restricted database role handoff

The same ADMIN browser forms and API routes support the restricted PostgreSQL role. Backup and restore requests are sealed to the native host owner's public key and published in the recovery volume only after their matching audit record commits. Only ciphertext is durable; the passphrase is delivered to the protected owner command over anonymous stdin. Upload validation authenticates the encrypted package and checks manifest, component integrity and release compatibility without executing the archived SQL or creating a database. Download, receipts, second-ADMIN approval, confirmation and break-glass checks retain their current behavior. The legacy single-role workflow retains direct execution.

Provision the owner key and consumer on the canonical native Linux host before enabling the restricted serving role. Run `node deploy/scripts/system-recovery-owner-host.mjs provision /opt/sabalanerp/deploy/secrets`, then `node deploy/scripts/system-recovery-owner-host.mjs install /opt/sabalanerp/deploy/.env.prod /opt/sabalanerp/deploy/secrets/system-recovery-owner-private.pem` as the native host owner. Use the actual canonical environment and secret directory when configured differently. Provisioning preserves an existing matching key and refuses a conflicting key. The systemd consumer uses the existing `sabalanerp` backend recovery volume; it exposes no listening endpoint. The serving backend receives only `system-recovery-owner-public.pem` through its individual read-only mount. Never mount the private key or the secret directory into the serving backend.

The consumer binds each sealed request to its operation ID, actor, action and audit digest. The owner rechecks the current ADMIN, package expiry/checksum, exact approval and confirmation/break-glass decision when claiming the request. COMPLETE and SANITIZED_TEST creation retain their existing choices; sanitized restore remains forbidden in production. Restore captures and independently reads back a fresh protected checkpoint before promotion, carries the current protected lease into the verified stage, and finalizes through the existing recovery journal before the normal release health gates reopen the original immutable service set. An uncertain owner exit retains the intent and maintenance boundary for controlled recovery. End-to-end runtime qualification is required before this source change is admitted as a production candidate.

The consumer preflights a request before advisory ownership, drain or maintenance. Expired, inactive or unbound requests are rejected and their exact ciphertext is retained in `owner-rejected`; an exactly bound pending operation receives terminal control metadata. Publishing a durable request releases the serving process's local reservation so its normal shutdown can drain. The host supplies separate anonymous preflight and execution streams from the same in-memory request.

For application restore, the backend image contains a private PostgreSQL filesystem copied from the exact immutable PostgreSQL image used by the target. The protected build pins and records that image before building the backend; restore checks the receipt before maintenance. The private server has no production filesystem, credentials, inherited control descriptors or outgoing network authority. It first imports as a non-superuser, verifies the archived migration checksums and historical schema against byte-identical canonical migrations, applies forward migrations privately, and verifies the final schema before importing into the real private stage. The source migration ledger is retained and forward entries come from actual canonical migration execution.

Current deployment operations, allocation control and audit, and Partner release publications remain authoritative. A data-only capsule captures them with the current target schema/ACL snapshot and supplies them before stage triggers are installed; uploaded rows cannot replace this authority. The `APPLICATION_RECOVERY` health report runs all normal release health checks and additionally binds the preserved allocation authority to actual restricted-role proofs from the original serving image before and after restart. It cannot qualify a new allocation activation or stand in for a new release report. A completed owner receipt is required to start restored original containers. The existing 15-minute mutation budget begins after the verified checkpoint; unchanged backup capture retains its 15-minute total pause budget.

An authenticated ADMIN can submit a complete backup request to `POST /api/system-recovery/owner-backup-requests` on the restricted runtime. Send a JSON object containing only `adminPassword`. A successful response is HTTP 202 with the operation `id` and `CREATING` status in `data`. After verifying the current password, the backend records the operation and `RECOVERY_OWNER_BACKUP_REQUESTED` audit event in one transaction. The request survives backend restart while unclaimed and expires after 24 hours. The endpoint returns the ID for the private host handoff described below.

The control command claims that exact pending operation once, rechecks the initiating account and expiry, and checks the inherited FD 9 lock, operation-bound maintenance marker, active protected deployment lease in the SERVICES_DRAINED phase, and absence of serving-role database sessions. It runs only through the existing ephemeral deployment service and accepts the operation ID as its only argument and the passphrase as bounded UTF-8 over private stdin. The pending recovery request ID identifies the application record. The inherited deployment ID identifies the protected maintenance and lease, and the host launcher must bind both in its private handoff. It publishes downloadable metadata and the ready audit in one transaction after capture. The command does not reopen traffic.

### Protected owner backup continuation

The legacy host CLI can also continue an already recorded COMPLETE backup request on native Linux under the canonical production operator. It requires the running restricted-role backend image to contain the owner command, an authenticated pending operation with its owner-request audit event, and an authorized private passphrase producer. The browser workflow uses the sealed consumer above; this compatibility CLI continues to accept the original passphrase-only stream.

Use the canonical host checkout at `/opt/sabalanerp` and the reviewed host runner. An authorized producer must supply the passphrase directly on anonymous stdin and close its write side. The host accepts a single UTF-8 value up to 4096 bytes and requires EOF within ten seconds. Passphrase bytes must already be in the producer's memory. Keep the passphrase out of shell arguments, environment variables, terminal output, logs and files. The runner invocation is `sh deploy/scripts/deploy.sh --system-recovery-backup <env-file> <recovery-operation-cuid>` with that private stream attached as stdin.

The runner acquires the canonical host flock, pins the live Compose containers, immutable backend image and database configuration, and uses the existing PostgreSQL advisory and protected database leases. It proves maintenance on both public domains and drains the original runtime before starting the ephemeral `deployment` service. The owner command verifies the initiating ADMIN, claims the exact request, and checks the bound maintenance, `SERVICES_DRAINED` lease and database roles. The serving backend keeps the existing restricted credential and no container engine socket.

On success the runner restarts the original containers by exact ID and checks the unchanged release, including database, file references, and Inquiry readiness. It reopens after the existing gates and lease checks pass within the exact-container recovery helper’s 15-minute maintenance budget. The protected deployment journal ends `ABORTED` because the runner never promotes a release. The separate RecoveryOperation records the backup result, and the host completion file binds the two IDs. The command produces an application `.sabrec` package. The separate Release Checkpoint and capture-only remote-readback requirements still apply to deployment and rollback.

An uncertain backup or failed reopen gate preserves `.deploy-state/system-recovery-backup-active.json` and the protected active journal. The ordinary deployment runner refuses to adopt that operation. Preserve the intent, lease, original configuration and startup receipts, the operation record, and its audit before controlled recovery. Forward release, checkpoint capture, and a new backup invocation cannot substitute for recovery of that hold. Host fixture tests cover the CLI decision paths. Production-style qualification and a separately reviewed hold recovery exercise remain open.

### Restricted upload and restore qualification

The existing package validator can bind decryption to the SHA-256 recorded for the upload. It checks the same encrypted bytes it authenticates before opening the archive. Restore staging independently enforces the approved checksum before it opens the archive or stages the database. The digest establishes package identity. Authenticated owner intake still needs a trusted package origin or a private validation environment that confines package parsing and SQL execution.

The existing protected operator rollback is for controller-recorded deployment checkpoints at the exact captured schema. Application restores allow compatible older packages and apply forward migrations. An operator-only application restore would require the same reviewed intake, authorization, migration and promotion evidence as the dashboard workflow.

- Bind the initiating ADMIN, immutable package digest, and current second-ADMIN approval or break-glass decision to a single protected operation. Verify the same package and decision at the owner boundary before mutation.
- Restore the package to an isolated stage. Prove the supported legacy and current package paths, the migration chain, and schema convergence against the target release. Derive the target grants from a trusted target-release policy and verify owner, runtime, controller and public privileges on the migrated catalog before promotion. Include effective access checks for protected tables and functions.
- Before production mutation, record a verified protected checkpoint and independent remote readback. Exercise owner-side startup finalization and fail-closed rollback, including interruption during promotion. Reopen only after the database, application storage, and Inquiry pass their health and identity gates.
