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
node dist/scripts/deployment-recovery-drill.js
```

The command validates the encrypted object and checksum, restores PostgreSQL, SQLite, and protected files, applies current migrations in the isolated environment, validates database-to-file references, finalizes recovery, runs a database probe, records a durable report, and marks the remote metadata with the successful drill result. Any failure leaves a non-zero result and must be resolved before the next production deployment.

For automatic monthly execution, install `deploy/systemd/sabalanerp-recovery-drill.service` and `.timer` on the independent drill host, install `deploy/recovery-drill.env.template` as `/etc/sabalanerp/recovery-drill.env` with mode `0600`, then enable the timer with `systemctl enable --now sabalanerp-recovery-drill.timer`. The timer finds the newest remote sidecar itself and is persistent across host downtime. The private recovery key exists only on this independent drill host; it is never mounted into the production backend or production deployment runner.

The quarterly supervised rehearsal additionally executes `deploy/scripts/deploy.sh` against the isolated environment, injects one failure before mutation and one after mutation, and records acknowledged-write counts, rollback duration, gate results, and the absence of public traffic during maintenance. After one separate `COMPLETED` run and one `ROLLED_BACK` run, set `DEPLOYMENT_REHEARSAL_SUCCESS_JOURNAL`, `DEPLOYMENT_REHEARSAL_ROLLBACK_JOURNAL`, and `DEPLOYMENT_DRILL_METADATA_PATH`, then run `node dist/scripts/deployment-rehearsal-record.js`. The command accepts only checksum-valid journal chains with the two required terminal states. Missing monthly drill evidence after 35 days or quarterly rehearsal evidence after 100 days blocks production deployment automatically.
