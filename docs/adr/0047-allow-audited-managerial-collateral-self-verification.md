---
status: accepted
---

# Allow audited managerial self-verification for hiring collateral custody

Ordinary hiring-collateral receipt and verification, and ordinary original-return recording and confirmation, remain separate actions performed by distinct eligible Users. As a narrow exception, an Accounting workspace administrator or global `ADMIN` whose current effective access includes both `RECORD_COLLATERAL_CUSTODY` and `VERIFY_COLLATERAL_CUSTODY` may perform each pair sequentially on the same version. The second action records the actual actor and time, the self-verification state, and the label `استفاده از اختیار مدیریتی`; it requires no extra explanation and never merges the two actions, removes prior versions, bypasses unresolved evidence, or crosses workspace scope. This decision supersedes ADR-0046 only where it initially placed hiring-collateral custody and original-return duties on the workspace-administrator override deny-list.
