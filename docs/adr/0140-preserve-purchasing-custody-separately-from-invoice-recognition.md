---
status: accepted
---

# Preserve Purchasing custody separately from invoice recognition

The owner approved quality-based availability, protected contract shares, explicit surplus transfers, and Accounting-owned invoice/payment workflows. ADR-0139 retains Purchasing's operational evidence. The implementation must connect these facts without manufacturing a financial approval, Guard visit, warehouse visit for direct delivery, or duplicate receipt.

Qualified warehouse acceptance publishes a physical receipt into the existing inventory event ledger. Each Purchasing Receipt has a separate inventory identity, preserving traceability, unit and return boundaries. Contract shares use the existing inventory reservation ledger; unaccepted and rejected quantities never enter it. New acceptance does not backfill older receipts. Existing historical inventory is connected explicitly. Direct customer delivery produces destination evidence without entering Sabalan warehouse stock.

Physical custody and valuation are separate projections of the same inventory identity. Invoice recognition remains an explicit Accounting operation and creates valuation/debt only after authoritative order/acceptance matching. It must reuse an already published physical receipt rather than adding it again. Unknown purchase prices remain unknown. Amounts are entered in toman and converted exactly for Accounting's rial ledger. An accepted return after valuation or consumption requires the owning Accounting reversal workflow; physical corrections never silently erase a layer, consumption, reservation or payment.

All supply-chain quantity columns widen from DECIMAL(24,6) to DECIMAL(65,30), consistent with Purchasing's exact quantities and ADR-0136. This changes capacity, not the values or meaning of existing records. Money columns and historical payloads remain unchanged. No quantities pass through JavaScript Number. Full-share mappings preserve exact final remainders.

This ADR records accepted ownership and implementation constraints, not deployment or completion evidence. Local verification and outstanding delivery items remain in the Purchasing completion report.
