# Release preparation — 2026-11-16

This is a local integration snapshot, not a production release or a GitHub merge.

## Included

- GitHub `main` / `ferpheri` at `08b4b837` (the refs pointed to the same commit when refreshed on 2026-11-16). This includes the later customer pickup verification and print-layout changes; the local merge commit is `e0603aa4`.
- Accounting dossier PR #453, head `f546dad7`, merged into the local preparation branch without file conflicts. The local merge commit is `1e301379`; the GitHub PR remains open.
- The Accounting PC biometric diagnostics correction documented in `docs/qa/biometric-accounting-production-status-2026-11-16.md`.

## Local verification

- Backend and frontend production builds passed on the combined tree.
- Database client ownership, Sabalan Design System adoption and foundation checks passed.
- The InvoiceDraftEditor, slab accounting quantity, biometric diagnostics workflow and biometric connector unit tests passed.
- The customer pickup candidate integration wrapper passed end to end against an isolated clone of the existing local PostgreSQL service with all 468 repository migrations applied. It verified pickup admission, finalization, OTP, waybill, invoice and exit authorization; the temporary database was removed and its absence checked. The focused test harness commits are `2b412047` and `86f22acd`; no live local business database was migrated.
- The repository's Git commit hook could not launch `/bin/bash` under this Windows environment. Equivalent architecture and design checks were run directly before the local merge commit.
- At the PR #453 head, GitHub checks for adoption, hiring workflow and contracts passed. The `database-client-ownership` job failed in ten deployment-storage tests invoking `docker compose config`; the browser-acceptance job was still queued at the time of inspection. This CI result is not covered by the successful local ownership check.
- The local release branch adds a narrow Compose-rendering diagnostic and fixes three deployment-storage fixtures that invoked relative Compose paths from the `backend` working directory. The same ten failures were reproduced locally before the fix. Afterwards, all 43 runnable tests in that suite passed from both `backend` and the repository root (three Linux-only tests skipped on Windows). The fix has not yet run in GitHub Actions because this branch is not published; the runner-side result remains unverified.
- Independent standards and issue reviews found that the in-dossier financial approval omitted required idempotency/correlation identities, while draft-save visibility reused the create-invoice action instead of its own projected availability. The focused fix projects `SAVE_INVOICE_DRAFT`, supplies stable identities for retries of the same approval payload, and removes redundant draft guidance. Its unit tests and production builds passed; the new browser-to-HTTP approval test compiles but still needs execution on a healthy, identity-bound application.

## Before release

- Refresh `main`, PR #453 and any later contributions; resolve any new conflicts and rerun affected tests.
- Run the remaining browser acceptance checks on a healthy, identity-bound local or protected QA application. The existing `sabalanerp-local` PostgreSQL service is healthy and supported the isolated pickup test, but its backend is restarting with `RUNTIME_NATIVE_AUTHORITY_UNPROVEN`; it has an ACTIVE native coordination record and an unattested image from another checkout. Preserve that record and resolve it only through the protected owner/closure procedure. This blocks treating the local frontend/backend as an application acceptance target. PR #453 reports its own browser and HTTP evidence and a separate `docker:verify` limitation.
- Confirm that the deployment-storage suite and all required CI jobs pass on the published combined candidate before promotion. The full `test:deployment-control` command advances past this suite locally, then stops at a separate Windows-only missing `bash.exe` dependency; the Linux CI run is needed for that segment.
- Run the in-dossier approval browser-to-HTTP acceptance test after the local native backend has a safely reconciled owner or on another authorized protected QA target. A successful compile is not a passing browser run.
- Use the protected production deployment workflow only after the combined candidate and its release gates are reviewed. No production service or GitHub ref was changed by this preparation.
