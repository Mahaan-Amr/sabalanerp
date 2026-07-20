# Stable delivery-product row identity

## Status

Accepted

## Context

Delivery schedules historically identified contract products by mutable array position (`productIndex`) and a catalog product ID. Editing a stair can insert or remove dependent layer rows, shifting later positions even though the intended delivered product has not changed. Catalog identity is also insufficient because multiple contract rows may use the same stone.

## Decision

The canonical target of a product delivery assignment is the contract product's stable `productRowId`.

Legacy assignments may migrate automatically only when their saved `productIndex` resolves to an existing row and the saved `productId` agrees with that row. Missing, duplicate, deleted, non-deliverable, or contradictory references are conflicts that block final save.

Commercial rows may legitimately be identical or similar. Equality of catalog product, dimensions, description, quantity, unit price, or total never makes two contract rows the same row. If otherwise-independent rows accidentally share an internal `productRowId`, all rows in that collision are re-keyed without changing their commercial fields. The old identity is intentionally left without a target, so an existing delivery assignment remains invalid until the operator removes and manually re-enters it. No collided row is silently favored.

When a duplicated `productRowId` is referenced as the parent or material source of a stair layer or remaining-stone child, automatic re-keying is blocked. The relationship must be reviewed explicitly because the system cannot safely infer which duplicated row owns the child.

The conflict UI shows the invalid assignment and its quantity. The operator may explicitly confirm «حذف تخصیص نامعتبر», which removes only that assignment and leaves its quantity unallocated. The operator must then assign the quantity manually to the correct row. Similarity of stone, dimensions, description, or adjacent position never authorizes automatic reassignment.

Dependent stair-layer rows are not independent delivery targets; their physical identity and delivery balance remain nested under the exact parent stair row.

## Consequences

- Product insertion, deletion, and stair-layer recalculation cannot silently transfer a delivery quantity.
- Valid legacy contracts migrate without operator work when index and catalog identity agree.
- Ambiguous legacy data requires explicit review and cannot be saved accidentally.
- Legitimate repeated product rows remain separate and unrestricted.
- Independent identity collisions can be repaired without changing quantities, geometry, prices, or totals.
- Parent/source identity collisions remain blocked rather than silently moving a child relationship.
- Delivery UI, validation, submission, saved contract snapshots, and printed output resolve the same stable row identity.
- `productIndex` remains only a refreshed compatibility snapshot for older consumers.
