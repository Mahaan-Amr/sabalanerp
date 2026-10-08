# Partner payment step — 2026-10-08

Partner payment creation no longer renders the amount/percent discount editor or its discount summary. New Partner wizard initialization keeps the required schema money field at zero, with no percentage input. Ordinary Sales retains its discount editor and constraints.

Both flows consume `ContractPaymentEntriesSection` for the list heading, add action, remaining amount, empty state, and existing shared payment cards. Both use canonical `ErpSummaryGrid` for contract total, paid total and balance. The existing shared `PaymentEntryModal`, Partner payment validation, stable installment IDs, persistence and money currency adapters remain in use.

Partner allocation summary uses exact decimal arithmetic, including underpayment and overpayment. Existing installment equality validation still blocks continuation until the full retail amount is covered. A payment-step validation error now clears once the payment plan becomes valid, without clearing unrelated server/action errors.

Historical compatibility: an already saved nonzero Partner discount is not silently removed from financial history or recalculated to zero. It is shown as a read-only notice and retained in its existing totals; there is no discount input. The confirmation summary shows that historical amount only when nonzero. New contracts have zero discount.

## Verification

- Frontend production build: passed, with existing repository lint warnings.
- TypeScript check: passed.
- Design system check, foundation and adoption suites: passed without baseline changes.
- `partnerPaymentAllocation.test.ts`: empty, partial, equal, excess, mixed currency, invalid amounts and historical compatibility passed.
- `partnerPaymentValidation.test.ts`, `partnerPaymentEntryAdapter.test.ts`, `wizardRetail.test.tsx`, `wizardRecovery.test.tsx`: passed.
- `paymentPresentation.test.tsx`: actual ordinary Sales component still renders its discount editor and the shared payment list/totals.
- Targeted real browser suite: `node scripts/run-design-system-e2e.mjs partner-creation-entry-regressions.spec.ts --grep 'Partner payments have no discount|newly initialized Partner wizard|Reviewed Partner correction'` — 4 passed. Covers zero-discount initialization, no automatic payment, method selection, add/edit/cancel/delete, remaining balance, absence of discount inputs, overpayment blocking, exact-payment success, clearing the repaired validation error, and preserved historical payments at desktop/mobile widths.
- Screenshots `payment-1280-{light,dark}.png` and `payment-390-{light,dark}.png`: actual local Partner runtime, no horizontal overflow.

Only the existing healthy `sabalanerp-local` Compose environment was used. HTTP fixtures isolate test data from real customer records. The first broad browser invocation was stopped after an unrelated independent-services scenario failed; the scoped payment suite above was then run directly and passed.

Changes remain local; no production deployment was performed.
