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

All runtime tests use the existing `sabalanerp-local` project and its local PostgreSQL on port 55432. No production connection, business correction, bulk historical rewrite, external message, or deployment is performed. The schema has 173 applied migrations. Real UI tests use namespaced QA customer/project/catalog fixtures; service integration tests roll back their own transaction. The frontend runtime is the repository's local development target; the separate production frontend build also passes.

### Additional regressions caught before publication

1. Canonical paid-remainder stair layers were incorrectly interpreted as legacy partition usage. Layer-only replay now retains its canonical owner; mixed layer/partition chronology remains blocked when ambiguous.
2. Missing or contradictory generated-child identities could under-report descendants in recovery guidance. The complete physical lineage must now resolve before proposing any reconstruction order; otherwise support is required without deletion.
3. Earlier canonical source-policy errors now receive chain-aware guidance too, rather than losing source/dependent context.
4. Independent source-only rows no longer require paid-child price reconciliation or stable UI-cache IDs when canonical geometry/quantity proves unchanged inventory.
5. Independent historical rows with no canonical source stock/base price, no children and no usage ledger remain opaque snapshots. The recovery bridge neither invents stock nor demands evidence for nonexistent children. The regression test failed before the narrow exemption and passes afterward; the canonical missing-children/consumed-inventory rejection remains covered.
6. One pre-existing Accounting E2E mock omitted the API's required visible/enabled `nextBestActions` entry. Only the fixture was corrected; application behavior and permissions were not changed.

### Read-only historical comparison

The local audit scanned 260 stored contracts (including two interrupted local QA fixtures awaiting cleanup): 308 longitudinal, 193 stair, 6 prepared, 1 slab and 51 untyped product rows. It compared the same stored policy/input with recovery disabled/enabled without writing any contract.

- 209 inputs passed the old migration-plan path; 204 pass the stricter write-recovery path.
- 28 unrelated historical contracts initially regressed and pass after the independent-row exemption.
- Five remain newly blocked: three have actual remaining-child consumption but no provable paid-source policy; two lack stable physical lineage identities. This is a raw-input migration comparison, not an assertion that every historical contract is editable through every permission/state path.
- 51 inputs already fail the old plan and were not silently repaired. Existing read behavior remains unchanged; no stored contract was rewritten by this audit.

### Independent reviews and retained evidence

Both independent Standards and Spec reviewers passed candidate v3: SHA256 `03DBE6C2680F647C10E2EE879D91AF04817037A9A902FE752B2F40012C9FC643`, retained locally at `.scratch/release-remaining-qa/candidate-v3.patch`. It contains 21 scoped files against the base above. Reviewers independently re-ran the remaining-recovery regressions and confirmed that the opaque historical-row exemption cannot expose new inventory. Diagnostic scripts, raw local IDs, screenshots and PDFs are not part of the committed application patch.

### Limits

This is risk-based release evidence, not a guarantee that every platform action is defect-free. The exact five-row UI scenario enters through recovered-draft hydration; generic wizard/product-selection interactions are covered separately. UI persistence uses a local admin fixture; correction authorization is covered by backend tests, not a production sales account. Unsupported or ambiguous legacy physical layouts deliberately remain blocked. Completely erased historical evidence cannot be reconstructed from absent data. Real third-party effects, production deployment and automatic rewriting of finalized contracts are excluded.
