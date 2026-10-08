# Partner digital confirmation UI — 2026-10-08

The Partner confirmation step now uses the ordinary Sales summary hierarchy: 24px summary heading, icon section headers, compact 14px label/value rows, product and service tables, and mounted disclosures for deliveries and payments. Contract, customer, financial, and customer approval information stay in canonical Sabalan cards. Approval actions appear below the detail sections.

Partner save, confirmation, cancellation, reactivation, permissions, inquiry approval and financial commands are retained. No ordinary Sales approval commands or attempt counters are substituted for Partner state. Discount controls remain absent; a nonzero retained historical discount remains visible. Monetary summaries reuse exact Partner decimal calculations and quote totals. Gregorian storage dates render through the shared Persian date adapter; payment labels reuse the shared method choices.

Validation:
- `npm run design-system:check` — passed.
- `npm run test:design-system-foundation` — passed.
- `npm run test:design-system-adoption` — passed.
- `npm run build:frontend` — passed, including TypeScript validation.
- `npx tsx --test src/features/contract-creation/partner/PartnerConfirmationStep.test.tsx src/features/contract-creation/partner/partnerPaymentAllocation.test.ts` in frontend — 5 passed; includes service-only, retained discount and immutable intent checks.
- Browser regression — 2 passed: `node scripts/run-design-system-e2e.mjs partner-creation-entry-regressions.spec.ts --grep "Reviewed Partner correction"` against the existing sabalanerp-local environment. Tests cover retained payment, reaching confirmation, detail sections, Persian payment date/method, and cancellation confirmation protection at 1280px and 390px. Partner API calls are mocked; no real account is mutated or messaged.

Visual evidence: confirmation-{1280,390}-{light,dark}.png. Product/payment tables scroll inside their disclosure when necessary without viewport overflow. Existing repository lint warnings are outside this change. Changes are local; no production deployment was performed.
