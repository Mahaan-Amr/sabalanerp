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

Under the restricted PostgreSQL role, the dashboard's direct backup and restore execution endpoints return `SYSTEM_RECOVERY_OWNER_HANDOFF_UNAVAILABLE`. Upload validation remains available: it authenticates the encrypted package and checks manifest, component integrity and release compatibility without executing the archived SQL or creating a database. Existing backup download, receipt and second-ADMIN approval paths also remain available under their current password and authorization checks. The legacy single-role workflow retains its existing HTTP behavior.

An authenticated ADMIN can submit a complete backup request to `POST /api/system-recovery/owner-backup-requests` on the restricted runtime. Send a JSON object containing only `adminPassword`. A successful response is HTTP 202 with the operation `id` and `CREATING` status in `data`. After verifying the current password, the backend records the operation and `RECOVERY_OWNER_BACKUP_REQUESTED` audit event in one transaction. The request survives backend restart while unclaimed and expires after 24 hours. The endpoint returns the ID for the private host handoff described below.

The control command claims that exact pending operation once, rechecks the initiating account and expiry, and checks the inherited FD 9 lock, operation-bound maintenance marker, active protected deployment lease in the SERVICES_DRAINED phase, and absence of serving-role database sessions. It runs only through the existing ephemeral deployment service and accepts the operation ID as its only argument and the passphrase as bounded UTF-8 over private stdin. The pending recovery request ID identifies the application record. The inherited deployment ID identifies the protected maintenance and lease, and the host launcher must bind both in its private handoff. It publishes downloadable metadata and the ready audit in one transaction after capture. The command does not reopen traffic.

### Protected owner backup continuation

The host CLI can continue an already recorded COMPLETE backup request on native Linux under the canonical production operator. It requires the running restricted-role backend image to contain the owner command, an authenticated pending operation with its owner-request audit event, and an authorized private passphrase producer. The request API and host CLI have separate tests. End-to-end qualification requires a private producer that binds the passphrase to the exact request ID and provides it to the existing host runner over anonymous stdin. Dashboard backup remains unavailable in restricted mode until that private delivery path is reviewed and exercised.

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
