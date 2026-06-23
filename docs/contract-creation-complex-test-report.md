# Contract Creation Complex Test Report

This report explains the contract-creation tests added for the difficult business cases: smart calculations, smart cutting, remaining stones, services, finishing, stair layers, delivery, payment, editing, and validation.

Run them from `frontend`:

```bash
npm run test:contract-creation
```

Current output:

```text
smartLongitudinalCutPlan tests passed
remainingStonePartitionService tests passed
contractControllerHelpers tests passed
contractCreationComplexScenarios tests passed
```

## What Is Automated

The automated suite focuses on calculation and validation behavior. It does not click through the browser UI. It checks the public services that the UI relies on, so the numbers below are the expected calculation outputs you can manually compare with the platform.

Main file:

`frontend/src/features/contract-creation/services/__tests__/contractCreationComplexScenarios.test.ts`

## Scenario 1: Smart Square-Meter Back-Calculation

Purpose: verify that if the user enters square meters and width, the system calculates the missing length.

Input:

| Field | Value |
|---|---:|
| Square meters | `3.6` |
| Width | `20 cm` |
| Quantity | `1` |

Expected output:

| Output | Value |
|---|---:|
| Length | `18 m` |
| Width | `20 cm` |
| Square meters | `3.6 m²` |

Manual formula:

`length = 3.6 / 0.20 = 18 m`

## Scenario 2: Real Smart Cut Case, 40 cm Source to 20 cm Demand

Purpose: lock the real contract case you reported.

Input:

| Field | Value |
|---|---:|
| Source width | `40 cm` |
| Requested width | `20 cm` |
| Requested length | `18 m` |
| Quantity | `1` |
| Stone price | `1,050,000 تومان / m²` |
| Longitudinal cut price | `40,000 تومان / m` |

Expected output:

| Output | Value |
|---|---:|
| Customer-facing demand | `18 m × 20 cm` |
| Physical production plan | `2 × 9 m × 20 cm` |
| Source length consumed | `9 m` |
| Requested area | `3.6 m²` |
| Source area charged | `3.6 m²` |
| Remaining stones | `0` |
| Cutting meters | `9 m` |
| Cutting cost | `360,000 تومان` |
| Base stone price | `3,780,000 تومان` |
| Total with cutting | `4,140,000 تومان` |

Manual formulas:

`source length = 18 / 2 = 9 m`

`area = 9 × 0.40 = 3.6 m²`

`stone price = 3.6 × 1,050,000 = 3,780,000`

`cutting = 9 × 40,000 = 360,000`

`total = 3,780,000 + 360,000 = 4,140,000`

## Scenario 3: Full Width Longitudinal Product

Purpose: verify that a product using the full source width does not create a cut or remaining stone.

Input:

| Field | Value |
|---|---:|
| Source width | `40 cm` |
| Requested width | `40 cm` |
| Requested length | `18 m` |

Expected output:

| Output | Value |
|---|---:|
| Requested area | `7.2 m²` |
| Smart cutting enabled | `false` |
| Remaining stones | `0` |
| Cutting cost | `0` |

Manual formula:

`18 × 0.40 = 7.2 m²`

## Scenario 4: Smart Cut with Remaining Stone

Purpose: verify that smart cutting can split the demanded length and still produce a real remaining strip.

Input:

| Field | Value |
|---|---:|
| Source width | `40 cm` |
| Requested width | `15 cm` |
| Requested length | `18 m` |
| Quantity | `1` |

Expected output:

| Output | Value |
|---|---:|
| Physical production plan | `2 × 9 m × 15 cm` |
| Source area charged | `3.6 m²` |
| Requested area | `2.7 m²` |
| Remaining stone | `9 m × 10 cm` |
| Remaining area | `0.9 m²` |

Manual formulas:

`source length = 18 / 2 = 9 m`

`used width = 15 + 15 = 30 cm`

`remaining width = 40 - 30 = 10 cm`

`remaining area = 9 × 0.10 = 0.9 m²`

## Scenario 5: Saw Kerf in Smart Cut

Purpose: verify that saw kerf affects consumed width and remaining geometry without changing the requested customer dimensions.

Input:

| Field | Value |
|---|---:|
| Source width | `40 cm` |
| Requested width | `13 cm` |
| Requested length | `2 m` |
| Quantity | `2` |
| Saw kerf | `0.3 cm` |

Expected output:

| Output | Value |
|---|---:|
| Customer requested width | `13 cm` |
| Consumed width per strip | `13.3 cm` |
| Strips per source | `2` |
| Source length consumed | `2 m` |
| Remaining width | `13.4 cm` |
| Remaining length | `2 m` |

