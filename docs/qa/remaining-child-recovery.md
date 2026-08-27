# Remaining-stone write recovery verification

## Failure and scope

The captured five-row longitudinal/stair draft failed before contract insertion: the legacy graph adapter emitted remaining-stone children with no canonical base-material amount and discarded their allocations. Discount eligibility correctly refused the missing amount. Simply defaulting it to zero would have left the original source inventory incorrectly unconsumed.

The new write-only bridge validates paid-source evidence, stable physical lineage, allocation chronology, per-source distribution, cutting rates, child-owned operations, each row's amount, and final inventory before producing zero-material child pricing and replayable allocations. Create and authorized edit use the same bridge; normal reads and historical migrations retain their previous behavior. Existing formal correction authorization is unchanged. No production deployment or historical rewrite was performed.

Automatic compatibility recovery is intentionally limited to same-length longitudinal layouts whose per-source distribution is uniquely determined by capacity, generated-remainder identities and requested count. Tests also cover a proved 2/2/1 distribution with two untouched original source units retained. Other layouts or incomplete/contradictory evidence are blocked, not optimized or guessed. A new layout unsupported by the bridge may still need an explicit physical-layout writer; the Persian message warns that merely recreating that layout is insufficient and directs the user to support without deletion. Missing/cyclic dependency evidence likewise receives no invented reconstruction order.

## Regression evidence

- The original fixture initially reproduced missing base amounts for all three children.
- Corrected graph preserves row totals: 6,545,000; 125,000; 125,000; 100,000; 16,176,875 toman. Contract total remains 23,071,875 toman.
- Physical source consumption remains 5, 5, 1 pieces. Final inventory is five 0.1cm strips, one 2cm strip, and eleven independent 3cm stair remnants, all 1.25m long.
- Serialization and subsequent canonical replay preserve allocations; changing an independent row does not rebuild the other chain, and deleting a secondary producer while it has a consumer is rejected.
- Negative tests cover missing/duplicate lineage and chronology, unknown/nonzero material evidence, absent/changed cut rates, operation-price drift, duplicate consumption, resurrected stock, missing final inventory, omitted consumed children, contradictory source prices, and compensating row-total changes.
- Local PostgreSQL integration exercises the actual create/edit services, migration snapshot replacement, zero discount base calculation, preserved item identities, read-only historical access, failed-save atomicity, and signed-contract authorization. All seeded data is rolled back in one transaction; the harness closes its database client.
- Mobile browser test injects a typed 422 response through the real wizard, verifies complete row-specific Persian guidance, all five retained draft rows and physical IDs in the scoped recovery journal, and no horizontal overflow at 390px.

## Commands run successfully

From the package: `npm run typecheck`, `npm test`, `npm run test:remaining-recovery`.

From backend: `npm run build`, `npm run test:remaining-recovery`, `npm run test:remaining-recovery:integration` (existing local Compose PostgreSQL only), `npm run test:product-graph-migration`, `npm run test:product-graph-persistence`.

From frontend: `npm run test:contract-creation`.

From root: `npm run build:frontend`, `npm run architecture:check`, `npm run design-system:check`, `npm run test:design-system-foundation`, `npm run test:design-system-adoption`, `npm run docker:verify`, `npm run test:design-system:e2e -- remaining-recovery.spec.ts`, `git diff --check`.

Frontend production build retains pre-existing lint/Browserslist warnings. The working branch is `codex/fix-remaining-child-canonical`, based on `origin/main` at `c3d8a9922b99201d094e5e2bbd0562903a786442`, in a separate worktree to preserve the user's main checkout changes.

## Release-critical QA expansion (2026-08-27)

### Impact map and environment

| Boundary | Verification |
| --- | --- |
| Create/recovered draft | Real authenticated wizard submission, early discount normalization, canonical write bridge, five-row fixture |
| Authorized edit | No-change save, unchanged item identities/totals, allocation replay, signed-contract correction guard |
| Persistence | Actual migrated PostgreSQL schema, transaction rollback, graph snapshot revision, bounded CRM/accounting snapshots |
| Consumers | Detail/reload/edit, accounting view, canonical PDF/accounting/workshop/delivery/logistics projections |
| Failure/retry | Typed 422, row/source/producer/descendant guidance, preserved recovery journal, retry without duplicate submission |
| Unrelated families | Independent legacy rows, canonical stair layers, longitudinal/stair/slab/prepared rows and existing broader suites |

