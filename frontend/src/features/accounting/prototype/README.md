# Customer finance UI experiment

Question: which information hierarchy makes a customer account easiest to read and operate while preserving the distinction between contract face values, posted debts and receipt allocations?

Local throwaway branch: `codex/prototype-customer-finance-ux`.
Decision: awaiting user comparison; no variant has been promoted.

User refinement: prefer direct labels, minimal text and clear feature navigation. The prototype now keeps two primary actions visible, exposes secondary actions through a labeled menu, and separates debts, receipt tracing, statement and analytics. Details and secondary balances open on demand; explanatory banners and repeated summaries were removed. The compact prototype badge still identifies that actions do not post financial data.

Run from the repository root:

```sh
npm run prototype:customer-finance
```

Open an existing customer account and append `?variant=A`, `?variant=B` or `?variant=C`:

- A: analytical overview, settlement proportion, aging distribution and compact posted items.
- B: task-oriented workbench, visible operation entry points and recent movements.
- C: receipt-first source → allocation → debt/contract tracing.

The bottom switcher and arrow keys cycle variants. Search, overdue filtering, disclosures, receipt selection and simulated amount entry are interactive. Input fields retain canonical integer rial strings through the existing grouped-number component.

Reads reuse the host page's existing account fetch and authentication. Actions only open in-memory previews; none submit financial commands. Historical ledger amounts are not simulated or combined with contract face values. Charts derive from posted receivable items. Zero overdue debt is presented as a valid state, without manufacturing red warning data.

The local Compose prototype flag is required. Ordinary account URLs retain their existing view. Production builds without the prototype flag do not expose the variants or switcher. Full variants must stay on this branch; rewrite a chosen design with appropriate behavioral coverage before promotion.

Validation: frontend production build and type checking; design-system adoption, foundation and adoption suites; two existing accounting overlay/date E2E checks; browser exploration of all variants at desktop and 390px, search, URL cycling, grouped amount input, modal dismissal and zero accounting writes. Local screenshots live under `test-results/accounting-ledger/prototype-{A,B,C}-{desktop,mobile}.png`.
