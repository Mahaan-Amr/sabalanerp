# Rate-free product calculations — issues 320 / 330 / 334

This is an additive canonical calculation slice, not Case submission, inquiry-ready
save, authenticated catalog disclosure, frontend acceptance, or runtime activation.
It follows the approved technical-preview seam and review baseline `1c93b47f`.

## Public graph exports

Import only from `@sabalanerp/contract-product-graph`:

- `calculateLongitudinalTechnical`: piece-count and blank/zero total-meter intent,
  manual area authority, mother width, kerf, calibration, consumed source area and
  packing/remainders. Mandatory percentages and all prices remain private.
- `calculateSlabTechnical`: manual source identity/capacity, finished geometry,
  packing, consumed material area and vertical cut length. No pricing-method input.
- `calculateStairPartTechnical`: tread/riser/landing identity, explicit or derived
  mother length, source capacity, kerf/calibration and residual area.
- `calculateStairLayerTechnical` / `replayStairLayerTechnical`: physical side strips,
  catalog quantity, paid/new source split, generated remainder ownership, operations
  bound to the parent's actual strip geometry, and ordered source consumption.
- `replayRemainderTechnical`: explicit parent/catalog/source binding, ordered
  allocation, witnessed source distributions, residual ownership and capacity.
  Existing `canDeleteRemainderSource` accepts these rate-free child intents.
- `calculatePreparedTechnical`: explicit cubic/ready-piece unit and quantity;
  historical `volumetric` identity is retained. No invented dimensions or prices.

Each has inferred/exported input and result types. `inputRevision` is a nonnegative
safe integer for preview correlation, **not** an authoritative recovery revision.
Layer operation previews and layer replay inputs must match the enclosing revision.
`TechnicalPackingPlan` excludes private policy identifiers and input/result hashes.
The internal packing algorithm version remains `packing-v1`; priced callers retain
their actual recorded versions. No fake monetary input is used.

## Failure and compatibility boundaries

Public inputs reject unknown fields, including nested monetary extensions, and
malformed decimals/choices. Unknown keys/values are not copied into boundary errors.
Incomplete geometry returns conflicts without changing the supplied draft. Layer
operation failures retain geometric facts and valid sibling operation results.
Remainder replay preserves valid sibling allocations in an explicitly failed preview;
layer replay returns the prior valid configurations when a later dependency fails.
**A partial result never authorizes persistence or issues a configuration reference.**

Priced calculations use the same extracted geometry/replay implementations. Valid
priced results, pricing lines, source consumption and hashes must remain identical.
For invalid inputs with simultaneous technical and financial conflicts, diagnostic
precedence may change: geometry is resolved before monetary validation. Layer-side
validation now accumulates conflicts instead of hiding later valid sibling facts.
All such results remain failures; no invalid row becomes saveable.

## Verification

New public-seam tests were introduced red before implementation, then green. The
technical suites cover all families, strict boundaries, incomplete checkpoints,
manual/calibration intent, partial sibling facts, ordered layer capacity and preserved
remainder distribution. Run:

```
npm --prefix packages/contract-product-graph run typecheck
npm --prefix packages/contract-product-graph test
npm --prefix packages/contract-product-graph run test:remaining-recovery
```

A read-only differential check against the published remaining-stone graph compared
complete valid priced results **including hashes** in 62 cases: longitudinal 24,
stair parts 12, slab 8, layer source/unit combinations 12, remainder distribution 6.
All were identical. This does not replace combined UI, DB, recovery and document QA.

The next boundary is a strict safe catalog/technical editing contract and durable
checkpoint/validated save on the existing creator-private recovery lifecycle. UI 330,
real producer composition 334 and combined acceptance 335 remain separate gates.