All runtime tests use the existing `sabalanerp-local` project and its local PostgreSQL on port 55432. No production connection, business correction, bulk historical rewrite, external message, or deployment is performed. The initial schema baseline had 173 applied migrations; the late upstream integration audit below records 181. Real UI tests use namespaced QA customer/project/catalog fixtures; service integration tests roll back their own transaction. The frontend runtime is the repository's local development target; the separate production frontend build also passes.

### Additional regressions caught before publication

1. Canonical paid-remainder stair layers were incorrectly interpreted as legacy partition usage. Layer-only replay now retains its canonical owner; mixed layer/partition chronology remains blocked when ambiguous.
2. Missing or contradictory generated-child identities could under-report descendants in recovery guidance. The complete physical lineage must now resolve before proposing any reconstruction order; otherwise support is required without deletion.
3. Earlier canonical source-policy errors now receive chain-aware guidance too, rather than losing source/dependent context.
4. Independent source-only rows no longer require paid-child price reconciliation or stable UI-cache IDs when canonical geometry/quantity proves unchanged inventory.
5. Independent historical rows with no canonical source stock/base price, no children and no usage ledger remain opaque snapshots. The recovery bridge neither invents stock nor demands evidence for nonexistent children. The regression test failed before the narrow exemption and passes afterward; the canonical missing-children/consumed-inventory rejection remains covered.
6. One pre-existing Accounting E2E mock omitted the API's required visible/enabled `nextBestActions` entry. Only the fixture was corrected; application behavior and permissions were not changed.
7. Visual PDF inspection caught an output-only defect: the fourth row printed four source stones (its requested output count), although the canonical allocation consumed one 26cm source. The print boundary now projects frozen source geometry and consumed counts, including secondary/layer-generated source evidence, without repricing or replaying availability. The existing secondary-geometry owner is reused; contradictory geometry is rejected. The PDF template cache version is advanced so the corrected output is regenerated.
8. The canonical-to-legacy projection erased legacy row descriptions, and the print fallback selected the first same-catalog relation. Descriptions now preserve canonical precedence, legacy text, explicit blank versus absence, and stable row ownership. Missing notes may fall back only to an exact row identity or an unambiguous identity-less historical relation. No positional or ambiguous catalog fallback remains. Six print suites pass, including the original five suites and the exact recovered fixture; source rows reconcile to 5/5/1 pieces and 0.75/0.375/0.325 square meters.

The print changes do not rewrite stored contracts, their prices, or source inventory. Canonical parser shape validation is not claimed to be full chronology replay. The layer-generated projection test uses actual layer/remainder policy results; an attempted full mixed-command reproduction encountered pre-existing graph-integrity restrictions, so it is not counted as a successfully tested persisted mixed-layer user path.

### Read-only historical comparison

The local audit scanned 260 stored contracts (including two interrupted local QA fixtures awaiting cleanup): 308 longitudinal, 193 stair, 6 prepared, 1 slab and 51 untyped product rows. It compared the same stored policy/input with recovery disabled/enabled without writing any contract.

- 209 inputs passed the old migration-plan path; 204 pass the stricter write-recovery path.
- 28 unrelated historical contracts initially regressed and pass after the independent-row exemption.
- Five remain newly blocked: three have actual remaining-child consumption but no provable paid-source policy; two lack stable physical lineage identities. This is a raw-input migration comparison, not an assertion that every historical contract is editable through every permission/state path.
- 51 inputs already fail the old plan and were not silently repaired. Existing read behavior remains unchanged; no stored contract was rewritten by this audit.

### Independent reviews and retained evidence

Both independent Standards and Spec reviewers passed candidate v3: SHA256 `03DBE6C2680F647C10E2EE879D91AF04817037A9A902FE752B2F40012C9FC643`, retained locally at `.scratch/release-remaining-qa/candidate-v3.patch`. It contains 21 scoped files against the base above. Reviewers independently re-ran the remaining-recovery regressions and confirmed that the opaque historical-row exemption cannot expose new inventory. Diagnostic scripts, raw local IDs, screenshots and PDFs are not part of the committed application patch.

After the PDF defects were fixed, both reviewers independently passed v6, SHA256 `086CECE514E8FB2D7513C5FF6EC904EA87650DFB3730F3947EBB6A393672AC99`, retained at `.scratch/release-remaining-qa/candidate-v6.patch`. It covers 27 scoped files against `58232f89b96f3877aabab4a6e0f3fca37c7891e8`. The final extra regression proves canonical already-paid material stays zero even without its redundant legacy marker and with contradictory copied legacy prices; the old print code failed with 999/999 and the corrected output is 0/0.

