# Customer account UI migration

Approved design: a compact account summary, task shortcuts, receipt-to-debt tracing and optional analytics. Prototype source is retained on `codex/prototype-customer-finance-ux`; the production route has no prototype flag, variant switcher or simulated command handlers.

## Capability preservation map

| Existing capability / data | Final location |
| --- | --- |
| Net balance, posted open debt, unallocated receipt credit | Always-visible account summary |
| Independent credit, collected refundable amount, current-contract totals | Summary → account information disclosure; contract amount stays separate from posted debt |
| Reviewed opening basis, confirmed total, transfer, review date, attribution history | Summary → reviewed opening disclosure |
| Special customer's limit, used and available credit | Summary → special customer credit |
| Recent movements and full statement with debit / credit / running balance | Summary and statement tab |
| All open and historical posted debit / credit items | Debt and credit tab, open/all/overdue/credit filters, search and pagination |
| Item original amount, consumed amount, remaining amount, linked contract / invoice | Item details, records and contracts |
| Receipt source shares and standalone credit shares, source / allocation / item vouchers | Existing posted-item details retained; new receipt tracing adds direct share and voucher access |
| Contract search, status, inactive state, amount/currency, credit promise, contract financial links | Contracts tab retained |
| Original operational financial records, exact linked posted items and unmatched items | Records and receivables tab retained |
| Operational receivables, paid / remaining amount, due date, downstream link | Records and receivables tab retained separately from posted balances |
| Receipt history, legacy resolution and earlier adjustment vouchers | Receipts and checks tab retained |
| Original/effective receipt amount, active allocation, refunds, free credit, refundable amount | Receipts and checks tab retained |
| Receipt adjustment history, allocation history including reversals and exact per-debt share | Receipts and checks tab retained |
| Reverse receipt allocation / standalone credit allocation | Existing contextual controls and operation form retained |
| Treasury cheque status, amount, cleared/unpaid split, due date and direction | Receipts and checks tab retained with treasury link |
| Contract payments and cheques, status, amount/currency, due date and downstream link | Receipts and checks tab retained |
| Refund evidence | Receipts and checks now additionally lists refund events and vouchers |
| PDF / Excel export | Other operations → existing authorized export calls |
| Receipt, allocation | Visible task buttons; existing real command flow |
| Refund, correction, cancellation, legacy resolution | Other operations → existing real command flow |
| Cheque deposit, settle/unpaid, endorsement and recipient return | Other operations → existing real command flow |
| Debit, credit, reviewed opening, set balance, opening attribution | Other operations → existing real command flow; opening eligibility unchanged |

All original capability checks remain. Viewing analytics or receipt tracing issues no financial command. The new charts use posted receivable items only, retain integer-rial precision with BigInt and do not add contract face values or standalone credits into debt settlement totals. Red indicates overdue debt; current debt alone is not an error. A cheque credit is not presented as collected refundable cash.

## Verification

- Existing customer-finance command E2E coverage retained, with only navigation selectors updated for the labeled operation sheet.
- Workspace preservation scenario covers the operation inventory, item detail, active receipt shares, reverse allocation, treasury/payment links, analytics, voucher access and denied capabilities; view navigation must produce zero financial writes.
- Insight tests cover integer amounts beyond Number precision, credit/contract exclusion, aging, empty and fully settled accounts.
- Existing money and exact posted-link tests retained.
- Design-system checks, foundation/adoption suites, frontend production build and browser checks on the existing `sabalanerp-local` services.

No backend schema, migration, ledger calculation, command payload or saved financial record changes are part of this UI migration.

Results: all 14 customer-account/finance browser scenarios passed (13 in the initial run and the remaining scenario after naming its target dialog explicitly). Six exact-money/link/insight tests, 25 design-system foundation tests, 14 adoption tests and three shared overlay/date browser checks passed. Frontend production build passed with existing repository warnings. The earlier dropdown search test now targets the current accessible name rather than the old placeholder.

Read-only browser verification on the existing training account covered all seven tabs at desktop and 390px, 200% zoom, opening details, attribution action, receipt tracing and item detail. It recorded zero financial writes. Prototype variants remain available in their archival branch, not in the production route.
