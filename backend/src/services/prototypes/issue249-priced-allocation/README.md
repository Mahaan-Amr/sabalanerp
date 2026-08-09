# PROTOTYPE — priced allocation staleness boundary

This throwaway prototype asks whether the proposed state model correctly freezes one
immutable financially approved pricing version with a finalized Logistics allocation,
fails Accounting acceptance when the current approved version changes or either hash
fails, and transfers the existing reservation to a successor allocation without a
release/re-reserve gap.

Run it from the repository root:

```powershell
npm --prefix backend exec -- tsx src/services/prototypes/issue249-priced-allocation/tui.ts
```

The proposed persistence seam represented by the prototype is:

- `ContractApprovedPricingVersion`: immutable header keyed by `id`, with
  `contractId`, monotonic `versionNumber`, `sourceFinancialRecordId`, approval actor
  and time, `schemaVersion`, currency, totals, ordered immutable row evidence, and a
  canonical SHA-256 root hash.
- `ContractApprovedPricingHead`: one lockable row per contract whose
  `currentVersionId` identifies the current approved version. A replacement approval
  inserts a version and advances this pointer; it never edits an old version.
- `LogisticsAllocationRevisionPricing`: one row per contract in an allocation,
  referencing the exact immutable version and recording its expected root hash. The
  allocation root hash covers these references alongside its operational lines.
- `AccountingDispatchCandidate`: gains the system terminal disposition
  `STALE_REQUIRES_SUCCESSOR`, distinct from a human Accounting rejection.

Finalization runs serializably and locks affected contract rows, authoritative
shipment-quantity evidence, and pricing heads in stable ID order. Acceptance locks the
candidate, revision, and the same pricing heads; it verifies allocation and version
hashes, then requires both current version identity and hash to equal the frozen
reference before atomically issuing the numbered document bundle. Successor
finalization locks the predecessor and all affected row/head locks, records a release
for the predecessor and an equal reservation for the successor in the same
transaction, and links both immutable revisions.

The prototype intentionally does not decide monetary allocation formulas, PDF shape,
artifact storage, or legacy repair; those belong to the map's other decision tickets.
