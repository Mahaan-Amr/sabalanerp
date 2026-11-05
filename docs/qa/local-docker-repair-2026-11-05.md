# Local Docker recovery — 2026-11-05

Scope: repair the existing `sabalanerp-local` environment used by the customer allocation workspace. No other Compose project was started.

## ERP restored

- The original `sabalanerp-local-backend-1` was stopped after the Docker restart. Its restart policy is deliberately `no`, following the earlier shutdown investigation; its startup command includes migration deployment. This policy was preserved.
- Both running candidate/retained slots have `BACKEND_RUNTIME_ROLE=candidate`. They are not substitutes for normal authenticated ERP traffic.
- The frontend still had the explicitly tagged temporary `/etc/hosts` candidate mapping from allocation validation. Removed that exact mapping, restoring Compose DNS for `backend`.
- Before starting the unchanged original backend, confirmed recovery coordination mode `NORMAL`, no pending restore journal in that directory, no active deployment row, zero unfinished migrations, and all 431 migrations contained in the original image already applied.
- Started the existing original backend without rebuilding/recreating it. PostgreSQL reports zero migrations started during this repair. Backend readiness and frontend API health return HTTP 200; the original backend is healthy.
- The actual browser test `customer-account-workspace.spec.ts --grep 'real local API'` passed, including real admin login and customer detail loading.

## Initial separate failures

Inquiry remains in its historical read-only preservation carrier, not the normal application. The carrier refuses startup because its pinned original SQLite snapshot has device `2112`, while the current Docker filesystem reports `2096`. Comparison of the original receipt with the current shared volume found **only** this field differs: inode, size, mode, ownership, nanosecond timestamps and SHA-256 match; no WAL/SHM/journal sidecars were present. The original receipt was not edited, the database was not restored or migrated, and historical #411/#419 acceptance is not asserted. Returning Inquiry to service requires its qualified preservation/recovery path, rather than deleting a hold or silently replacing the pinned receipt.

This paragraph records the initial state. The separately authorized local recovery below subsequently restored normal Inquiry service; the historical carrier and acceptance are not requalified.

`npm run docker:verify` was attempted. It builds before verifying; build failed before service promotion because the working tree has existing deletions under `packages/contract-product-graph/src` and `packages/partner-sales-contracts/src`. These unrelated deletions were not restored or committed. No `down`, volume removal or replacement stack was used.

The standard design-system E2E command now passes Docker preflight and can execute browser tests. Its two scenarios still fail at application assertions: Excel file selection has an accessible name that excludes visible text; the accounting nested-overlay scenario does not find the expected `پیگیری وضعیت سامانه مودیان` dialog. These are not Docker readiness failures. Traces and error contexts are retained under `test-results/design-system`.

## Restart limitation

The earlier intentional automatic-start guard is unchanged. A future Docker restart may again leave the primary backend stopped. Do not indiscriminately run `docker:verify` / `docker:dev`: they rebuild/start and can run migrations. Recheck current recovery/deployment and migration state before explicitly starting the existing primary container. This repair is not approval of deployment, automatic migration, historical recovery completion or Inquiry admission.

## Authorized local Inquiry recovery

The user subsequently explicitly authorized safe Inquiry recovery. A fresh local operation `7dc0a8a1d03e42fd84c2d23f35aed1d2` preserved the original root SQLite file and historical conservation receipt. No old authority token, lease, native hold, or historical acceptance was adopted. The carrier's current restart loop had no serving application; it was stopped normally. The current backend process received graceful SIGTERM and exited with code 0 before its mount was changed.

Using SQLite's backup API with a read-only source connection, created both a retained checkpoint in the existing backend recovery volume and an active copy under `inquiry_data/local-recovered-7dc0a8a1d03e42fd84c2d23f35aed1d2`. Both passed `integrity_check` and complete logical-dump equality. They contained the original 457 products, 3 admins and 7 users. Initial backup and active binary SHA-256 were both `3545c6b084a8b90a841be37337360a6ed3aaa069a82e60f66d3d0f9bf228ac4f`. The original root file's bytes and receipt-relevant current-generation metadata remained unchanged.

Reused the existing normal Inquiry application image and the unchanged backend image in the same Compose project. Both active mounts now select the restored subdirectory, including the backend's recovery source. No second stack, database service, or parallel Inquiry service was created. Recovery state remained `NORMAL`; the generic stopped acknowledgement is managed by the new supervisor's actual process lifecycle, not used to erase a historical hold.

Persisted the three documented local settings in the untracked `.env`, with its previous bytes preserved privately. The standard local and development Compose files now honor the restored subpath and a local no-seed/no-migration supervisor. The prior intentional backend restart policy `no` is preserved through Compose as well. Ordinary defaults and production startup are unchanged. See [local recovery operations](../operations/local-inquiry-recovery.md).

Validation:

- Five supervisor tests passed inside the existing Linux backend, with zero skips: actual graceful child shutdown/recovery resume, missing/corrupt database refusal, unexpected child failure, ordinary/online scope refusal, and a recovery request racing stopped-acknowledgement withdrawal. The last scenario failed before the second admission check was added and passed afterward.
- Real browser admin login, product creation through its server action, database persistence, and user login/product read passed. Temporary accounts and the product were removed in `finally`; the entire logical SQLite dump again equaled the preserved source. No existing password was reset.
- Actual Inquiry container restart followed by the same real browser checks passed, including after the final supervisor fix. No schema push or seed was executed.
- Backend readiness, frontend API health and normal Inquiry HTTP page return 200. Both services are healthy. Real ERP account/login browser regression passed after the backend mount change.
- Four design-system infrastructure tests and the database ownership architecture check passed. The previously observed two unrelated design-system application assertion failures are not claimed fixed. Full Docker rebuild is still blocked by unrelated deleted package sources.

Operational evidence and private configuration snapshots are retained under `reports/deploy/local-inquiry-recovery-7dc0a8a1d03e42fd84c2d23f35aed1d2` (ignored by Git); database contents remain inside the existing Linux volumes. This is a verified **local** service recovery, not production or historical #411/#419 acceptance. Subsequent business writes belong to the restored copy; blindly switching back to the old source would lose those new writes and is not a rollback procedure.

## Subsequent build repair

The user separately authorized recovery of the deleted package inputs while preserving existing work. That repair restored all 144 missing tracked files and subsequently passed complete backend and production frontend image builds. It also repaired a stale workspace checker and two dependency-install transport/lifecycle issues. The earlier missing-input build limitation above is historical; see [build input recovery](build-input-repair-2026-11-05.md). The unrelated design-system application assertions and historical #411/#419 acceptance remain separate. Serving services were not replaced during the build repair.
