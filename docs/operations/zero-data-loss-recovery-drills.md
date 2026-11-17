# Zero-data-loss recovery drills

The newest verified remote deployment checkpoint must be restored monthly in a non-public, isolated environment. A supervised end-to-end deployment and rollback rehearsal is required quarterly.

## Isolation requirements

- Never point a drill at the production database, production volumes, production DNS, or production Compose project.
- Set `NODE_ENV=test` and `DEPLOYMENT_DRILL_ISOLATED=true`.
- Set both `DATABASE_URL` and `PRODUCTION_DATABASE_URL`; they must be present and different.
- Generate a unique 32+ character `DEPLOYMENT_DRILL_DATABASE_MARKER`. In the isolated PostgreSQL server's `postgres` control database only, create `deployment_drill_environment_marker(singleton boolean primary key default true check (singleton), marker text not null)` and insert that exact marker. The drill verifies this server-level identity before any destructive restore; it survives replacement of the application database. Production must never contain this table or marker.
- Mount empty drill-only directories at every protected storage path and mount the independent remote checkpoint store read/write.
- Supply the off-server private key through `DEPLOYMENT_REMOTE_RECOVERY_PRIVATE_KEY_FILE`; never copy it onto the production host, into an environment file, or into the repository. Production holds only the matching public key.

Run the built backend command with `DEPLOYMENT_DRILL_METADATA_PATH` pointing to the newest remote `.sabrec.json` sidecar:

```sh
sh scripts/with-backend-control-ownership.sh node dist/scripts/deployment-recovery-drill.js
```

The command validates the encrypted object and checksum, restores PostgreSQL, SQLite, and protected files, applies current migrations in the isolated environment, validates database-to-file references, finalizes recovery, runs a database probe, records a durable report, and marks the remote metadata with the successful drill result. Any failure leaves a non-zero result and must be resolved before the next production deployment.

For automatic monthly execution, install `deploy/systemd/sabalanerp-recovery-drill.service` and `.timer` on the independent drill host, install `deploy/recovery-drill.env.template` as `/etc/sabalanerp/recovery-drill.env` with mode `0600`, then enable the timer with `systemctl enable --now sabalanerp-recovery-drill.timer`. The timer finds the newest remote sidecar itself and is persistent across host downtime. The private recovery key exists only on this independent drill host; it is never mounted into the production backend or production deployment runner.

The quarterly supervised rehearsal additionally executes `deploy/scripts/deploy.sh` against the isolated environment, injects one failure before mutation and one after mutation, and records acknowledged-write counts, rollback duration, gate results, and the absence of public traffic during maintenance. After one separate `COMPLETED` run and one `ROLLED_BACK` run, set `DEPLOYMENT_REHEARSAL_SUCCESS_JOURNAL`, `DEPLOYMENT_REHEARSAL_ROLLBACK_JOURNAL`, and `DEPLOYMENT_DRILL_METADATA_PATH`, then run `node dist/scripts/deployment-rehearsal-record.js`. The command accepts only checksum-valid journal chains with the two required terminal states. Missing monthly drill evidence after 35 days or quarterly rehearsal evidence after 100 days blocks production deployment automatically.

## COMPLETE checkpoints with restricted database roles

A checkpoint whose COMPLETE manifest contains `database/protected-role-acls.json` requires a sealed target on the physically independent Linux drill host. The remote sidecar must sit next to its ciphertext and identify that same object. The drill verifies the ciphertext's size and SHA-256, decrypts the archive with the independently held key, and checks the ACL component in the decrypted manifest against the sealed checkpoint identity.

Prepare a dedicated private PostgreSQL instance on the independent host with a system identifier distinct from the source. Set up a fresh, isolated application database for each attempt with the recovery and erasure schemas initialized from the compatible immutable application build. The account in `DATABASE_URL` must be both the authenticated PostgreSQL superuser and the database owner, with the same role name as the archived owner. Set up the marker in that instance's `postgres` database as above. Keep the drill's network and protected storage private. The stock Compose file uses a fixed `postgres` owner. Use the installed host command and its isolated connection configuration when the source owner differs.

Provision `sabalan_application_runtime` and `sabalan_allocation_controller` separately on this isolated instance. Match the captured login flags, connection limits, expiry and absence of memberships, elevated attributes and per-role settings. Any necessary login credentials must be independent drill credentials held separately from the archive. The archive has no credentials. The drill verifies the existing principals and restores their grants without modifying the cluster roles.

Provide `DEPLOYMENT_DRILL_ROLE_TARGET_FILE` as an absolute pathname and `DEPLOYMENT_DRILL_ROLE_TARGET_SHA256` as the separately pinned hash of the exact file bytes. The drill user owns the regular, singly linked, mode-`0400` plan file. The private plan contains these fields.

| Field | Value |
| --- | --- |
| `format` | `sabalan-independent-role-drill-target/v1` |
| `checkpointId` | Checkpoint ID from the original remote sidecar |
| `ciphertextSha256`, `ciphertextSize` | Verified remote ciphertext SHA-256 and byte length |
| `snapshotSha256` | SHA-256 of the role component in the verified COMPLETE manifest |
| `sourceDatabase` | `name`, `oid` and `systemIdentifier` from the source sidecar |
| `recoveryHost` | `machineUuidSha256` and `kernelBootIdSha256` observed on the independent Linux host |
| `targetDatabase` | Observed isolated database `name`, `oid`, cluster `systemIdentifier` and authenticated `owner` |

Database OIDs and system identifiers are decimal strings. Observe the target identifiers on the isolated PostgreSQL instance after initialization. Use a newly sealed plan for each checkpoint, target rebuild or reboot. Resolve any pending restore journal before preparing a fresh attempt.

Run the existing drill command with this configuration. Role-aware restore preserves the exact archived PostgreSQL and SQLite schemas. The staged database and the replaced safety database use a zero connection limit for ordinary roles. The drill compares owner and ACL readback before and after finalization and only then records healthy evidence bound to the ACL snapshot and target plan digests. Historical COMPLETE packages continue through the regular drill path. A local fixture or a QA restore never counts as independent evidence, and no retention replacement is eligible until the independent host has completed the drill.
