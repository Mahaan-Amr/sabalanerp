# Run local Inquiry from a recovered SQLite database

Use this procedure for the existing `sabalanerp-local` project after preparing and validating a private restored copy. Preserve the historical root database, its conservation receipt, and the verified backup. If the restored copy has accepted writes, conserve its current data before switching to another copy.

Prepare the database for the current Inquiry image through the owned recovery workflow described in [online deployment](online-deployment.md). The copy needs the expected SQLite schema and migration ledger, a passing integrity check, and an existing administrator. A historical database without the ledger needs owned adoption on the verified private stage. Inquiry startup performs read-only verification each time it starts or resumes.

Keep the existing volume subdirectory selected in the local `.env` for as long as the recovered configuration is in use. Its name must start with `local-recovered-` and end with the operation identifier. The following example also keeps a deliberately stopped backend from starting automatically after a Docker reboot.

```dotenv
LOCAL_INQUIRY_DATA_SUBPATH=local-recovered-<operation-id>
LOCAL_BACKEND_RESTART_POLICY=no
```

Apply `docker-compose.local-inquiry-recovery.yml` explicitly after `docker-compose.local.yml` for the existing `sabalanerp-local` project. The overlay selects the compiled Inquiry launcher and gives both services the same `inquiry_data` subpath and recovery coordination mount. The mount follows the backend `LOCAL_RECOVERY_COORDINATION_SOURCE` setting, with the `recovery_coordination` named volume as the default.

The `docker:local:up`, `docker:local:acceptance:up`, `docker:dev`, and `docker:verify` commands refuse to recreate services while Compose resolves a recovery selection. Keep the development override out of the recovered configuration so the backend retains its ownership and database preflight command. Use the recovery file list below for direct startup or recreation of the backend or Inquiry. Local biometric setup and reset also refuse to proceed while recovery is selected.

Verify the target status before Docker operations and inspect the resolved mounts before recreating either service:

```powershell
npm run docker:local:ps
$config = docker compose -f docker-compose.local.yml -f docker-compose.local-inquiry-recovery.yml config --no-env-resolution --format json | ConvertFrom-Json
$config.services.backend.volumes | Where-Object target -in '/app/recovery-sources/inquiry', '/app/recovery-coordination'
$config.services.inquiry.volumes
```

Confirm that both Inquiry mounts resolve to the intended existing directory and that no restore journal, deployment maintenance, or protected native operation is active. Manage both services with the same file list for the lifetime of the recovered configuration. Applying a new mount requires coordinated recreation of the existing services. Before recreating or starting the backend, confirm that its image matches the selected local data and that no PostgreSQL migration is pending, since the ordinary backend startup runs migration deployment. Once the prerequisites are confirmed and the dependencies are healthy, apply the same file list to both services:

```powershell
docker compose -f docker-compose.local.yml -f docker-compose.local-inquiry-recovery.yml up -d --wait --no-deps backend inquiry
```

For a restart after applying this configuration, verify the exact mounts of the existing services first.

The local launcher checks compiled browser identity and verified SQLite admission before serving. It waits for valid `NORMAL` recovery state and for recovery and deployment hold files to clear. It acknowledges an Inquiry stop only after the actual Next process has exited. The launcher refuses managed online startup inputs. Keep existing accounts and use disposable fixtures to verify admin login, a product write, and user read access on the recovered copy.

Run `node --test tests/local-inquiry-recovery/compose.test.mjs tests/local-inquiry-recovery/supervisor.test.cjs` for the focused fixtures. The Compose configuration tests require the Compose CLI. Use Linux for the graceful SIGTERM case.
