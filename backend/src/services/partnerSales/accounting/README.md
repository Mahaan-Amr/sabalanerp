# Partner Accounting module — #322

Consumes the public `SabalanInternalRecordView`, `PartnerAccountView`,
`AccountingPartnerPort`, and `SABALAN_*` contracts (wire schema 1, `sha256-v1`).
The initial foundation baseline is package 1.0.0; delivery also consumes the
unchanged v1 financial contracts from the owner's 1.1.0 package wiring. No schema, shared manifest,
route registration, feature activation, SMS, or production deployment is owned here.

## Entry points

`createPartnerAccountingAdapter(repository)` exposes:

- `enqueueCommitted(view, event)`: validates the canonical Case commitment and
  its internal source, then idempotently records queue evidence. No invoice,
  receipt, receivable, or second realization event is created here.
- `prepareFinancialRecord(expected)`: returns the immutable internal source for
  Accounting preparation, including Partner/Commercial Account debtor identity,
  approved wholesale row evidence, internal totals and Partner-to-Sabalan plan.
  It neither approves an invoice nor creates debt records.
- `acceptFinancialApproval(expected, invoiceRecordId)`: joins the existing
  financial approval transaction. Reads the approved invoice from Accounting,
  verifies exact revision/content binding, creates one official receivable via
  the persistence port and appends its approval event atomically. A different
  live receivable blocks replacement until the official void workflow resolves it.
- `publishAccountingFact(expected, factId)`: reads saved Accounting evidence and
  publishes a receipt or dated commercial adjustment. It cannot execute a
  receipt, clear a check, authorize a correction, or void a financial record.
- `readOwnAccount(partnerSellerId)`: compares the requested identity to the
  authenticated account snapshot. One purchase per Case uses official
  amount/received/balance when available, otherwise a pending commercial
  obligation. Duplicate Cases and conflicting financial evidence fail closed.
  Internal numbers, invoice mechanics, approval evidence, and installment notes
  are absent from the returned strict allowlisted view.

## Financial truth and history

Amounts and installment reconciliation use exact decimal strings. No implicit
IRR/IRT conversion, floating tolerance, current catalog repricing, retail receipt,
retail discount, or retail tax enters Accounting. The source's `payable` is
authoritative; this module deliberately does not guess whether `TotalsSchema.net`
already includes `discount`. The existing financial evidence owner must validate
the totals before approving the invoice.

The preparation fingerprint excludes the encompassing Case revision and internal
installment notes (which retain their separate operational audit history).
Therefore a retail-only successor can advance the expected Case revision while
retaining the same financial evidence and receivable. A shared or Sabalan-term
change requires new financial evidence and the existing correction gates.

An issued replacement supplies the single effective invoice/receivable snapshot;
historical invoices and receipts are not summed again or rewritten. Received and
balance come from canonical Accounting collection history, including dated check
clearance, bounce, return, receipt reversal, settlement and replacement effects.
The account reader does not treat check custody as collection. `SABALAN_RECEIPT`
is emitted only for saved positive collection evidence, not an expected or
uncleared check. Wire v1 has no negative receipt event: reversals stay in canonical
Accounting history, **not** a fabricated negative receipt or commercial adjustment.
Any new shared reversal event belongs to the contract writer and needs a reviewed
version change. Commercial adjustments retain their original realization,
correction identity, Persian reason, and Accounting effective date.

## Required #334 integration (closed until proven)

`PartnerAccountingRepository` is a persistence/authorization boundary, not an
in-memory runtime store. Its only current implementation is the namespaced test
fixture. The real adapter must:

1. Use the one application Prisma client and join the Case/financial transaction.
   Lock/CAS the Case, reauthorize with #319 at every read/write/replay, verify
   current profile, assignment, channel, purpose, correction freeze and immutable
   persisted revision/hash provenance. `readAuthorizedSource` must not trust DTOs.
   Preserve Partner-specific separation of duties even for Admin. Committed
   Accounting remains available during operational pause under its own authority.
2. Roll back **both false Results and thrown errors**. Approval, receivable,
   event, audit and idempotency evidence must commit together. Enforce unique
   queue-per-Case, receivable-per-invoice and immutable event identities in the
   #315-owned schema. No metadata-only substitute for missing relational ownership.
3. Feed preparation into the existing financial evidence/approval owner. Map
   `insertReceivable` to the official `AccountingReceivable` with Partner debtor
   linkage, never the retail customer/Contract. The stored schedule retains every
   installment; the receivable's summary due date is the earliest installment
   (or the plan effective date for a zero-value empty schedule).
4. Resolve effective invoice replacement and collection history under one
   consistent snapshot, including receipts attached to historical plans/invoices.
   Conflicting active leaves must reject, not pick an arbitrary invoice. Verify
   historical fact provenance before `readAccountingFact` returns it. A receipt
   event identity is per immutable collection movement, not a mutable check row.
5. Register purpose-specific Accounting and owner-only account reads through
   the existing central route/query dispatcher; do not expose these internal
   persistence methods as browser commands. Translate failures with `publicError`
   and route integrity conflicts to the existing evidence-review/support owner
   without exposing payloads or losing review evidence to a rollback.
6. Run real Case/profile/policy integration and database concurrency tests on
   the existing `sabalanerp-local` project. These fixture tests are **module
   evidence only**, not migrated-schema, live authorization, or release acceptance.

## Local verification

From the repository root, with shared backend dependencies installed by their owner:

```powershell
node backend/node_modules/tsx/dist/cli.mjs --test backend/src/services/__tests__/partnerAccounting.test.ts
npm run build:backend
npm run architecture:check
```

Run the full foundation suite as well. The fixture tests exercise only the approved Accounting/account
seams. Their serialized in-memory transaction proves adapter retry and rollback
behavior; it does not prove database locking or production persistence.
