---
status: accepted
---

# Migrate reconciled opening balances and open items instead of replaying all Sepidar history

Accounting cutover should occur at a Fiscal Year boundary when practical. SabalanERP receives reviewed opening balances plus detailed open customer, supplier, check, bank, inventory, fixed-asset, tax, and other subledger items; a midyear cutover additionally receives and reconciles all current-year movements through the cutover instant. Older Sepidar records remain a searchable read-only archive and are not recreated as posted SabalanERP vouchers unless a specific legal or reconciliation requirement approves a traced migration. This preserves operational continuity and audit access without manufacturing a second historical ledger whose reconstructed entries may differ from the source.
