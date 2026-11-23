# Run local Inquiry from a recovered SQLite database

Use this procedure for the existing `sabalanerp-local` project after preparing and validating a private restored copy. Preserve the historical root database, its conservation receipt, and the verified backup. If the restored copy has accepted writes, conserve its current data before switching to another copy.

Prepare the database for the current Inquiry image through the owned recovery workflow described in [online deployment](online-deployment.md). The copy needs the expected SQLite schema and migration ledger, a passing integrity check, and an existing administrator. A historical database without the ledger needs owned adoption on the verified private stage. Inquiry startup performs read-only verification each time it starts or resumes.

Set the existing volume subdirectory in the local `.env` or shell. Its name must start with `local-recovered-` and end with the operation identifier. The following example also keeps a deliberately stopped backend from starting automatically after a Docker reboot.

```dotenv
LOCAL_INQUIRY_DATA_SUBPATH=local-recovered-<operation-id>
LOCAL_BACKEND_RESTART_POLICY=no
```

Apply `docker-compose.local-inquiry-recovery.yml` explicitly and last. For the development configuration insert `-f docker-compose.dev.yml` before it. Use the local recovery override with the existing local project only. The overlay gives Inquiry and the backend recovery owner the same `inquiry_data` subpath and the same `recovery_coordination` volume. It selects the compiled Inquiry launcher in both configurations. Ordinary Compose files still use their existing commands and mounts.

Verify the target status before Docker operations and inspect the resolved mounts before recreating either service:

```powershell
npm run docker:local:ps
$config = docker compose -f docker-compose.local.yml -f docker-compose.local-inquiry-recovery.yml config --no-env-resolution --format json | ConvertFrom-Json
$config.services.backend.volumes | Where-Object target -in '/app/recovery-sources/inquiry', '/app/recovery-coordination'
$config.services.inquiry.volumes
```

Confirm that both Inquiry mounts resolve to the intended existing directory and that no restore journal, deployment maintenance, or protected native operation is active. Manage both services with the same file list for the lifetime of the recovered configuration. Applying a new mount requires coordinated recreation of the existing services. Before recreating or starting the backend, confirm that its image matches the selected local data and that no PostgreSQL migration is pending, since the ordinary backend startup runs migration deployment. For a restart after applying this configuration, verify the exact mounts of the existing services first.

The local launcher checks compiled browser identity and verified SQLite admission before serving. It waits for valid `NORMAL` recovery state and for recovery and deployment hold files to clear. It acknowledges an Inquiry stop only after the actual Next process has exited. The launcher refuses managed online startup inputs. Keep existing accounts and use disposable fixtures to verify admin login, a product write, and user read access on the recovered copy.

The focused fixture command is `node --test tests/local-inquiry-recovery/supervisor.test.cjs`. Use Linux for the graceful SIGTERM case.
