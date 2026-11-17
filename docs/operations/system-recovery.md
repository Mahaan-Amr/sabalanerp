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

The restricted PostgreSQL role receives an explicit unavailable response for new backup, upload validation, and restore execution until the protected host handoff is qualified. Existing backup download and receipt paths remain available under the current ADMIN password check. The legacy single-role workflow retains its existing HTTP behavior.

The owner backup command is a private continuation for a complete backup request. A future authorized API adapter can record the existing operation and its owner-request audit event in one transaction after verifying the ADMIN and current password. The control command claims that exact pending operation once, rechecks the initiating account and expiry, and checks the inherited FD 9 lock, operation-bound maintenance marker, active protected deployment lease in the SERVICES_DRAINED phase, and absence of serving-role database sessions. It runs only through the existing ephemeral deployment service and accepts the operation ID as its only argument and the passphrase as bounded UTF-8 over private stdin. It publishes downloadable metadata and the ready audit in one transaction after capture. The command does not reopen traffic.

The host adapter still needs to bind an authenticated request to an ephemeral passphrase channel and prove the pinned Compose project, immutable backend image, and PostgreSQL role identities. It must acquire the existing host and database leases, prove ERP and Inquiry return maintenance responses, drain both services through the protected boundary, and hold those proofs until the owner command exits. The success path needs exact-service restart, file and database readiness, and release health checks before reopening. The failure path must keep maintenance closed until the existing release is independently reverified. The serving process may not receive control credentials or the container engine socket.

Restricted-role restore remains pending. The existing ACL replay contract only permits an exact-schema protected rollback. The application restore accepts compatible older packages and migrates the staged database forward, so it needs a proven target ACL reconciliation and validation policy before promotion, including legacy packages. Restore additionally needs exact checksum and current approval or break-glass validation, a verified protected checkpoint and independent readback before mutation, and owner-side startup finalization and rollback proof before reopening.
