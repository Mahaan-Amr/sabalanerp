---
status: accepted
---

# Separate commercial, ledger, and tax document lifecycles

The customer-facing Commercial Customer Invoice, the Journal Voucher that records economic effect, and the electronic Tax Invoice submitted to the Taxpayer System are distinct immutable or governed documents with separate identities and lifecycles. They remain bidirectionally traceable, but rejection or transport failure in the tax lifecycle never silently deletes or rewrites the commercial transaction or posted accounting entry. Submitted tax documents are corrected, cancelled, or returned only through new reference-linked Tax Invoices, not in-place editing.
