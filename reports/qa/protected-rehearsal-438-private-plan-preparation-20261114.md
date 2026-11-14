# #438 private controller plan preparation — 2026-11-14

## Status and boundary

This is a nonsecret preparation record for the isolated #432 Linux host. No private environment or v2 plan has been sealed, and no QA image, container, restore, key, sidecar, Docker data, production service, or #436 checkpoint was changed by this work. The v2 selector must run before source fetch, storage cleanup, lease, or maintenance. #432 remains NO-GO.

The source review found that the selector already pins the native Engine, named network namespace, clean commit/tree, Compose/environment hashes, custody paths, exact rendered graph and loopback ports. This branch additionally requires QA-specific push identity, explicitly blank taxpayer broker settings and unconfigured biometric settings in the QA environment. Missing values are refused so the controller shell cannot supply an inherited live delivery credential. The backend production-environment validator requires nonempty push keys, so generate a distinct QA-only VAPID pair; the internal application bridge prevents outbound push delivery. The selector checks the QA subject and key format, while independent custody review must prove the pair is newly generated and distinct from live keys. The focused selector test passed red then green.

## Plan to seal only after live revalidation

The root-only plan is a regular, single-link, mode-0400 JSON file **outside Git**, with exactly these fields. Values below marked `OBSERVE` or `PIN` are deliberately not guesses. Hash the final private environment bytes and the exact chosen candidate checkout; any later change requires a new plan/hash review.

```json
{
  "applicationCommit": "PIN_40_HEX_CANDIDATE_COMMIT",
  "applicationTree": "PIN_40_HEX_CANDIDATE_TREE",
  "backupHost": "qa-backup.sabalan.test",
  "composeSha256": "PIN_64_HEX_REHEARSAL_COMPOSE_SHA256",
  "domain": "erp.qa.test",
  "engineId": "OBSERVE_NATIVE_QA_ENGINE_ID",
  "environmentSha256": "PIN_64_HEX_PRIVATE_ENV_SHA256",
  "format": "sabalan-qa-rehearsal-target/v2",
  "hostname": "OBSERVE_QA_HOSTNAME",
  "inquiryDomain": "inquiry.qa.test",
  "machineId": "OBSERVE_QA_MACHINE_ID",
  "networkNamespace": "sabalanerp-qa",
  "networkNamespaceIdentity": "OBSERVE_NET_INODE",
  "productionBackupHost": "PIN_DISTINCT_PRODUCTION_BACKUP_HOSTNAME",
  "qaRoot": "/srv/sabalanerp-qa",
  "repositoryRoot": "/opt/sabalanerp"
}
```

The `networkNamespaceIdentity` syntax is `net:[inode]`, not a bare number. The current report observed Engine ID `33f03eef-8f8d-45a2-af36-b98958ddacde` and namespace inode `4026532847`, but both are session-bound and must be read again at sealing. The checkout must be a fresh, clean `/opt/sabalanerp` at the candidate commit. The six previous archives and candidate images need separate immutable identity review; neither the `.sabrec` nor this plan supplies image bytes.

## Private environment and disabled effects

Create the private environment outside Git as a root-owned, regular, single-link mode-0400 file. Start from `deploy/.env.prod.template`, resolve every required value privately, and review the rendered `docker-compose.rehearsal.yml` with the deployment profile before sealing its SHA-256. The following values are fixed for this QA target:

| Setting | Required private value |
| --- | --- |
| `DOMAIN`, `INQUIRY_DOMAIN` | `erp.qa.test`, `inquiry.qa.test` |
| `PUBLIC_APP_URL`, `FRONTEND_URL`, `NEXT_PUBLIC_API_URL` | `https://erp.qa.test` |
| `DEPLOYMENT_NGINX_BIND_ADDRESS` | `127.0.0.1` inside the named namespace |
| `DEPLOYMENT_BACKUP_TARGET`, `DEPLOYMENT_BACKUP_HOST` | `qa`, `qa-backup.sabalan.test` |
| `DEPLOYMENT_BACKUP_USER`, `DEPLOYMENT_BACKUP_OPERATIONS_USER` | `sabalan-qa-backup`, `sabalan-qa-backup-ops` |
| `DEPLOYMENT_SECRET_DIR`, `DEPLOYMENT_REMOTE_MOUNT_HOST`, `DEPLOYMENT_REPORT_DIR_HOST` | Canonical paths below `/srv/sabalanerp-qa`; remote is exactly `/srv/sabalanerp-qa/remote` |
| `DEPLOYMENT_BACKUP_SSH_KEY_FILE`, `DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE`, `DEPLOYMENT_BACKUP_KNOWN_HOSTS_FILE` | Three distinct canonical files below `/srv/sabalanerp-qa/ssh` |
| `SMS_IR_ENVIRONMENT`, `SMS_IR_API_URL`, `SMS_IR_API_KEY` | `production`, `http://127.0.0.1:9`, synthetic `qa-disabled-` plus at least 32 alphanumeric characters |
| `WEB_PUSH_VAPID_SUBJECT` | `mailto:qa-disabled@erp.qa.test` |
| `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` | Newly generated valid QA-only VAPID pair, never live key material; review fingerprints privately |
| `TAXPAYER_DELIVERY_BROKER_ENDPOINT`, `TAXPAYER_BROKER_URL` | Explicitly empty |
| `BIOMETRIC_CONNECTOR_MODE`, `BIOMETRIC_WORKSTATIONS_JSON` | `unconfigured`, `{}` |
| `INQUIRY_DATABASE_URL` | `file:/data/inquiry.db` on the QA-only Inquiry volume |

