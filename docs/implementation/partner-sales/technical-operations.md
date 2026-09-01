# Rate-free operations: first technical-core increment

Scope: issues 320, 330 and 334; review base
`1c93b47f4b136e0a732884767958a8280a5a4868`. The user approved the public
technical calculation/projection and existing-recovery-backed save test seams.
This increment implements **only the operations calculation seam**, not the
remaining product families, Partner transport or recovery writer.

## Public interface

Import `calculateProductOperationsTechnical`, `ProductOperationsTechnicalInput`
and its result types from `@sabalanerp/contract-product-graph`. Existing public
`refreshProductOperationsGeometry`, `convertOperationGroupBasis` and
`splitOperationGroup` also support technical drafts; geometry and grouping logic
are not copied into a Partner UI.

- Inputs preserve stable row/group/selection IDs, geometry, piece-count or
  linear-meter scope, catalog references, tool edges, finishing compatibility,
  and quantity overrides. No monetary rates, amounts, pricing policy or hashes.
- The runtime input shape rejects unknown fields at every structured level.
  The caller supplies already-authorized safe catalog facts; this pure calculator
  cannot authorize catalog access or attest that caller-supplied facts are true.
- `inputRevision` correlates previews with the caller's edit revision. It is
  echoed in successful results and valid-revision failures; it is **not** a saved
  recovery revision, configuration reference, authorization or inquiry approval.
- Valid results contain automatic/final quantities, override status, groups and
  workshop facts. They contain no pricing fields or pricing hashes.
- `ok: false` may retain a partial `result`: a tool missing an edge does not hide
  a valid finishing's quantity. Such partial results are display-only and cannot
  authorize save or inquiry. Structural failures can have no partial result.
- Stale manual overrides require the existing explicit `keep` or
  `use-calculation` choice. Input objects are not mutated. Geometry refresh and
  split preserve correlation; the caller advances its edit revision for each edit.
- The generated no-operation group cannot collide with a supplied group ID.

`calculateProductOperations` now consumes this same technical calculation before
applying its mandatory monetary validation and canonical pricing. Missing or
negative rates still fail priced calculation. Valid monetary totals and hashes
are preserved; a regression pins the previously published complete result hash.
Technical conflicts now use stable selection IDs instead of array indices;
when both technical and rate evidence are invalid, technical conflicts take
precedence. Consumers must not rely on the old ordering of invalid-input errors.

## Verification

Run from the repository root:

```sh
npm --prefix packages/contract-product-graph run test:technical-operations
npm --prefix packages/contract-product-graph run typecheck
npm --prefix packages/contract-product-graph run build
npm --prefix packages/contract-product-graph test
npm --prefix packages/contract-product-graph run test:remaining-recovery
```

The new suite is registered in the full graph suite and Partner CI. Red-to-green
evidence covers missing public calculation, retained sibling facts, forbidden
private input, technical grouping types, identity collision and failed-preview
revision correlation. The unchanged published priced control for three 2m by
0.4m pieces has 6m tooling, 2.4m2 finishing, total 108000 Toman, input hash
`cpg-fnv1a64-a67ac91b6608eecc` and result hash `cpg-fnv1a64-b7d5f7a03b44f390`.

## Remaining gates — not delivered by this increment

1. Canonical rate-free longitudinal/slab/stair/layer/prepared/legacy and remainder
   behavior, including atomic source/child replay.
2. Strict Partner catalog/input/result wire contracts through shared owner 334
   and catalog owner 317; original Partner v1 and workspace v2 remain unchanged.
3. Existing recovery-owner checkpoint and validated save with revision/CAS,
   idempotency and current lease. Incomplete checkpoints must remain recoverable;
   only validated saves issue exact `PartnerConfigurationRef` and quantity/unit.
   Quantity/delivery-only changes do not independently invalidate inquiry approval.
4. Owner 330 binds canonical UI sections and proves all-family parity; then real
   producers/transport in 334, combined QA in 335 and release approval in 336.

No frontend route is enabled, no recovery protocol or database is changed, and
no production deployment, activation or real SMS is authorized by this work.
