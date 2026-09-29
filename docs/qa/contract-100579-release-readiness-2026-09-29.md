# Contract 100579 release readiness — 2026-09-29

## Diagnosis

Production runs immutable release `196f4de6`, while its source checkout and GitHub main are `6a7a7926`. Production's financial preflight reproducibly fails for invoice candidate `cmum7nk1c0forwgd2dei01538`: the frozen longitudinal row has no `meta.isLayer` flag. The source is an unapproved financial draft; its frozen graph is schema 1, revision 4, rounding-v2, with no layer configurations. Its matching `canonical-wizard-save` audit has writer version 1 and identical input/result hashes.

The save defect was in the edit path, which did not reuse the creation-path classification normalizer. The old financial adapter's compatibility reconstruction only covered rounding-v1. Main already contains the core fix in PRs #401/#402: normalize current edits and recover missing classification from the matching audited graph without rewriting historical commercial facts. This task synchronized the biometric configuration branch with that main revision, then tested the actual Prisma adapter and approval preflight with an anonymized reproduction of production's optimizer-derived longitudinal row, active discount and invoice snapshot.

## Additional changes

- Recognize `meta.layerSourcePlan` as conflicting layer evidence in both current-save normalization and historical audited recovery. A new negative preflight regression fails before this guard and passes afterward.
- Record `AUDITED_FROZEN_DISCOUNT_ELIGIBILITY` as the recovery method in financial reconciliation reports.
- Add full adapter-to-approval preflight coverage and a real create/edit integration test with transaction rollback in the existing `sabalanerp-local` database.
- Retain the original snapshot, graph, discount and contract amount; no financial evidence is invented and no deployment gate is relaxed.

## Verification

- `test:approved-pricing`: 75 existing pricing tests and 7 new adapter preflight tests pass; the financial-approval transaction-policy test passes.
- `test:contract-edit-discount:db`: passes against the existing local Compose PostgreSQL, with create/edit/graph persistence exercised and no test contract left behind after rollback. Contract total and discount are unchanged.
- `test:deployment-control`: full suite passes after merging main, including the 11 configuration release tests and updated build-capacity checks.
- `architecture:check` and `git diff --check`: pass.
- Backend TypeScript validation passes with a separately generated client matching this branch's schema and separately built workspace packages. No database migration is performed by generation.

## Production read-only proof

The candidate evidence adapter, discount interpreter and reconciliation script were compiled into a temporary probe and loaded into a separate short-lived Node process. No running application process or container filesystem was replaced. The target check uses `SET TRANSACTION READ ONLY`; the full check forces `default_transaction_read_only=on`. No `--apply`, referral mutation or deployment was run.

Target result: `PASS`; the source financial record's before/after hash is identical. Its sealed monetary witnesses are:

| Witness | Toman |
| --- | ---: |
| Gross | 26,250,000 |
| Discount | 250,000 |
| Payable | 26,000,000 |

The ordinary longitudinal row is discount-eligible, and its independently reconciled contractual length is `87.500` meters. Recovery is linked to `wizard-save:cmul9jcxf0gnenp46ogkgrz9h:4:cpg-fnv1a64-49a5718797405ef4` under rule `AUDITED_CANONICAL_GRAPH_DISCOUNT_ELIGIBILITY_V1`.

Full financial release preflight: `READ_ONLY`, **12 checked, 0 unresolved**. Contract 100579 is `RECONCILED` with both audited eligibility and versioned commercial-precision recovery; candidate integrity hash `7b934a7a9475417df9ed5842383449ab7df4046469976516946a33ec23bb8949`.

## Deployment boundary

The old production application and the open financial review case have not been mutated by these probes. This prepares a later normal immutable-image release. During that release, the canonical verified-checkpoint reconciliation must recheck every candidate inside its apply transaction before resolving review cases. The old-image configuration-only release cannot acquire this code fix; upgrade the application first, then complete scanner registration and its signed health round trip through the existing safe release path.
