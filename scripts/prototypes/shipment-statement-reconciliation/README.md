# PROTOTYPE — Shipment statement reconciliation

## Question

Does a serialized, event-derived fixed-point ledger produce reproducible Customer Shipment Statements and additive adjustments while ensuring canonical all-in row amounts and contract discounts reconcile exactly at the zero and fully represented quantity boundaries?

Run it with:

```powershell
npm run prototype:shipment-statement-reconciliation
```

Use keys `1`–`9` to select a scenario and `n` / `p` to move through its actions. For a non-interactive dump of every final scenario, run:

```powershell
npm run prototype:shipment-statement-reconciliation -- --all
```

## Proposed calculation contract

- Quantity is an integer at scale 3. Money is an integer at allocation scale 12 in this prototype. Production must freeze the chosen scale with the pricing-snapshot schema; display alone rounds to the nearest whole currency unit.
- Each stable contract row freezes one canonical all-in target. Material, mandatory pricing, billable cutting, finishing, tooling, and attached-service components are retained as evidence but never added to that target again.
- Each contract freezes its discount amount plus a discount-eligible basis for every stable row. The contract discount is partitioned across eligible rows in immutable row order; the last eligible row receives the partition residue. Standalone unattached services have no shipment row and receive no shipment allocation.
- Every pricing event is serialized per frozen contract-row pricing version. Ordinary event amounts use integer multiplication and division toward zero. When the resulting represented quantity is exactly the contracted quantity, the event receives the exact unallocated target remainder. When it becomes zero, the event receives the exact negative represented remainder.
- One finalized allocation revision owns one pricing event. Issuance renders that event. A pre-exit document replacement creates a new numbered artifact bundle pointing to the same pricing event; it never allocates again.
- Only a posted Dispatch Correction creates a Customer Shipment Statement Adjustment. Signed row deltas use the original frozen row pricing version. A negative delta requires verified return evidence. The original statement is never regenerated.
- Contract subtotals are calculated independently and then summed. A bundle may contain multiple contracts only after customer, destination, and currency equality has already passed fail-closed validation.
- Stored event amounts and immutable sequence are authoritative. Display totals round directly from authoritative unrounded totals, never from displayed line sums.

## Scenario matrix

| Scenario | Boundary proved |
| --- | --- |
| Three one-third shipments | The final shipment receives the 12-decimal residue and reaches the exact row and discount targets. |
| Attached-cost row | Component evidence is not charged twice. |
| Discount plus multiple contracts | Discount targets and subtotals remain contract-scoped. |
| Pre-exit void and replacement | Artifact replacement does not create a second monetary event. |
| Verified return then reshipment | Additive negative adjustment plus later final remainder returns to exact targets. |
| Row reattribution | Signed source/destination deltas remain atomic and stable-row-specific. |
| Full return | The zero boundary removes all monetary residue. |
| Over-allocation | Positive overage remains visible and is never clamped. |
| Opposite correction | The reversal restores the exact prior monetary state without deleting either adjustment. |

## Decisions to validate

### Accepted

1. Use the frozen per-row discount eligibility basis (matching current contract discount evidence), rather than canonical all-in totals, to partition the contract discount.
2. Use a schema-fixed monetary allocation scale of 12 decimal currency units; the current persisted contract values are scale 2, but shipment ratios require additional exact allocation precision.
3. Serialize monetary events per stable contract row and heal all fixed-point residue only at exact zero/full quantity boundaries.
4. Treat a pre-exit bundle replacement as an artifact operation over the same priced allocation, not a new allocation.

### Still to validate

None.

This directory is throwaway prototype code. It must not be promoted into production unchanged.
