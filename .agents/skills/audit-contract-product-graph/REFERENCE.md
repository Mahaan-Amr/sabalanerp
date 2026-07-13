# Contract Product Graph Audit Reference

## Core scenario matrix

Use current production functions and realistic catalog inputs. Capture the complete product graph before and after every action.

1. Create a cuttable product with source geometry, saw kerf, ordinary or mandatory cutting, finishing, and tools.
2. Generate remaining stones and allocate more than one child product from them.
3. Edit the source width, length, quantity, mandatory state, and cutting settings separately. Recalculate and transactionally replay existing child allocations in original order.
4. Duplicate a source row, create remaining inventory for both rows, and allocate from the duplicate. Verify that row identity—not catalog similarity or array position—selects the source.
5. Add, edit, remove, and recalculate tools and finishing after geometry changes on both source products and remaining-stone child products.
6. Compare base price, cutting, mandatory pricing, finishing, tools, row total, summary total, saved snapshot, and all print variants.
7. Request one integral piece, then request the same total demand with physical splitting allowed. Verify that optimization honors the user's geometry intent.
8. Insert, remove, replace, reorder, and duplicate rows. Verify that parent/child, stair/layer, and remaining-source relationships survive without index drift.
9. Submit and reload the contract. Compare frontend state, contract DTO, persisted contract items, PDF/accounting/workshop output, delivery, and logistics identity.

## Required mutation cases

- A source edit makes every child still fit.
- A source edit makes only a later child conflict.
- A source edit makes an earlier child conflict while later children would fit alone.
- Replaying children in a different order would produce a different result.
- A child is deleted, duplicated, or edited before the source changes.
- A source and its duplicate use the same product/catalog identity.
- A child has independent ابزار and پرداخت سنگ selections.
- Parent add-ons change after child creation.
- A mandatory row has physical cuts but no billable cutting charge.
- A saved catalog add-on becomes missing or inactive before the row is edited.

## Invariants

- Each contract row has a stable immutable identity independent of position and catalog identity.
- A remaining-stone child refers to one source row through stable identity.
- Remaining inventory equals regenerated source geometry minus successfully replayed allocations; old consumed state is never added to a newly regenerated full remainder.
- Editing a source is atomic across its geometry, remaining inventory, and child allocations.
- Failed replay changes nothing and identifies every conflicting child allocation.
- Replay order is deterministic and preserves the original allocation order.
- Customer-requested finished geometry is distinct from source consumption geometry.
- Physical cuts remain visible to production even when their billable cutting charge is zero.
- Base product, cutting, mandatory, tools, finishing, discount, and total have one canonical owner each.
- Derived snapshots are regenerated from canonical facts rather than merged as competing truths.
- A remaining-stone child may own tools and finishing calculated from its own geometry and quantity.
- Parent add-ons are never inherited by a child merely because parent metadata was copied.
- Every downstream output reconciles to the same saved row facts and totals.

## Failure report template

For each finding include:

- Scenario and smallest reproduction
- Expected domain rule
- Actual state transition
- Exact writer and duplicated/stale field
- Why another component breaks after the change
- UI, pricing, persistence, and output impact
- Corruption/loss risk
- Recommended repair boundary
- Regression scenario required
