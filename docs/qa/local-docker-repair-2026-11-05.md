# Local Docker recovery — 2026-11-05

Scope: repair the existing `sabalanerp-local` environment used by the customer allocation workspace. No other Compose project was started.

## ERP restored

- The original `sabalanerp-local-backend-1` was stopped after the Docker restart. Its restart policy is deliberately `no`, following the earlier shutdown investigation; its startup command includes migration deployment. This policy was preserved.
- Both running candidate/retained slots have `BACKEND_RUNTIME_ROLE=candidate`. They are not substitutes for normal authenticated ERP traffic.
- The frontend still had the explicitly tagged temporary `/etc/hosts` candidate mapping from allocation validation. Removed that exact mapping, restoring Compose DNS for `backend`.
- Before starting the unchanged original backend, confirmed recovery coordination mode `NORMAL`, no pending restore journal in that directory, no active deployment row, zero unfinished migrations, and all 431 migrations contained in the original image already applied.
- Started the existing original backend without rebuilding/recreating it. PostgreSQL reports zero migrations started during this repair. Backend readiness and frontend API health return HTTP 200; the original backend is healthy.
- The actual browser test `customer-account-workspace.spec.ts --grep 'real local API'` passed, including real admin login and customer detail loading.

## Remaining separate failures

Inquiry remains in its historical read-only preservation carrier, not the normal application. The carrier refuses startup because its pinned original SQLite snapshot has device `2112`, while the current Docker filesystem reports `2096`. Comparison of the original receipt with the current shared volume found **only** this field differs: inode, size, mode, ownership, nanosecond timestamps and SHA-256 match; no WAL/SHM/journal sidecars were present. The original receipt was not edited, the database was not restored or migrated, and historical #411/#419 acceptance is not asserted. Returning Inquiry to service requires its qualified preservation/recovery path, rather than deleting a hold or silently replacing the pinned receipt.

`npm run docker:verify` was attempted. It builds before verifying; build failed before service promotion because the working tree has existing deletions under `packages/contract-product-graph/src` and `packages/partner-sales-contracts/src`. These unrelated deletions were not restored or committed. No `down`, volume removal or replacement stack was used.

The standard design-system E2E command now passes Docker preflight and can execute browser tests. Its two scenarios still fail at application assertions: Excel file selection has an accessible name that excludes visible text; the accounting nested-overlay scenario does not find the expected `پیگیری وضعیت سامانه مودیان` dialog. These are not Docker readiness failures. Traces and error contexts are retained under `test-results/design-system`.

## Restart limitation

The earlier intentional automatic-start guard is unchanged. A future Docker restart may again leave the primary backend stopped. Do not indiscriminately run `docker:verify` / `docker:dev`: they rebuild/start and can run migrations. Recheck current recovery/deployment and migration state before explicitly starting the existing primary container. This repair is not approval of deployment, automatic migration, historical recovery completion or Inquiry admission.