The separately reviewed Partner package/dependency update `678359aa8ade8abc0e69e44dc4c5285936b3942d` was integrated without conflicts in merge `4e4dbd9786c081dd4b49b9271596bccb2cc0288d`. Its 24 package tests, package and whole-frontend typechecks, backend build, seven harness unit tests, three foundation tests and inventory freshness check passed locally. No uncommitted Partner application lane was included. The user's shared main checkout/index was not altered.

### Browser acceptance execution

The selected broad matrix contains 39 cases: 12 CRM/inventory convergence, five financial-review, 18 platform reference-surface, two dashboard-shell, one remaining-chain failure/recovery, and one real remaining-chain create/edit/PDF case. The initial run completed 27 unique cases before a coordinated runtime handoff; all remaining 11 non-persistence cases then completed successfully (nine first-attempt passes and two successful retries), bringing the broad total to 38 before the final real-flow rerun.

The final 11-case run is retained at `.scratch/release-remaining-qa/browser-final-rest`. Its two first-attempt timing failures were a 15-second login navigation timeout before the Accounting route and a 120-second multi-route Guard navigation timeout. Neither required an application change, disabled assertion or increased test timeout; both passed the existing retry. Earlier cold-route compilation also caused an Accounting loop timeout, and an earlier real-flow run needed a login retry. These remain local development-runtime timing limitations, not evidence of a timing-flake-free suite.

The final real-flow rerun passed on its first attempt in 52.7 seconds, completing all 39 selected cases. Command: `node scripts/run-design-system-e2e.mjs remaining-recovery-real.spec.ts --output=.scratch/release-remaining-qa/browser-real-final`. It verified actual HTTP 201 creation, reload, both PDF downloads, HTTP 200 authorized no-change edit, and the accounting view. All five row identities, 23,071,875 toman total, allocations 5/5/1 and final inventory remained unchanged; no console errors or HTTP 500 responses were observed. Desktop 1440px and mobile 390px screenshots in both themes, the edit/accounting screenshots, all three original-PDF pages and both summary-PDF pages were visually inspected. Source areas are 0.75/0.375/0.325 square meters with zero child material charge. Headers, RTL tables, page flow and totals were readable. Raw historical description text, including existing decimal artifacts, was preserved rather than silently rewritten.

Artifacts are retained locally under `.scratch/release-remaining-qa/browser-real-final/remaining-recovery-real-re-5d039-ut-money-or-inventory-drift-desktop-chromium/`; final PDF page renders are `.scratch/release-remaining-qa/final-original-*.png` and `final-summary-*.png`. These diagnostic artifacts are excluded from publication.

### Final integrated runtime and CI gate

The final backend was built from the integrated application candidate at `4e4dbd9786c081dd4b49b9271596bccb2cc0288d`; later changes are CI/docs only. Its running image identity is `sha256:b496f2a20ac3bb2940dda44b150ea87063db3131db9a3073a1765aad4edb2de5`, with manifest `sha256:28aadb179ffbd8a5c567f53c2e972ada436639ae152c5f613cfc9179b27247ba`. Container and host backend builds, backend lint, whole-frontend typecheck and the integrated production frontend build passed. Final read-only checks confirmed all five Compose services healthy, backend and frontend-proxy database health `OK`, and Inquiry HTTP 200. The exact fixture audit returned empty customer, product and contract lists. The original local database/storage selection was retained throughout; no alternate stack was created.

The earlier full `docker:verify` passed. A final invocation was cancelled after discovering that this command rebuilds/promotes services rather than only checking health; it is not counted as a final successful gate. No frontend or Inquiry container was recreated by that invocation. The final read-only checks above establish runtime health independently. The frontend runtime was explicitly returned to the coordinated Partner UI owner after browser testing, artifact retention and the cleanup audit.

The final candidate also includes the independently reviewed, two-file CI setup correction from `5e8d036d5386daa9bac23163c12398234ea129b8`, cherry-picked as `3e368139005e95df7571ab5e5149970bc1d41386`: both Partner workflow checkouts initialize the pinned public Inquiry submodule and disable persisted credentials; path filters include the gitlink and `.gitmodules`. No runner, inventory, application or schema behavior changed. Hosted run `33055122225` failed at the unit step, but its log download timed out; the exact clean `678359aa` locally reproduced the missing-submodule ENOENT. Initializing the pinned gitlink made unit7 and inventory freshness pass without removing inventory entries. Hosted success must be verified after publication, not inferred from local checks.

