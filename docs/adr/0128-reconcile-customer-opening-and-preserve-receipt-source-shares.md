---
status: accepted
---

# Reconcile customer openings and preserve receipt source shares

Issue #406 implements the customer-account decisions confirmed on 2026-10-14, extending ADR-0114 within ADR-0063's internal development boundary. No production authority transfers and no Sepidar records change.

An opening review owns a customer-specific basis date, confirmed total, evidence-backed lines, the reviewed snapshot, and posted-source matches. Only each line's unposted remainder creates an immutable opening item. A zero transfer persists its review without a zero voucher. Contracts and operational invoice records do not become financial postings merely through association. Subsequent attribution revisions retain evidence and change the shared read projection without modifying or reposting the original item.

Receipt components reuse the existing treasury transaction owner. Cash, bank, card and each cheque have independent identities within one confirmed parent command. Allocation uses the existing immutable settlement owner, with exactly one receipt component or independent credit item as its source. Compound commands commit all source shares together and retain a parent idempotency identity. Independent credits never fabricate cash receipts.

Receipt corrections append related posted adjustments. Selected consumption is reversed and any retained share reapplied in the same transaction. Cancellation reverses effective consumption; prior cash refunds must be resolved before reducing the source below them. Original debts reopen rather than being duplicated. Source, debt, customer, book, date, period and concurrent consumption limits remain governed by the existing ledger.

A linked cheque's bank deposit and bank outcome create instrument events and ledger postings together. Collection moves an asset without creating another customer receipt. Documented nonpayment invalidates only that instrument's unpaid amount and selected invalid consumption; collected amounts remain valid. Generic independent status transitions cannot bypass this coordination. Returned endorsed instruments remain distinct from bank nonpayment and retain the existing supply-chain owner; this work does not create a competing supplier-payables authority.

Allocatable credit and refundable cash are separate projections. Uncleared valid cheques can be allocated, but only collected unused amounts can be refunded. Independent documented credits can be refunded up to their remaining effective amount. Company bank fees create separate expense postings while preserving the gross customer receipt. Instrument receivables cannot be represented through standalone credit commands to evade cheque refund limits.
