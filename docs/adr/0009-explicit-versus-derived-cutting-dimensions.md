---
status: superseded by ADR-0010
---

# Explicit versus derived cutting dimensions

Explicitly entered width and length are physical-piece constraints, so smart cutting preserves each requested piece unless the user deliberately allows physical splitting. A zero or empty dimension authorizes the optimizer to derive that missing value from the remaining quantity and area inputs for an efficient layout, with the calculated dimensions and physical result shown before save.

After confirmation, a derived dimension is saved and identified as system-calculated. The customer-facing contract preserves the commercial request while also recording a clear breakdown of any permitted physical split; workshop output always uses the exact physical pieces. This keeps commercial intent, customer-visible delivery, and production truth related without treating them as the same fact.

A zero quantity with explicit longitudinal width and total length is also an optimizer instruction, not a physical quantity of zero and not a fallback to one. The optimizer derives the maximum strip count that fits across the source width after saw kerf, divides the entered total length across those strips, and saves the resulting physical quantity and per-piece length. Explicit positive quantities continue to constrain physical pieces exactly as entered. Material pricing, delivery meterage, and square-meter add-ons retain the same commercial totals, while edge operations, cutting, workshop output, and remaining inventory use the derived physical breakdown.
