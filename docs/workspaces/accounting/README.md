# Accounting Workspace - Sabalan ERP

## Current Status

Accounting is in **Phase 1: sales-contract accounting control**.

Implemented today:

- Sales contracts are visible to accounting with customer, amount, status, and accounting workflow state.
- Accounting can create invoice-candidate financial records from eligible sales contracts.
- Financial approval captures the Sepidar/system invoice number, system invoice date, and approved amount.
- Financial approval locks the related sales contract against further sales edits.
- Accounting can create receivables after financial approval.
- Accounting can register receipts and track check status.
- Accounting can track tax-readiness and manual Samaneh Moadian submission status.
- Accounting can create and resolve correction requests back to sales.
- Accounting can flag contracts for accounting review.
- Accounting actions are written to the accounting audit log.
- Accounting has internal print/PDF variants for original, accounting, workshop, and custom contract outputs.
- Accounting list pages support richer contract/customer context, filtering, pagination, and direct contract links.
- Accountant performance reporting is available from accounting workflow events.

Not implemented yet:

- Full general ledger posting as a live accounting system.
- Complete chart-of-accounts management UI.
- Journal voucher draft generation, posting, reversal, and period close workflows.
- Trial balance, balance sheet, income statement, and cash-flow statements.
- Accounts payable/vendor accounting.
- Bank reconciliation.
- Direct Sepidar or tax-system integrations.

## Scope Boundary

Phase 1 is an operational accounting layer over sales contracts. It controls financial clearance, receivables, receipts, tax tracking, corrections, flags, and auditability.

Full GL is future work. The `ChartOfAccount`, `JournalVoucher`, and `JournalVoucherLine` models exist in Prisma, but the workspace does not yet post accounting entries as authoritative ledger movements.

Recommended posting model:

1. Keep financial approval as the commercial/accounting clearance point.
2. Add explicit journal-voucher draft generation from approved invoices and receipts.
3. Require accountant review before voucher posting.
4. Associate posted vouchers with accounting periods.
5. Reverse posted vouchers through reversal actions rather than silent edits.

## Accountant Performance Reporting

The performance report measures operational accounting speed from auditable database events, not browser activity.

Current metrics:

- Average time from sales contract creation to first accounting financial record.
- Average time from invoice-candidate creation to financial approval.
- Average time from contract creation to receipt registration.
- Average time to resolve correction requests.
- Count of financial records created.
- Count of invoices financially approved.
- Count of receipts registered.
- Count of correction requests opened and resolved.
- Count of accounting audit actions.

This avoids hidden surveillance and keeps metrics reproducible from accounting records and audit logs.

## Key Workflows

### Contract Accounting

1. Sales creates and advances a contract.
2. Accounting views the contract in the accounting register.
3. Accounting creates an invoice candidate when the contract is eligible.
4. Accounting financially approves the invoice candidate with system invoice data.
5. The sales contract becomes locked for sales edits.
6. Accounting creates receivables and registers receipts.
7. Tax readiness and submission status are tracked.
8. Corrections and flags are used when accounting needs sales-side clarification or remediation.

### Correction Requests

Correction requests are accounting-owned requests asking sales to correct contract or related data. Sales performs contract corrections through the sales edit flow when allowed. Accounting resolves the correction only after reviewing the corrected contract.

### Internal Prints

Accounting, workshop, and custom print variants are internal operational outputs. They do not mutate the commercial contract lifecycle. Only printing the original version marks the commercial contract as printed.

## Next Implementation Steps

1. Build chart-of-accounts management.
2. Generate journal-voucher drafts from financially approved invoices and registered receipts.
3. Add voucher posting, reversal, and period association.
4. Add GL reports: trial balance first, then financial statements.
5. Harden receivable/check lifecycle with replacement, reversal, and dispute flows.
6. Add tax export/validation workflows for Samaneh Moadian.
7. Expand accountant performance reporting with SLA thresholds and exception drill-down.

## Permissions

Accounting users need:

- View access for dashboard, registers, reports, and audit history.
- Edit access for accounting actions such as invoice creation, financial approval, receipt registration, tax tracking, corrections, flags, and settings updates.

Future GL work should introduce stricter permissions for voucher posting, reversal, period close, and chart-of-accounts administration.

## Design System

Accounting uses the shared ERP design system: slate/teal surfaces, `ErpPage`, `ErpListPage`, `ErpSection`, `ErpCard`, `ErpButton`, and `ErpBadge`.

Do not reintroduce standalone purple/glassmorphism accounting screens. Accounting should remain visually consistent with the rest of Sabalan ERP.
