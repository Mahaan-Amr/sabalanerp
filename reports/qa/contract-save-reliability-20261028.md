# Contract save reliability — 2026-10-28

Status: implementation and focused regression checks passed. Production activation is blocked; final browser acceptance is incomplete.

Source base: production checkout `45cab522a285b878b60f537d09d0962912bba096`, isolated branch `codex/contract-save-reliability`. Unrelated changes in the primary checkout were preserved.

## Findings and changes

| Issue | Internal Sabalan seller | Partner seller |
| --- | --- | --- |
| Transaction expiry during save | Creation already used a bounded 15-second transaction; editing now uses the same budget. | Case create/revise already used 15 seconds. The quote HTTP transaction preceding save still used Prisma's five-second default; it now uses the existing Partner budget. |
| Product replacement leaves obsolete delivery references | Existing exact-row validation and explicit repair behavior were verified by the product/delivery identity tests. Final save remains strict. | Incomplete drafts previously preserved obsolete references in canonical content but attempted to insert them into a foreign-key-constrained current-row table. Both initial creation and revision now bind only exact current row IDs, while preserving the complete entered plan in canonical content and the editor projection. |
| Conflicting concurrent edit appears as generic server failure | The existing concurrency rejection now returns HTTP 409 with `SALES_CONTRACT_VERSION_CONFLICT`. Frontend recovery distinguishes this confirmed rejection from uncertain writes and retains the edit lease and draft. | Existing revision/integrity conflicts, idempotent command outcomes and durable pending-command recovery remain enforced and were tested. |
| Recovery and duplicate submits | Recovery concurrency, product identity, payment/discount preservation and stable mutation retry-key checks passed. | Latest validated snapshot selection, graph/reference coherence, lost-response replay, double clicks, stale writers and explicit approval acceptance checks passed. |

No schema migration, unit-price override, global pool timeout change, automatic business-write retry, inferred product reassignment or relaxation of finalization/financial approval rules was introduced.

## Reproductions

- Ordinary edit: an actual `updateContract` transaction with 5.2 seconds of injected PostgreSQL work expired with the old call site. The same scenario passed after the change. The harness then deliberately rolled back and independently verified the original complete contract row.
- Partner quote: the real Express route with the same 5.2-second database delay returned `TEMPORARY_FAILURE`/503 with `P2028` before the change. It now reaches the expected missing-profile authorization boundary and returns `NOT_FOUND`/404.
- Partner product replacement: forcing the deferred delivery-item foreign key to immediate reproduced PostgreSQL `23503` before the change. Afterward, the exact obsolete plan survives in the draft, no obsolete relational binding is inserted, completion is rejected without advancing the revision, and explicit corrected allocation saves successfully.
- New incomplete Partner Case: mixed valid/obsolete allocations preserve the entered plan, bind only the valid exact row, and replay without creating another revision or delivery binding.

## Passing validation

- Backend build (`tsc` and cutover compilation), frontend production build, and final local frontend Docker build.
- `npm run architecture:check`, `npm run design-system:check`, design-system foundation (25 checks) and adoption (14 checks).
- Partner Case integration suite: 49 passed, including create/revise, quote timeout, concurrent commands, authorization, financial corrections and unchanged finality.
- Recovery/snapshot/backend budget checks: 15 passed; delayed ordinary edit integration: 1 passed; ordinary discount edit integration passed with rollback.
- Frontend targeted recovery/submission checks: 77 passed after the final recovery-message change. Product/delivery identity and recovery journal checks passed in the broader 81-check run before that narrow message change.
- Mutation request headers/API normalization: 4 passed; browser handoff/session unit checks: 10 passed; Sales/Partner operational error suites passed.
- A preliminary Partner browser check passed at desktop/mobile widths against the previously running local frontend. This is not acceptance of the final candidate.

## Browser and runtime limitations

Only the existing `sabalanerp-local` project and database were used; no alternate stack or database was created. Production data was not copied or changed for these tests.

The local runtime initially differed from the production-based candidate. Rebuilding its frontend succeeded after retrying a dependency-download network failure. Final browser checks were not all green: the ordinary archive/reload scenario failed to reload after quota recovery, and Partner login failed. The local backend was subsequently observed replaced and left in `created` state while ClamAV was unhealthy. Its database migration history also differs from this source branch (both missing and additional migration names). No migrations were applied to reconcile that unrelated work. Final browser acceptance must be rerun on a coordinated healthy runtime with matching source identities; the archive/reload failure remains unresolved and must not be relabeled as passed.

Temporary diagnostic changes were removed from source, and a final clean frontend image was rebuilt. No further service promotion was attempted after detecting changes to the shared runtime.

## Production boundary

Read-only production inspection found ClamAV unhealthy, with the repeated health result `latest update failed or is incomplete`. The mandatory health gates in `docs/operations/zero-data-loss-deployment.md` prohibit admitting a new release in this condition. No deployment, restart, production database mutation, storage cleanup or maintenance transition was performed for this implementation.

Before activation: recover and verify scanner health through its documented process, run reference-aware storage preflight on production and the independent backup host, establish the verified checkpoint and all remaining protected-release gates, and finish browser acceptance. Preserve the newest two complete healthy independently verified recovery points and all active incident dependencies. No bypass or partial promotion is permitted.