Manual formula:

`remaining width = 40 - (13.3 × 2) = 13.4 cm`

## Scenario 6: Invalid Cut Dimensions

Purpose: verify that impossible requested dimensions are rejected.

Expected output:

| Input | Expected |
|---|---|
| `41 cm` width from `40 cm` source | Invalid |
| `19 m` length from `18 m` source | Invalid |
| `20 cm × 18 m` from `40 cm × 18 m` source | Valid |

## Scenario 7: Remaining Stone Partition That Can Be Split

Purpose: verify that a long logical demand can be physically split across the same remaining stone when geometry really fits.

Input:

| Field | Value |
|---|---:|
| Remaining stone | `9 cm × 2 m` |
| Requested partition | `3 cm × 6 m` |

Expected output:

| Output | Value |
|---|---:|
| Validation errors | `0` |
| Consumed source pieces | `1` |
| Physical pieces | `3` |
| Each physical piece | `3 cm × 2 m` |
| Remaining area | `0 m²` |

Manual check:

Three strips of `3 cm` fit side by side inside `9 cm`, and each uses the full `2 m` length.

## Scenario 8: Remaining Stone Partition That Does Not Fit

Purpose: verify that matching area alone is not enough; geometry must fit.

Input:

| Field | Value |
|---|---:|
| Remaining stone | `9 cm × 2 m` |
| Requested partitions | `2 × (5 cm × 2 m)` |

Expected output:

| Output | Value |
|---|---:|
| Validation errors | `1` |
| Result | Rejected |

Manual check:

Two `5 cm` strips need `10 cm` total width, but only `9 cm` exists.

## Scenario 9: Complex Slab with Multiple Standard Dimensions

Purpose: verify slab pricing, line-based cutting, and remaining pieces across multiple source slabs.

Requested product:

| Field | Value |
|---|---:|
| Requested size | `200 cm × 120 cm` |
| Requested quantity | `3` |
| Price | `1,000,000 تومان / m²` |
| Longitudinal cut | `100,000 تومان / m` |
| Cross cut | `50,000 تومان / m` |

Source slabs:

| Source | Size | Quantity |
|---|---:|---:|
| A | `300 cm × 160 cm` | `1` |
| B | `280 cm × 140 cm` | `2` |

Expected output:

| Output | Value |
|---|---:|
| Requested customer area | `7.2 m²` |
| Charged source area | `12.64 m²` |
| Base stone price | `12,640,000 تومان` |
| Total line-based cutting cost | `780,000 تومان` |
| Remaining pieces count | `6` |
| Total remaining area | `5.44 m²` |

Manual formulas:

Requested area:

`2.00 × 1.20 × 3 = 7.2 m²`

Charged source area:

`3.00 × 1.60 × 1 = 4.8 m²`

`2.80 × 1.40 × 2 = 7.84 m²`

`4.8 + 7.84 = 12.64 m²`

Cutting:

Longitudinal: `2 m × 100,000 × 3 = 600,000`

Cross: `1.2 m × 50,000 × 3 = 180,000`

Total: `780,000`

## Scenario 10: Single Slab Cut

Purpose: verify the simpler one-source slab cut.

Input:

| Field | Value |
|---|---:|
| Source slab | `300 cm × 160 cm` |
| Requested piece | `200 cm × 120 cm` |
| Longitudinal cut | `100,000 تومان / m` |
| Cross cut | `50,000 تومان / m` |

Expected output:

| Output | Value |
|---|---:|
| Remaining pieces | `3` |
| Total cutting cost | `260,000 تومان` |

Manual formulas:

Longitudinal: `2 m × 100,000 = 200,000`

Cross: `1.2 m × 50,000 = 60,000`

Total: `260,000`

## Scenario 11: Finishing by Meter and Square Meter

Purpose: verify that stone finishing can be calculated by either meter length or square meters.

Input product:

| Field | Value |
|---|---:|
| Length | `18 m` |
| Area | `3.6 m²` |

Expected output:

| Finishing type | Quantity | Rate | Cost |
|---|---:|---:|---:|
| Meter-based | `18 m` | `80,000` | `1,440,000` |
| Square-meter-based | `3.6 m²` | `150,000` | `540,000` |

## Scenario 12: Standalone Service Rows and Editing

Purpose: verify independent service rows for tools and finishing, including editing.

Expected output:

| Row | Quantity | Unit price | Total |
|---|---:|---:|---:|
| Tool row | `24 m` | `45,000` | `1,080,000` |
| Edited tool row | `30 m` | `50,000` | `1,500,000` |
| Finishing row | `3.6 m²` | `150,000` | `540,000` |

