# Preserve customer request across optimizer calculations

Customer-entered longitudinal quantity, length, and width remain unchanged in sales, accounting, delivery, and workshop views. Quantity-zero optimization is an internal geometry truth for source-material consumption, canonical remaining inventory, and geometry-sensitive pricing, but it neither replaces the contract row nor dictates how the workshop physically cuts the stone. Thus `5 × 10m × 7cm` may price one long edge as `50m` and one short edge as `0.35m`, while every primary row remains the customer's `0 / 50m / 7cm`; optimizer-derived remainder is immediately allocatable without workshop approval. The breakdown is visible only to sales operators in the create/edit modal as `مبنای محاسبات داخلی`, never in customer PDFs, accounting, delivery, workshop, or other primary summaries.

Legacy derived-quantity rows reconstruct the customer request from optimizer provenance when read, including `quantity 0` and total requested length. Persistence is corrected only by an authorized explicit contract save; finalized historical contracts are never silently bulk-migrated.

Positive quantity retains the existing per-piece contract meaning: `quantity 2 / length 50m` requests two 50-meter pieces, totaling 100 meters. Only zero or empty longitudinal quantity treats the entered length as one total-length request for internal optimization.

Cutting keeps its existing calibration policy: the `5 × 10m` layout produces `50m` of longitudinal cutting, plus a separate `10m` calibration cut only when calibration is enabled. Sales operators see that explanation inside the internal-calculation box; customer and downstream primary rows do not expose the optimizer breakdown.
