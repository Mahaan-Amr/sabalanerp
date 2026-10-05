---
status: accepted
---

# Integrate the customer financial workspace through immutable open items

The customer-account design confirmed on 2026-10-05 includes every direct Sabalan CRM Customer, normal or special, including those without financial activity. CRM-only views do not provision accounting identities or fabricate Sales approval relationships. The first explicit authorized financial write may provision a zero-balance identity under the primary Book. Partner-owned customer retail evidence and Partner debtor identity retain ADR-0105's boundary.

Commercial Contracts and operational Accounting records remain separate from the posted customer subledger. Summary and detailed views distinguish contractual commitments, signed net receivable, unallocated receipts and net financial position. Net position is net remaining receivable less unallocated receipts; allocations and their reversals do not change it. Special-customer credit remains the domain-owned credit projection, with Manager/Admin policy ownership preserved.

An Accountant with the corresponding feature authority may record a documented opening item, independent debit or credit, refund, or desired net balance adjustment. Opening is recorded once; later changes create independent corrective items for the difference, retain all prior evidence, and reject stale expected balances. Standalone items reference their posted voucher instead of a fictitious commercial invoice or Contract. The existing immutable allocation owner also settles standalone debit items. Receipt refunds consume only refundable unallocated money, and credit refunds settle the referenced credit item; neither may consume the same credit twice. These commands use the governed ledger, exact whole-rial amounts, open-period checks, explicit confirmation, idempotent evidence and audit history. New customer-owned vouchers cannot be reversed directly in the generic ledger, because reversal without the corresponding subledger correction would misstate the customer balance.

The user explicitly excluded customer-to-customer money transfers. Read-only statements and accountant actions share existing domain services rather than creating a second financial authority or changing Sales, CRM classification, check lifecycle, tax or dispatch ownership.
