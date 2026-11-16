# Release preparation — 2026-11-16

This is a local integration snapshot, not a production release or a GitHub merge.

## Included

- GitHub `main` / `ferpheri` at `40edee41` (the refs pointed to the same commit when fetched).
- Accounting dossier PR #453, head `f546dad7`, merged into the local preparation branch without file conflicts. The local merge commit is `1e301379`; the GitHub PR remains open.
- The Accounting PC biometric diagnostics correction documented in `docs/qa/biometric-accounting-production-status-2026-11-16.md`.

## Local verification

- Backend and frontend production builds passed on the combined tree.
- Database client ownership, Sabalan Design System adoption and foundation checks passed.
- The InvoiceDraftEditor, slab accounting quantity, biometric diagnostics workflow and biometric connector unit tests passed.
- The repository's Git commit hook could not launch `/bin/bash` under this Windows environment. Equivalent architecture and design checks were run directly before the local merge commit.

## Before release

- Refresh `main`, PR #453 and any later contributions; resolve any new conflicts and rerun affected tests.
- Run the database integration and browser acceptance checks in an environment with the existing `sabalanerp-local` Docker project. Docker Desktop was unavailable during this local preparation. PR #453 reports its own browser and HTTP evidence and a separate `docker:verify` limitation.
- Use the protected production deployment workflow only after the combined candidate and its release gates are reviewed. No production service or GitHub ref was changed by this preparation.