Use distinct QA PostgreSQL credentials and database, auth/session/OTP secrets, and no live SMS, push, biometric or taxpayer delivery credentials. The application bridge must remain Docker-internal; only ClamAV receives the private egress bridge. The inherited production Compose runtime sets backend/frontend/Inquiry `NODE_ENV=production` for the protected release and its ordinary runtime validators. The **separate isolated recovery drill invocation** must instead have `NODE_ENV=test`, `DEPLOYMENT_DRILL_ISOLATED=true`, distinct QA `DATABASE_URL` and `PRODUCTION_DATABASE_URL`, and a unique 32+ character marker in the QA PostgreSQL `postgres` control database. Do not infer drill isolation from the release environment.

Inside the named namespace, resolve both QA names only to `127.0.0.1`, install distinct QA TLS certificate material in the QA certbot volume, then verify real certificate-checked HTTPS maintenance 503 on both origins before the protected run. A rendered port mapping alone does not prove this.

## Source object, sidecar and key custody

The EFS-protected D: source copy has an encrypted object of 1,476,223,433 bytes, SHA-256 `7362fb97b178e653c38a7397b510fca5c5a57d44feef1867146098beefe97e15`, and a read-only sidecar of 902,059 bytes, SHA-256 `fb1012a97eec86f45736037e9d9245507e7056fb3acf14d63a12673183c0e340`. Preserve it and the off-server originals. Stage an independently size/hash-verified encrypted object under QA root; for **each** restore/run make a separate writable sidecar copy from the verified source. The drill edits its sidecar. Do not point it at the original or the D: read-only copy.

Review only the matching recovery private key and application performance/export decryption keys into root-only QA custody. Verify source, owner, link count, mode and recipient public-key fingerprint without printing key bytes. Public-key pairing alone does not prove payload decryption; actual isolated restore must verify PostgreSQL, Inquiry, all protected file families, source metadata, file references and application payloads. No key value belongs in Git, reports, controller output, the six Desktop local services, or production.

The independent QA backup is `sabalan-qa-backup@qa-backup.sabalan.test:/checkpoints`, mounted by a session-bound SSHFS process at `/srv/sabalanerp-qa/remote`. Its prior SFTP atomic rename/readback and operations preflight passed. Before each protected run recheck exact SSHFS source/process/namespace, strict host key, remote independent readback and capacity. The [bounded cache cleanup](backup-host-cache-cleanup-20261114.md) left 9,172,582,400 bytes free at the final independent read. Against the refreshed 2,514,437,422-byte source, 2,891,603,036-byte checkpoint estimate, and 3,036,183,188-byte remote preflight estimate, two checkpoints plus the next preflight leave only 353,193,140 bytes of planning margin. That observation is not a reservation or admission for another run. Keep production's nine checkpoints and incident holds.

## Safe next gates, in order

1. Reobserve the six `sabalanerp-local` IDs/health and #436 C:/D: custody before any Docker action; revalidate held namespace owner, native daemon PID/birth/socket/flags, Engine ID, `/run/docker.pid`, FD9/pidfd/shared PID view, SSHFS source/process/readback and D:/Docker-root capacity. If the held owner or namespace changed, stop and repeat its reviewed qualification.
2. Independently verify the six previous archives and immutable IDs before QA-only import. Pin candidate backend/frontend/Inquiry images from the exact clean candidate commit/tree, with previous PostgreSQL/ClamAV/Nginx retained. The D:-backed VHDX layer encryption limitation remains recorded.
3. Review and stage the encrypted object, per-run writable sidecar, exact root-only key mounts and nonsecret environment values. Prove isolated restore and payload decryption. No production or local path alias is permitted.
4. Seal the private environment, then the v2 plan and its SHA; verify every selector and rendered graph gate in the pinned namespace. Prove both actual HTTPS 503 origins and independent backup capacity immediately before the maintenance boundary.
5. Only after independent review, run one real `COMPLETED` protected release and a separate injected post-mutation `ROLLED_BACK` run on reset QA state, recording leases, checkpoint/readback, image gates, migration, representative business reads/writes and acknowledged-write preservation. A component restore, no-data probe or fixture result does not admit #432.
