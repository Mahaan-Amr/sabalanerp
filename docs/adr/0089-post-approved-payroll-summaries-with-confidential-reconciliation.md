---
status: accepted
---

# Post approved payroll summaries with confidential reconciliation

HR owns employee, attendance, compensation, deduction, benefit, and Payroll Run calculation truth. An approved immutable run produces one idempotent Accounting handoff with version and population hashes, components, Cost Centers, control-account totals, liabilities, and a proposed balanced posting. Accounting may post or reasonedly return the handoff but cannot edit individual calculations; correction uses a supplemental or reversal run. Employee-level amounts remain access-restricted in Payroll while the general ledger is summarized, and reconciliation proves equality across Payroll, posted control accounts, bank results, payroll tax, insurance, loans, advances, and benefit obligations. Failed payments remain open and retries retain their obligation identity.
