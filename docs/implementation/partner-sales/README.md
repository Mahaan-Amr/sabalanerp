# Partner shared contracts 1.0.0

Foundation delivery for [#313](https://github.com/Mahaan-Amr/sabalanerp/issues/313), within [Epic #311](https://github.com/Mahaan-Amr/sabalanerp/issues/311). This is buildable contract/fixture acceptance, **not** runtime, database, UI or release acceptance. Integration is #334, combined QA #335, release readiness #336.

## Consume and verify

```sh
npm run install:all
npm run build:partner-sales-contracts
npm run typecheck:partner-sales-contracts
npm run test:partner-sales-contracts
npm --prefix backend run test:partner-sales-contracts
npm --prefix frontend run test:partner-sales-contracts
npm run test:contract-product-graph
```

Package: `@sabalanerp/partner-sales-contracts@1.0.0`; wire `schemaVersion: 1`; hash `sha256-v1`. Public entry `src/index.ts` compiles to CommonJS + declarations; Node16/backend and Bundler/ES5 frontend consumers are typechecked. `/testing` exports synthetic fixtures, a fixed clock, sandbox notifications and a read-only query adapter. It cannot activate, commit or send SMS. No database, Prisma client or environment secret is read by this package.

Backend/frontend manifests expose consumer-test scripts only. Production dependency/Docker copying must land together under #334; no new service import or missing Docker file dependency is introduced now. The graph package is a real dependency of this package, not a copied geometry model.

## Interface and invariants

| Surface | Contract | Owner |
| --- | --- | --- |
| Aggregate identity | `PartnerSaleCaseSchema`, `CaseGraphRefSchema` | #315 constraints, #320 writes |
| Command/query | `PartnerCommandSchema`, `PartnerQuerySchema`, `PartnerCommandPort`, `PartnerQueryPort` | Command owner + #334 transport |
| Inquiry | `InquiryIdentitySchema`, `ApprovedInquirySchema`, `InquiryUsageSchema`, `InquiryBatchResultSchema` | #318 |
| Authority | `PermissionContextSchema`, `PartnerAuthorizationPort`, `checkPartnerDomainRestrictions` | #319 CENTRAL policy |
| Views | `CustomerContractOutputSchema`, `PartnerCaseViewSchema`, `SabalanInternalRecordViewSchema`, `FulfillmentViewSchema`, account/profile/inquiry/duplicate DTOs | Purpose owner |
| Events | `PartnerEventSchema`, `CorrectionOpportunitySchema` | #321/#322/#324/#328/#329 |
| Adapters | `bindCanonicalCaseGraph`, Accounting/fulfillment/output ports, clock/calendar, notification gateway | Named consumer lanes |

### Exact pair and graph

The Case alone owns one canonical graph and one optimistic commercial revision. Its internal record is explicitly `SABALAN_TO_PARTNER`, never a second `SalesContract`; customer kind is `PARTNER_CUSTOMER`. Links, three business numbers, creator/responsible seller/credit owner and stable row identities are immutable. The schemas reject a missing half, mismatched owner/revision/hash, duplicate row identities or non-Partner attribution. Persistence must additionally enforce these across transactions and history; validation does not replace database constraints.

`CaseGraphRefSchema` is a reference to the Case-owned immutable snapshot, not a writable reduced graph. `bindCanonicalCaseGraph` invokes the existing canonical graph parser and preserves every row ID; no alternate pricing/cutting model is introduced. Price, geometry, processing, tools, remainder children and deliveries must resolve through that single graph. The graph mutation counter may differ from the encompassing Case revision. Production adapters must never derive stable row identity from catalog identity or position.

### Commands, revisions and idempotency

Every command has schema version, command/correlation identity and actor/operation/target/key/payload-hash idempotency scope. Case mutations carry expected Case revision/hash/state. Inquiry submit takes `PartnerConfigurationRefSchema`, an owner-private technical recovery/row reference; it never asks the Partner to send internal rates or policy inputs. Case submit takes `PartnerDraftSubmissionRefSchema` from private recovery plus `approvedRowBinding` (inquiry/row/revision) exposed by the approved Partner inquiry query. The backend resolves and verifies full immutable approval/hash/configuration evidence itself; only the Case owner atomically materializes both records and clears recovery. A draft successor is not a second aggregate.

The server authenticates the actor (never trusts the submitted actor ID), resolves resources and current state under the owning transaction, recomputes intent hash, and checks the durable idempotency ledger. Same scope/key/hash replays the saved result, including partial inquiry outcomes; different intent is `IDEMPOTENCY_CONFLICT`. Ledger persistence, row locking/CAS and concurrency are #315/#318/#320/#321 work. `compareIdempotency` only compares contract identities; it is not a persistence layer. Root target is the Case ID, inquiry ID or profile ID; Final Submit uses a stable recovery-attempt identity, not a new random ID on each retry.

`checkExpectedRevision` returns a safe conflict; it never overwrites stale evidence. Committed revisions are append-only, correction creates a successor, and commitment evidence survives `VOIDED`. Cancellation only before commitment; first authenticated successful SIGNED/PRINTED commits once, OTP/preview/re-download do not. The lifecycle owner, not transport validation, enforces transitions and creates a single realized-sales event.

### Integrity protocol

`canonicalJson` encodes UTF-8 JSON with lexicographically UTF-16-sorted object keys and preserved array order. Only null, booleans, strings, safe integral numbers, arrays and plain objects are accepted. Decimal amounts and quantities are strings; no float, date coercion, locale formatting, tolerance or currency conversion is permitted. `canonicalHash` is SHA-256 of those bytes, prefixed `sha256-v1:`. Producers supply purpose/schema discrimination in hash inputs. The golden vector for `{a:1,b:2}` is tested independently of key insertion order.

Case integrity covers the canonical graph snapshot, frozen party snapshots, inquiry bindings, distinct wholesale/retail envelopes, both payment plans and delivery plan in one versioned evidence object. Hash verification/authenticated provenance is mandatory in the owner; a syntactically valid hash does not prove truth. Snapshot fixtures deliberately use synthetic hashes and must never become production evidence. Customer output uses its **own** hash over allowlisted content (excluding the `outputHash` field itself), not the internal Case hash. `CustomerOutputSnapshotSchema` is private session evidence binding Case revision, recipient, creation/expiry and the content; serialize only its `content` to public/PDF. Snapshot minting/resend/invalidation remains the existing confirmation workflow in #325.

### Inquiry and money

Approval identity includes Partner, catalog product/family, technical configuration, unit, material-rate evidence, all price-bearing components and currency/calculation/rounding versions. Customer, Contract, quantity, delivery and retail price are excluded. Configuration arrays must use a producer-defined deterministic order; evidence hashes bind internal inputs. The final approved wholesale unit price is immutable monetary truth, not recalculated from breakdown. Reuse has no quantity/count decrement.

The approval window is exactly `[DB approvedAt, DB approvedAt + 48h)`, millisecond UTC strings. `checkApprovalUse` tests identity, supersession, termination and that interval; central authorization separately checks current active profile and ownership. Clock never pauses for suspension. Existing Case snapshots do not expire or reprice later. Draft new/configuration-changed rows require fresh approval, quantity/delivery-only successors reuse frozen price evidence. Per-row inquiry outcomes may partially succeed; Case submission must never partially succeed.

Successor inquiry submission includes a predecessor row/revision and mandatory Persian reason. The inquiry owner persists that reason and carries it into approved successor evidence as `supersessionReason`; optional approval notes cannot replace it. Rejection/cancellation of a successor leaves the predecessor approval effective until its natural expiry. The compiled frontend round-trip test builds both submissions only from safe query and recovery fixtures.

Money explicitly declares IRR or IRT; adapters perform only provenance-backed conversion, never infer units from magnitude. Retail discount changes retail only. Resale difference compares net commercial amounts and excludes pass-through tax. Negative retail margin is allowed with confirmation, not reapproval. This package validates payload shape; the existing financial owners retain exact amount/plan reconciliation and enforce it before writes.

`RETAIL_*` receipt/delay/reversal events reference historical retail plan/receipt identities. They are not Sabalan receipts and never reduce the Partner debt. `CASE_COMMITTED` has no official receivable ID; `SABALAN_FINANCIAL_APPROVED` is the later event containing that ID. Adjustments reference original realization and correction with their own effective date. `TehranWorkingCalendar` supplies the existing versioned business calendar; three working days are never approximated by 72 hours.

### Authority and safe output

The #312 approved exceptions take precedence over global ADMIN override: eligible audited assignment for response; no Partner-authored evidence by Admin/management; financial requester cannot process or manager-approve their chain; no implicit ordinary Accounting-originated Partner correction. `checkPartnerDomainRestrictions` is a **denial-only input to #319**, not a parallel resolver. A null result is NOT permission. The trusted central resolver still checks action grant, root/purpose/scope, current profile/assignment, channel, cohort/pause and business eligibility immediately before writes.

Missing/hidden resources collapse to the same 404 body via `publicError`; visible forbidden is 403, lifecycle/dependency conflict 409. Never return raw validator exceptions, payloads, grant mechanics, OTP or tokens to a user/log. `PermissionContext` is server-owned, not a client DTO. Parent authorization roots apply to all child IDs; CRM ownership does not authorize Case economics.

Customer output schemas are recursively strict positive allowlists, not blocklists or entity spreads. Customer gets retail only and no Case/internal number, wholesale, inquiry, margin, raw graph or Accounting facts. Partner gets own final wholesale and retail, not internal construction or record number; Accounting gets internal truth, not retail; fulfillment gets no prices; responder gets inquiry evidence, not Customer economics. HR/profile and masked duplicate DTOs contain no prices. Output/rendering preserves the ordinary confirmation/print flow; this foundation changes no UI.

## Delivery boundaries

See [ownership](ownership.md), [migration sequence](migration-sequence.md), [traceability](traceability.md) and [verification](verification.md). New wire fields/actions go through the shared writer and consumer registry, not ad-hoc local schema extensions. These contracts are the shared initial interface, not an implementation claim for every downstream route, permission, business calculation or gate.