Important behavior:

Editing the tool row preserves its catalog source and identity fields while changing quantity, unit price, and total.

## Scenario 13: Stair Tread with Tools and Cutting

Purpose: verify a difficult stair part with source-width pricing, edge tools, and cutting.

Input:

| Field | Value |
|---|---:|
| Source stone width | `40 cm` |
| Requested tread width | `20 cm` |
| Length per tread | `1.2 m` |
| Quantity | `10` |
| Price | `1,000,000 تومان / m²` |
| Tool edges | front + left + right |
| Tool price | `100,000 تومان / m` |
| Longitudinal cut price | `50,000 تومان / m` |

Expected output:

| Output | Value |
|---|---:|
| Display area | `2.4 m²` |
| Pricing area | `2.4 m²` |
| Pieces per source stone | `2` |
| Source stones charged | `5` |
| Tool meters | `26 m` |
| Tool cost | `2,600,000 تومان` |
| Cutting cost | `300,000 تومان` |
| Part total | `5,300,000 تومان` |

Manual formulas:

Area: `1.2 × 0.20 × 10 = 2.4 m²`

Tool meters per tread: `front 0.20 + left 1.20 + right 1.20 = 2.6 m`

Tool total: `2.6 × 10 × 100,000 = 2,600,000`

Cutting: `1.2 × 5 source stones × 50,000 = 300,000`

Stone: `2.4 × 1,000,000 = 2,400,000`

Total: `2,400,000 + 2,600,000 + 300,000 = 5,300,000`

## Scenario 14: Stair Layers from Remaining and New Stone

Purpose: verify mixed layer sourcing.

Input:

| Field | Value |
|---|---:|
| Total layers needed | `5` |
| Layer width | `10 cm` |
| Layer length | `2 m` |
| Available remaining stones | `2 × (10 cm × 2 m)` |

Expected output:

| Output | Value |
|---|---:|
| Layers from remaining | `2` |
| Layers from new stone | `3` |
| Square meters from remaining | `0.4 m²` |
| Square meters from new stone | `0.6 m²` |

Manual formulas:

Each layer: `2 × 0.10 = 0.2 m²`

Remaining: `2 × 0.2 = 0.4 m²`

New: `3 × 0.2 = 0.6 m²`

## Scenario 15: Editing Product Geometry with Existing Remaining Usage

Purpose: verify that editing a product replaces newly available remaining stones but preserves already-used remaining stones for review.

Expected output:

| Check | Expected |
|---|---|
| Same geometry | Not changed |
| Width changed from `20 cm` to `15 cm` | Changed |
| New available remaining | Replaces old available remaining |
| Already used remaining | Preserved |
| Warning | Present |

## Scenario 16: Delivery Units and Targets

Purpose: verify that each row schedules in the right unit.

Expected output:

| Row type | Delivery unit | Target amount |
|---|---|---:|
| Longitudinal stone | meter | `18` |
| Prepared product sold by ton | ton | `2.5` |
| Standalone service | its row unit | `24` |

## Scenario 17: Full Wizard Validation with Product + Service

Purpose: verify that a complete contract can pass product, delivery, payment, and signature validation.

Rows:

| Row | Total |
|---|---:|
| Smart-cut longitudinal product | `4,140,000` |
| Tool service row | `1,080,000` |
| Contract total | `5,220,000` |

Delivery plan:

| Delivery | Product amount | Service amount |
|---|---:|---:|
| First delivery | `9 m` | `12 m` |
| Second delivery | `9 m` | `12 m` |
| Total | `18 m` | `24 m` |

Payment plan:

| Payment | Amount |
|---|---:|
| Cash/card | `2,000,000` |
| Check | `3,220,000` |
| Total | `5,220,000` |

Expected output:

| Wizard validation | Expected |
|---|---|
| Product step | Valid |
| Delivery step | Valid |
| Payment step | Valid |
| Signature step | Valid |
| Under-delivered variant | Invalid |

## Scenario 18: Invalid Payment

Purpose: verify payment errors for mismatch and missing required dates/names.

Input:

| Payment | Problem |
|---|---|
| Cash/Shiba | Missing payment date |
| Check | Missing check owner and handover date |
| Total payments | Less than contract total |

Expected errors:

| Error type | Expected |
|---|---|
| Payment sum mismatch | Present |
| Missing cash payment date | Present |
| Missing check owner | Present |
| Missing check handover date | Present |

## Scenario 19: Use Remaining Stone, Remove Child, Reuse Same Remaining

Purpose: verify that deleting a product created from a remaining stone restores the original remaining-stone dimensions, then allows the same remaining stone to be used again.

