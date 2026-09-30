---
status: accepted
---

# Round the contractual payable total once after precise summation

For new Sales Contracts and editable creation Drafts in both Sabalan Seller and Partner Seller, calculate the final payable total using the existing commercial rules and precise product unit prices and row amounts, then round that total once to the nearest whole unit of the agreement's stated currency, with half units rounded upward. Do not round individual product rows or unit prices. The rounded total is the actual contractual obligation shared by the Payment Plan, Accounting, and user-facing documents, rather than a presentation-only approximation. This replaces the previous display-only interpretation for the final Contract payable amount.

Partner wholesale and retail agreements apply the rule independently. Sabalan Accounting continues to recognize the Sabalan-to-Partner wholesale obligation, never the Partner-to-Customer retail price. Finalized Contracts and Contracts with financial documents keep their historical agreed amounts; commercial changes to those records use the existing formal correction workflow.

Preserve the precise source total, currency, applied rounding rule and version, and exact difference as internal evidence. No rounding-adjustment parameter or line is shown in operational screens, contract summaries, or customer-facing output, and this deterministic rounding alone must not require a separate confirmation or block continuation. A genuine payment shortfall, unrelated financial conflict, or permission failure remains subject to existing controls. ADR-0069 still governs whole-rial ledger postings and any internal journal evidence required to balance those postings; this decision does not remove those controls.

Rounding each row before summation was rejected because it can change the payable total: two amounts of 100.4 produce a precise total of 200.8 and a payable total of 201, while rounding each row first would produce 200. The product rows remain 100.4 and the Contract payable total is 201, without a visible adjustment parameter.

The User confirmed this complete policy on 2026-09-28. Implementation uses versioned payable rounding evidence and a new precise prepared-material pricing policy; existing quantity precision and historical pricing-policy replay remain unchanged. Price-witness and graph-total columns are widened to retain fractional source calculations while preserving their full previous integer range. The widening does not recalculate historical data or change existing liabilities. Production application of these migrations remains subject to ADR-0039 and the standard zero-data-loss deployment procedure.
