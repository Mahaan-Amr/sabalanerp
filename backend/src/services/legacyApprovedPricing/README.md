# Legacy approved-pricing preflight and sealing

This module is a fail-closed compatibility boundary. It reads legacy contract and approved-invoice evidence,
classifies it, and hands only independently reviewed `READY` candidates to the approved-pricing writer. It never
updates contract items, snapshots, invoices, PDFs, allocation evidence, or prior pricing versions.

## Public seams

- `buildLegacyPricingCandidate` binds an approved snapshot only through exact persisted contract-item and
  `productRowId` identity. Position or catalog similarity is diagnostic evidence only.
- `classifyLegacyPricingCandidate` emits the five migration states and precise legacy reason codes. Missing or
  invalid decimals remain missing; they are never converted to zero.
- `buildLegacyPricingManifest` produces deterministic schema-versioned contract, approval-record, and row counts, source identity/evidence hashes,
  plus per-row stable identities, scale-three quantity, scale-twelve amount, and evidence hash for independent replay. It also retains aggregate
  totals, known subtotals, and quarantine entries. It contains no
  customer names, addresses, prices by customer, or full source snapshots.
- `runLegacyPricingSeal` consumes a `LegacyPricingSealWriter`. Its idempotency key is derived from contract,
  approval, and exact source-evidence hash; interrupted runs replay completed seals and resume remaining candidates.
  A post-run recapture must match all source counts, hashes, and totals.

`componentEvidence.discountBasis` is mandatory. A discount-eligible row requires an explicit, scale-twelve,
nonnegative basis. A noneligible row requires an explicit zero basis. The key is reconciliation evidence and is not
added to the all-in component total.

## Commands

Set `DATABASE_URL` to the deployment dataset and choose an output path explicitly:

```powershell
$env:LEGACY_PRICING_MANIFEST_PATH = 'C:\migration-evidence\legacy-pricing-preflight.json'
npm run preflight:legacy-approved-pricing
```

Optional reviews are supplied with `LEGACY_PRICING_REVIEWS_PATH`. The JSON file is an array of:

```json
{
  "contractId": "internal-contract-id",
  "sourceFinancialRecordId": "internal-approved-leaf-id",
  "reviewedBy": "reviewer-id",
  "reviewedAt": "2026-08-09T10:00:00.000Z",
  "sourceEvidenceHash": "64-character-preflight-hash",
  "decision": "APPROVE_SEAL",
  "reason": "Independent evidence reconciliation reference"
}
```

The review authorizes only the exact hash. A changed hash is `EVIDENCE_CONFLICT`, not an editable review. Apply uses
the Issue 259 `PrismaApprovedPricingRepository`; it does not implement a second persistence path:

```powershell
$env:LEGACY_PRICING_MANIFEST_PATH = 'C:\migration-evidence\legacy-pricing-apply.json'
$env:LEGACY_PRICING_REVIEWS_PATH = 'C:\migration-evidence\legacy-pricing-reviews.json'
npm run seal:legacy-approved-pricing
```

The apply manifest retains both pre/post manifests, their comparison, every `SEALED`/`REPLAYED` result, aggregate
outcomes, and an explicit failure reason. A source mismatch makes the run `FAILED` without deleting derived rows.
Sealing reloads and hashes the complete financial envelope under the contract lock, then persists only that refreshed
candidate. Contract/version and row amounts stay in the contract pricing unit (Toman for the production path); Rial
invoice totals are reconciled only at the invoice boundary with the explicit ten-to-one factor.

## Repair boundary

- `LEGACY_REVIEW_REQUIRED`: verify the unchanged evidence and record a hash-bound review.
- `REPAIR_REQUIRED`: correct the owning Sales or Accounting source and create a successor valid approval.
- `EVIDENCE_CONFLICT`: resolve contradictory identity, amount, relationship, or hash evidence at its source.
- `STALE`: create successor approved evidence and a successor allocation. Never refresh an immutable binding.

Rerunning dry-run against unchanged sources produces byte-identical output. Before apply, require a recoverable
backup and successful restore rehearsal in `sabalanerp-local`; rollback before cutover disables the feature gate and
does not delete newly derived evidence.
