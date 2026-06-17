# Stone Finishing Unit Pricing

Stone finishing (`pardakht sang`) remains a separate catalog and contract concept from tools (`abzar`). Each finishing catalog item has exactly one calculation base (`length` or `squareMeters`) and one unit price; contracts snapshot the selected finishing's unit, quantity, unit price, and cost inside `contractData.products`, while `ContractItem.totalPrice` remains the accounting-facing rollup.

Existing finishing records are migrated as square-meter finishings, and old contracts or draft wizard state that only contain `finishingPricePerSquareMeter` / `finishingSquareMeters` are interpreted as square-meter finishings forever. We are deliberately not adding relational finishing rows to contract items in this change, because PDFs, summaries, public confirmation, and accounting can remain correct from the contract snapshot plus rolled-up totals; a relational service-line model would be a separate architecture change.

Meter-based and square-meter finishings use automatic defaults where safe, but keep an editable contract quantity because finishing may apply to only part of the product depending on the job. Length-based finishing quantities are displayed as `metr tool`; square-meter finishing quantities are displayed as `metr morabba`. Contract creation must use searchable finishing selection for large catalogs and must be tested as a pricing migration across square-meter compatibility, meter-based longitudinal/slab/stair scenarios, PDFs, summaries, public confirmation, old drafts/contracts, and accounting totals.

## Acceptance Gate

Do not merge this migration until these scenarios pass manually or through automated coverage where practical:

- Existing square-meter finishing still calculates exactly as before by default.
- Square-meter finishing defaults to the product's calculated/pricing square meters, can be reduced by the user, and does not exceed the product's billable square meters.
- New meter-based finishing on a longitudinal product defaults to length times quantity, can be edited, and updates total price.
- Meter-based finishing on a slab starts at/manual uses entered meters.
- Stair parts each snapshot their own finishing unit, quantity, unit price, and cost.
- PDF, contract summary, and public confirmation show the correct unit, quantity, rate, and finishing total.
- Old contracts and old browser drafts still display as square-meter finishings.
- Accounting totals remain equal to contract item and contract total rollups.