### Late upstream schema integration

The publication fetch discovered that another task had published `7bd2821179f2da97474c040e5c589b8c46ce274f` (#315) after the agreed `678359aa` baseline. It adds 13 schema/migration/audit/test files, including eight Partner migrations, and was preserved by the conflict-free merge `a1ed943095ace31c583a524aa03aa3bcb9a694d4`. The remaining-stone/CI patch stayed byte-identical across that merge: SHA256 `B36081F32F8545D6046B0286784D58203808F17E4A2C19C50286AF93C29C9854`, approved independently by Standards and Spec before this report addendum. No upstream schema file was edited by this task.

A fresh read-only audit found 181 applied migrations and confirmed all eight Partner SQL checksums against the integrated Git files, zero Partner rows, zero pair violations, zero disabled Partner triggers and closed activation. The #315 owner had already applied those migrations to the existing local database; this task performed no migration. The running backend image still contained the older 173-migration schema/client, so it is not represented as a newly rebuilt #315 runtime. Instead, the isolated worktree's Prisma client was regenerated from the integrated schema, the complete backend build passed, and the actual remaining-recovery create/edit/failed-save/read-only/signed-authorization transaction suite passed again against the 181-migration database and rolled back its fixtures. All six print suites and recovery-guidance tests passed again. This explicitly separates the earlier visual runtime evidence from the new-client integration evidence.

After the frontend runtime handoff, the separate unpublished Partner UI lane reported a development-only module-loader failure. That lane and its fix are outside this 29-file candidate and its tested routes; the coordinator owns its separate acceptance. No success is claimed for unpublished Partner UI routes or for every possible platform action.

The upstream #315 Backend architecture run `33055625370` also failed at the backend build. Unlike the inaccessible zipped logs, its hosted check annotations were accessible and explicitly reported missing `@sabalanerp/partner-sales-contracts` and `/testing` type declarations. The workflow built the graph package but omitted the new public package. The publication candidate now includes a narrow thirtieth file: build/install the public package before installing/building backend, and watch that package in PR path filters. All existing lint, architecture, deployment/recovery/notification tests and configuration checks remain enabled. This is build-order wiring, not an application behavior change.

Scoped inventory (no production frontend component, database schema, or deployment change; PDF normalization and cache identity are included):

```text
.github/workflows/backend-architecture-guardrails.yml
.github/workflows/partner-sales.yml
CONTEXT.md
backend/package.json
backend/src/routes/sales.ts
backend/src/services/contractProductGraphMigration.ts
backend/src/services/contractService.ts
backend/src/services/remainingRecoveryGuidance.ts
backend/src/services/__tests__/remainingRecoveryGuidance.test.ts
backend/src/services/__tests__/remainingRecoveryWrite.integration.test.ts
backend/src/utils/__tests__/printTemplateRemainingRecovery.test.ts
backend/src/utils/printTemplate.ts
backend/src/utils/salesContractPdf.ts
docs/adr/0054-recover-remaining-allocations-only-at-authorized-writes.md
docs/qa/partner-sales/README.md
docs/qa/remaining-child-recovery.md
frontend/src/features/contract-creation/services/__tests__/contractSubmissionFailure.test.ts
packages/contract-product-graph/package.json
packages/contract-product-graph/src/legacyReadAdapter.ts
packages/contract-product-graph/src/legacyRemainingRecovery.ts
packages/contract-product-graph/src/preservedSourcePacking.ts
packages/contract-product-graph/src/remainderPolicy.ts
packages/contract-product-graph/src/index.ts
packages/contract-product-graph/src/projections.ts
packages/contract-product-graph/src/__tests__/projections.test.ts
packages/contract-product-graph/src/__tests__/remainingChildRecovery.test.ts
packages/contract-product-graph/src/__tests__/fixtures/remaining-child-chain.json
tests/design-system-e2e/financial-evidence-review.spec.ts
tests/design-system-e2e/remaining-recovery-real.spec.ts
tests/design-system-e2e/remaining-recovery.spec.ts
```

### Limits

This is risk-based release evidence, not a guarantee that every platform action is defect-free. The exact five-row UI scenario enters through recovered-draft hydration; generic wizard/product-selection interactions are covered separately. UI persistence uses a local admin fixture; correction authorization is covered by backend tests, not a production sales account. Unsupported or ambiguous legacy physical layouts deliberately remain blocked. Completely erased historical evidence cannot be reconstructed from absent data. Real third-party effects, production deployment and automatic rewriting of finalized contracts are excluded.
