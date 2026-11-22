# Contract save reliability — 2026-10-28

Status: complete for the user-authorized local scope. Implementation, integration checks and final browser acceptance passed. Production publication is explicitly excluded by the latest user instruction.

Source base: inspected production checkout `45cab522a285b878b60f537d09d0962912bba096`, isolated branch `codex/contract-save-reliability`; implementation commit `93dbd0f2`. The running production image separately reported source `b58c53c0f88d2d89da3cb6a45949e6eca97e4308`; checkout identity is not evidence of deployed image identity. Unrelated source changes in the primary checkout were preserved.

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
- Final combined database run: 50 passed (49 Partner Case checks plus the delayed ordinary-edit check), including create/revise, quote timeout, concurrent commands, authorization, financial corrections and unchanged finality.
- Recovery/snapshot/backend budget checks: 15 passed; delayed ordinary edit integration: 1 passed; ordinary discount edit integration passed with rollback.
- Frontend targeted recovery/submission checks: 77 passed after the final recovery-message change. Product/delivery identity and recovery journal checks passed in the broader 81-check run before that narrow message change.
- Mutation request headers/API normalization: 4 passed; browser handoff/session unit checks: 10 passed; Sales/Partner operational error suites passed.
- Final identified-image browser acceptance: 11 passed. This covers ordinary revision refresh with real Chromium quota denial and recovery; Partner writer-conflict presentation at 1280/390px; initial numbering/reload with normal, delayed, rejected, missing-checkpoint and restore-failure saves; fourteen-product correction with timeout and exactly one explicit retry; and reviewed corrections retaining prior payments at 1280/390px.
- Browser identity/artifact checks: 2 passed. The browser acceptance now reports a missing build identity as a prerequisite failure before testing quota recovery.

## Final local runtime and browser diagnosis

Only the existing `sabalanerp-local` project/database and its established Compose files were used. No second stack or database was created. The shared environment was coordinated with the concurrently authorized PDF review before taking an exclusive acceptance window.

The previously unresolved archive/reload failure was `BROWSER_BUILD_HANDOFF_BUILD_UNPROVEN`, not loss of browser storage or an archive defect. The default unidentified development image intentionally cannot qualify preservation. Temporary targeted probes proved that the captured draft stayed equal while this prerequisite rejected both attempts. The production guard remains unchanged; no legacy build is relabeled or admitted.

The final frontend was built through the existing `docker-compose.performance-acceptance.yml` runner target with `SABALAN_BROWSER_BUILD_ID=erp_local_contract_save_93dbd0f2`. Its real `BUILD_ID`, `browser-build-identity.json` and request producer identity agree. On that artifact the original quota/refresh acceptance passed, including independent archive readback, exact original draft/date preservation and mobile/200% zoom checks. The final backend's compiled contract service, Partner aggregate and Partner route bytes match the local compiled source outputs exactly.

The candidate backend reused the existing local database with `node dist/index.js`; no migrations were applied because this shared database also contains another task's in-progress migrations. This is a local acceptance configuration, not a production deployment procedure. Core backend/frontend/Postgres/Redis were healthy. Existing unrelated ClamAV update failure is still recorded; full antivirus/full-stack health is not claimed by the contract checks.

All temporary probes were removed from source and superseded runtime containers. The prior PDF task's invoice 1, its loading reference `cmvrrj0q100xl1g1htjwj8hja`, non-voided status and exact stored PDF bytes were independently checked against the original exported PDF. Those records/files were not rewritten.

### Reproduction commands

Run from this worktree, against the existing Compose project only:

```sh
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml -f docker-compose.performance-acceptance.yml build --build-arg NPM_CONFIG_REGISTRY=https://registry.npmjs.org --build-arg SABALAN_BROWSER_BUILD_ID=erp_local_contract_save_93dbd0f2 frontend
docker compose -f docker-compose.local.yml -f docker-compose.performance-acceptance.yml up -d --no-deps --no-build frontend
node scripts/run-design-system-e2e.mjs tests/design-system-e2e/contract-draft-handoff.spec.ts tests/design-system-e2e/partner-correction-recovery-errors.spec.ts --retries=0
node scripts/run-design-system-e2e.mjs tests/design-system-e2e/partner-creation-entry-regressions.spec.ts --grep 'initial Partner inquiry persists' --retries=0
node scripts/run-design-system-e2e.mjs tests/design-system-e2e/partner-creation-entry-regressions.spec.ts --grep 'fourteen-product correction|Reviewed Partner correction starts' --retries=0
```

Use a backend compiled from the same candidate for these browser checks. Do not apply this branch's migrations to another task's mixed local database merely to run acceptance, and do not replace shared runtime services without coordinating their use.

## Production boundary and latest authorization

The user subsequently instructed: “i do not want you to change anything in the server. just do the changes in the local”. No server work continued after that instruction; the interactive SSH connection was closed and no production publication is included in this task.

Before that instruction, inspection found the existing ClamAV updater unable to reach its fixed mirror, and the independent proxy path also failed a bounded read-only probe. The canonical reference-aware storage preflight ran under the existing host lock on production and the independent backup host: both passed, with zero containers/images removed. Private operational logs were recorded. No application restart, migration, business-data mutation, maintenance transition or deployment occurred.

A future production update requires separate user authorization and the complete documented deployment process. This local completion grants no production or online-update admission.
