# Scope Partner pricing to numbered Cases

## Status

Accepted

## Context

The earlier Partner workflow treated one approved catalog-subject rate as reusable across Customers and Contracts for 48 hours, allowed independent inquiries outside Contract creation, allocated all three Case and record identities at the first numbered save, and allowed Customer confirmation while Sabalan pricing was incomplete. That model no longer matches the required commercial conversation: the internal Sabalan seller must quote one complete Partner Case without seeing the Partner's Customer or retail economics, the Partner must finish the ordinary Contract workflow before asking for that quote, and no customer-facing Contract or Sabalan debt may exist until the Partner deliberately accepts the completed Sabalan price package.

The two-price model must also remain exact. The Partner chooses only the customer-facing base Product-family rate; the responder chooses only the Sabalan base Product-family rate; and the canonical engine calculates the same cutting, adhesive, tool, finishing and other system-owned ancillary components for both projections. Sabalan Accounting owns only the Sabalan-to-Partner amount, while Customer collections remain the Partner's private commercial truth.

## Decision

Partner Contract creation reuses the ordinary seven-step Sales workflow and canonical Product Graph. When the Partner sends a valid completed wizard for pricing, the system creates one immutable Partner Sale Case number, current revision, audit evidence and one cross-workspace pricing duty for the responder assigned to that Partner account. It does not yet allocate the customer-Contract number or internal Sabalan-record number, create either final linked record, contact the Customer, create Sabalan debt, or make the Case eligible for Accounting or fulfillment.

Every responder decision is bound to one Case revision and stable Product row and cannot be reused in another Case. The responder sees only the technical graph and delivery facts materially necessary for pricing; Customer identity, contact details, exact address, retail price, retail payment plan, margin and other retail economics remain hidden. The Partner cannot select a responder per Case. Authorized management may reassign pending work only with a reason and preserved history.

The hidden Partner retail rate and responder Sabalan rate use the same fixed family basis but remain independent values: Longitudinal is priced per square meter; Stair sections are independently priced per finished tread, riser or landing; Slab is priced per canonical consumed mother-stone unit; and Prepared Product uses its catalog unit price. Cubic Product is outside the active Partner workflow. The ordinary canonical engine multiplies each base rate by its authoritative family quantity and adds identical system-owned ancillary calculations to both projections. Previously paid remaining material is never charged again.

For each required row, `ثبت قیمت سبلان` requires a positive rate and displays no explanation field. `رد جهت اصلاح` requires no rate and reveals a mandatory rejection reason. Rejection returns the same numbered Case with only the rejected row and price-dependent descendants open for correction; unchanged accepted rows remain retained. Any edit that changes a row's Sabalan pricing subject, canonical quantity or calculated Sabalan amount invalidates only the affected pricing evidence. Retail-rate-only, Customer, retail-payment and non-priced Delivery-detail changes do not invalidate Sabalan pricing.

Finalization requires every required row to be approved. The complete price package expires 48 hours after the final required approval. Expiry preserves the Case number and history but requires one linked successor duty and fresh decisions for all required rows; the responder may compare their own previous rates but no rate carries forward silently.

The explicit `نهایی‌سازی خرید از سبلان و ایجاد قرارداد مشتری` action shows the Partner the retail total, Sabalan purchase total and resulting Sabalan debt and requires deliberate confirmation. One successful idempotent finalization allocates the customer-Contract and internal Sabalan-record identities and numbers, creates and seals the exact linked pair, snapshots both prices and calculations, fixes the Partner's Sabalan debt, and queues only the internal record for Sabalan Accounting. The ordinary retail-only Customer confirmation, signature, PDF and sending flows become available only afterward. Customer rejection or collection failure does not erase the Partner's debt; post-commit cancellation follows formal voiding.

The Partner sees both price calculations for their own Cases. Dual-price comparison and margin across Partner records are available only to a system Administrator or a company-management user with explicit Partner-economics reporting permission. The responder sees only their Sabalan quote, and Sabalan Accounting sees only the Sabalan receivable and Partner-to-Sabalan payments.

The Partner dashboard keeps Customer collections separate from Sabalan Accounting. Partner-recorded Customer receipts are append-only private evidence with linked reversal or adjustment rather than edit or deletion. The dashboard presents current Sabalan debt, current Customer receivables and actual Customer receipts through distinct cards and balance-versus-flow charts with drill-down to their contributing evidence. Ordinary Accounting access does not reveal private Customer receipts or retail receivables.

All structured numeric inputs across the platform accept Persian, Arabic, Latin or mixed digits and normalize immediately to canonical Latin values in field state, validation, API transfer and persistence, while identifier-shaped values remain strings and preserve leading zeroes. The server independently enforces the same boundary.

This ADR supersedes ADR-0059 where it defines reusable catalog-subject approvals, independent inquiry creation, square-meter pricing for every cut-stone family, or Customer workflow before Case-scoped pricing. It supersedes ADR-0060 where the first numbered save allocates all three identities, creates both linked shells, or permits customer output and confirmation before pricing and Partner finalization. It supersedes ADR-0046 only where Final Submit creates the complete pair before this pricing boundary or customer signature/print triggers commercial commitment. ADR-0046 continues to govern the single aggregate root, one canonical Product Graph, exact linked pair, immutable stable row identities, projection integrity, correction and voiding. ADR-0058 continues to govern effective Sales authority and audited management takeover.

## Consequences

- Existing finalized Partner records and their evidence remain immutable; legacy reusable inquiries become read-only history and cannot authorize a new Case.
- A deterministic open legacy Draft may be promoted into the new Case model; an ambiguous Draft remains recoverable and requires Partner review and fresh pricing rather than guessed migration.
- Pricing submission, row decisions, correction, package expiry, re-request and finalization require append-only evidence, expected Case revision, command identity and idempotent atomic boundaries.
- The customer-facing projection, responder duty, Accounting projection, dashboard reporting and every notification must use purpose-specific allowlists; hiding fields only in the interface is insufficient.
- Tests must prove family-unit calculations, identical ancillary components, no double charge for remaining material, per-row invalidation, partial rejection recovery, 48-hour package expiry, number-allocation boundaries, retry safety, absence of pre-finalization debt or customer exposure, two-price confidentiality, private-receipt isolation and Persian/Arabic numeric normalization.

## Rejected alternatives

- Reusable rate approvals were rejected because they detach a responder decision from the exact commercial Case and permit stale or context-free pricing to cross Customers and Contracts.
- Letting the responder see the Partner retail price was rejected because it is unnecessary for Sabalan's quote and exposes private resale economics.
- Allocating all record numbers or sending a Customer draft before pricing was rejected because it creates misleading contractual artifacts before the Partner knows and deliberately accepts the Sabalan obligation.
- Letting the Partner manually enter ancillary prices was rejected because it would create two calculation engines and allow customer and Accounting projections to drift.
- Treating Customer receipts as Sabalan Accounting receipts was rejected because the Partner, not Sabalan, owns the retail collection relationship and risk.
