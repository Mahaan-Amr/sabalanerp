# Partner retail collections

Issue #324 owns the private Partner-to-customer payment ledger. It consumes the
public schema-version-1 `PaymentPlanSchema`, `RETAIL_RECEIPT` and
`RETAIL_RECEIPT_REVERSE` commands, and the `RETAIL_*` events without changing
the shared contract package.

## Invariants

- Only the current authenticated Partner owner can mutate collections. Active
  and suspended owners may read their history; suspended owners cannot write.
- A receipt is positive, uses the Case retail currency, is allocated explicitly
  to installments of its named historical plan, and cannot over-collect an
  installment.
- A reversal appends a new row and event linked to the original receipt and
  historical plan. The public command reverses the full remaining amount; it
  never edits or reallocates the original evidence.
- A plan successor becomes the displayed customer plan, but receipts and
  allocations stay on their original plan. Net collection across the complete
  lineage reduces the current private retail balance.
- Delay facts are an internal module operation derived from the current
  effective plan, database time, and net allocations. HTTP callers cannot
  submit delay status or choose its effective date.
- Every receipt/reversal row has one matching strict `PartnerEvent`. Missing,
  orphaned, or conflicting evidence fails closed.
- No method creates, updates, delays, or settles a Sabalan Accounting receipt or
  receivable. Reporting receives only the strict retail outcome events.

## Integration contract

`RetailCollectionRepository` is the #334 transaction seam. Its production
adapter must reuse `backend/src/lib/prisma.ts` and, in one Case-locked database
transaction, resolve #319 authorization, read the database clock, compare the
expected Case revision/state, enforce durable idempotency by command ID and
actor/operation/target/key, and append the receipt, allocations, Case event,
and command outcome atomically. A false `Result` or exception rolls back every
write. Reads and exports repeat current authorization and return private,
`no-store` content only.

`registerPartnerRetailCollectionRoutes` is structural, exposes only the shared
`RETAIL_RECEIPT` and `RETAIL_RECEIPT_REVERSE` command union, and does not
register itself. Collection detail remains an internal projection; customer
output and private reporting keep their existing strict public schemas. The
integration owner supplies a freshly authenticated request-bound service and
mounts the route only behind the closed Partner rollout gates.

This delivery is Module/interface acceptance. Real Prisma binding, route
registration, whole-product E2E, combined QA, release approval, production
activation, and live financial/notification traffic remain owned by #334–#336.