Original remaining stone:

| Field | Value |
|---|---:|
| Remaining stone | `9 cm × 2 m` |
| Quantity | `1` |
| Area | `0.18 m²` |

First use:

| Requested child product | Expected physical allocation |
|---|---|
| `3 cm × 6 m` | `3 × (3 cm × 2 m)` |

Expected after first use:

| Output | Value |
|---|---:|
| Allocation errors | `0` |
| Consumed source pieces | `1` |
| Physical pieces | `3` |

Expected after removing the child product:

| Output | Value |
|---|---:|
| Product list | Child product removed |
| Source used remaining stones | `0` |
| Restored remaining stone count | `1` |
| Restored remaining stone | `9 cm × 2 m` |
| Restored area | `0.18 m²` |
| Restored quantity | `1` |

Expected when using it again:

| Output | Value |
|---|---:|
| Reuse allocation errors | `0` |
| Reuse physical pieces | `3` |
| Reuse consumed source pieces | `1` |

Important behavior:

The restored remaining stone should be the original `9 cm × 2 m` source capacity, not a misleading newly-created child row. The user should be able to use it again with the same valid dimensions.

## Scenario 20: Partial Remaining Use, Remove Child, Restore Original Capacity

Purpose: verify that if a child product uses only part of a remaining stone and creates a generated leftover piece, deleting that child removes the generated leftover and restores the original remaining stone.

Original remaining stone:

| Field | Value |
|---|---:|
| Remaining stone | `10 cm × 9 m` |
| Quantity | `1` |
| Area | `0.9 m²` |

Use:

| Requested child product | Generated leftover |
|---|---|
| `5 cm × 9 m` | `5 cm × 9 m` |

Expected after use:

| Output | Value |
|---|---:|
| Allocation errors | `0` |
| Generated remaining count | `1` |
| Generated remaining | `5 cm × 9 m` |

Expected after removing the child product:

| Output | Value |
|---|---:|
| Source used remaining stones | `0` |
| Remaining stone count | `1` |
| Restored remaining stone | `10 cm × 9 m` |
| Restored area | `0.9 m²` |

Important behavior:

The generated leftover `5 cm × 9 m` should not stay beside the restored source, because that would double-count capacity. Removal is an undo of the allocation.

## Manual UI Scenarios Still Required

These need browser/manual testing because they depend on UI behavior, saved draft state, modals, routing, or generated contract output:

1. Create customer from contract flow and return to Step 2 with state restored.
2. Create project from contract flow and return to Step 3 with the project list refreshed.
3. Product search dropdown hover and selection behavior.
4. Product configuration modal unit toggles for cm/m and price recalculation while typing.
5. Duplicate a product row and verify the duplicate copies settings but has independent delivery/edit state.
6. Duplicate a standalone service row and verify it does not copy delivery assignments.
7. Edit a saved product with inactive/missing catalog tool or finishing and verify saved snapshot remains visible.
8. Use remaining stone from the orange remaining-stone panel and verify the source product usage updates.
9. Edit a product after a child product was created from its remaining stone and verify capacity warnings.
10. Slab UI with multiple standard dimension entries and both line-based/per-square-meter cutting modes.
11. Stair UI adding tread, riser, landing, layers, alternate layer stone, and layer type price.
12. Delivery UI split across several dates, including over-allocation and under-allocation messages.
13. Payment modal layout for cash/card, Shiba, and check on desktop and mobile widths.
14. Contract creation submit: verify API payload, created items, deliveries, payments, and contract data snapshot.
15. PDF/print output after editing: verify the current saved contract is printed, not an old creation snapshot.
16. Digital confirmation flow: send code, verify code, and final confirmation state wording.

## Coverage Summary

Automated coverage now protects the highest-risk calculation branches:

- Bidirectional smart dimension calculation.
- Longitudinal smart cutting with and without remaining stone.
- Saw kerf.
- Invalid cut dimensions.
- Remaining-stone partitioning, including split and rejected geometry.
- Slab source-area pricing, line cutting, and remaining pieces.
- Finishing by meter and square meter.
- Standalone services and service editing.
- Stair tread pricing, tool meters, cutting, and layer sourcing.
- Geometry edit detection and remaining-stone preservation.
- Remaining-stone use, child removal, source restoration, and reuse.
- Delivery target units for product/service/prepared rows.
- Full wizard validation for product, delivery, payment, and signature.
- Invalid payment errors.

The suite is intentionally calculation-heavy because those are the places where a contract can look correct visually but produce the wrong price, wrong remaining stone, or wrong delivery/payment validation.
