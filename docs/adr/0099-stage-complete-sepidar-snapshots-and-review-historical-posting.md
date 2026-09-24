---
status: accepted
---

# Stage complete Sepidar snapshots and require reviewed historical posting

The Sepidar backup is ingested as an immutable, versioned source snapshot. A later complete backup produces an explicit row-level delta by table, source key, and content hash. A change or disappearance in Sepidar never rewrites an existing Sabalan posting; it creates a reconciliation case with source evidence. During the parallel run Sepidar remains the legal accounting authority, while Sabalan entries are matched to source events and remain subject to cutover gates.

The available backup contains fiscal years 1404 and 1405. The local development book adopts their actual date ranges and a proposed 2/2/2 account scheme. Its unrelated financial, tax, and audit history remains intact. Every source account and master-data identity receives a mapping proposal, but proposed account meanings and opening balances require approval from the company accountant before statutory posting.

The requested 1404 historical posting is a specific exception to ADR-0067: only the available vouchers and reviewed opening entries may be posted with source lineage. The backup lacks voucher detail from 2025-03-21 through 2025-12-21. Every 1404 statutory report must prominently disclose this coverage gap and must not claim to represent the complete fiscal year. Posting remains blocked until the accountant accepts the mapping and opening evidence.

Fiscal 1405 inventory outbound movements with zero cost or unresolved negative stock remain visible exceptions. They cannot be treated as valued inventory postings or as evidence that official financial reports are reconciled. Authority transfer requires verified target records, complete parallel periods, actual write fencing and recovery proof; caller-supplied flags alone are insufficient.
