---
status: accepted
---

# Post verified Sepidar ledger history in the development book

The project owner revoked the blanket rule that every imported Sepidar voucher must remain a draft until authority transfer. In the local development book, source-linked vouchers from the complete backup may be posted through the ordinary ledger workflow after their immutable source hash, approved mapping link, account rules, period, line evidence, balance, and audit transaction are verified. The owner's explicit approval supplies the local mapping review; the source archive remains immutable and later backups reconcile differences without rewriting posted vouchers.

Historical posting and production authority transfer are separate decisions. Posting the available 1404 vouchers does not fill the missing detail from 2025-03-21 through 2025-12-21. Posting 1405 ledger vouchers does not value 1,180 zero-cost outbound inventory movements or resolve 118 negative inventory summaries. Reports and migration verification must disclose these gaps; production cutover still requires observed write fencing, reconciliation, and recovery proof.
