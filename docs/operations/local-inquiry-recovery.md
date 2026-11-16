# Local Inquiry after a validated SQLite recovery

This is a local-development procedure for the existing `sabalanerp-local` project. It does not qualify historical online-deployment acceptance or replace the production checkpoint/deployment procedure.

## Configuration

After a SQLite backup has been integrity-checked and compared with its preserved source, the local `.env` may select the prepared **existing** subdirectory of the `inquiry_data` volume:

```dotenv
LOCAL_INQUIRY_DATA_SUBPATH=local-recovered-<operation-id>
LOCAL_INQUIRY_RESTORED=1
LOCAL_BACKEND_RESTART_POLICY=no
```

`docker-compose.local.yml` mounts that same subdirectory at `/data` in Inquiry and `/app/recovery-sources/inquiry` in the backend. This keeps application writes and the backend recovery/backup owner on the same database while preserving the historical root file. The directory must already exist. Never remove or change these settings to resolve a startup failure without identifying which database would become active.

Restored local mode runs `deploy/scripts/run-inquiry-local-restored.cjs`. It requires an existing SQLite file, refuses online-authority configuration, and never runs schema push or seed. It launches the actual Next process directly, acknowledges stopped state only after that process exits, and waits for both removal of the recovery restart request and `NORMAL` coordination state before serving again. Malformed/missing coordination state prevents serving. The supervisor rechecks recovery admission after withdrawing its previous stopped acknowledgement to close the startup/controller race.

The same restored mode is honored by the development Compose override. Ordinary mode, with no restored-local settings, keeps its existing schema preparation behavior. Production Compose and its startup script are unchanged.

## Operations

Verify the target before each Docker operation:

```powershell
npm run docker:local:ps
docker compose -f docker-compose.local.yml restart inquiry
```

For a deliberately stopped existing backend, first verify current recovery/deployment state, its image migration compatibility, and that starting it cannot apply a pending migration. Its startup still contains `prisma migrate deploy`; the local restart-policy setting deliberately prevents automatic startup on Docker reboot. Do not enable automatic backend restart as part of an Inquiry restart.

Do not use `down -v`, remove orphan historical containers, alter historical conservation receipts, or treat a healthy local Inquiry as proof of #411/#419 acceptance. Preserve both the historical source and the verified backup. After new writes, returning to the older source would discard acknowledged data; any later rollback must conserve the current database first.

## Verification

Run the supervisor tests inside the existing Linux backend, using copied test files if necessary; the actual SIGTERM lifecycle test intentionally skips on Windows because Windows terminates a child differently:

```sh
node --test tests/local-inquiry-recovery/supervisor.test.cjs
```

Validate real admin login, a disposable product write through the browser, user login/read, deterministic fixture cleanup, SQLite integrity, and agreement of the two active mount subpaths. Never reset existing accounts to make a smoke test pass.
