# Validated technical save module

Approved save/lease/idempotency seam for issues 320/330/334; fixed overall review
baseline `1c93b47f`. Public package 1.4.0 preserves wire schema 1 and the existing
checkpoint/read interface. New `PartnerTechnicalSavePort.save/readSaved` and
schemas/types are exported from the public package root in `technical-save.ts`.

## Guarantees

The backend `createPrismaPartnerTechnicalSaveService` uses the application's
injected Prisma client and one owning transaction. It resolves evidence through
an explicitly injected **trusted owner adapter**, compiles the real canonical
graph, validates every row and dependency, and only then stores the graph,
technical intent, frozen private context, exact inquiry identities and safe
reference projection together in the existing creator-private recovery journal.
There is no new draft store, route, schema migration or runtime registration.

The existing lease row serializes writers. Actor/ownership, current authorization,
browser/token, base revision, recovery revision and seven-day meaningful-change
retention are enforced. Authorization and database-clock lease validity are checked
again after potentially expensive calculation, before writing. A save receipt
shares the same transaction, scoped actor/operation/recovery/idempotency key and
payload hash. It binds the current session incarnation. Retry after a new lease
requires current authority; it returns the original receipt without replacing
newer input. An incomplete checkpoint never acquires a validated reference.

Immutable saved snapshots are retained only inside the protected recovery
lifecycle. They are integrity-hashed and bind exact recovery/revision/row IDs.
Generic checkpoint/read cannot expose or replace them. Historical saved reads
still require the creator's current lease and authority. Discard/expiry uses the
existing recovery lifecycle. Permanent command outcomes retain only version,
session-incarnation ID and saved revision; replay reconstructs the safe receipt
from the protected snapshot while it exists. No draft row content survives in
that permanent outcome. Validated revisions advance above every prior saved
revision for the recovery ID across incarnations, including another actor's old
incarnation, so discard/recreation cannot reissue an old public configuration ref.
Callers must use the returned revision, not assume a consecutive increment after
recreation. No new schema field or global mutable counter is introduced.
Stable row IDs cannot move between families, catalog products, parents, sources,
or stair identities, and a removed saved row cannot be resurrected under its old ID.

Returned quantities are a small allowlisted projection of the canonical compiler:
longitudinal requested meters (not optimizer packing count), slab finished square
meters, stair count, and explicit prepared/legacy-volumetric unit/quantity.
Remainder children retain their canonical longitudinal measure; layers stay owned
by their parent, not invented sale rows. Count is integral. This does not seal or
round Accounting precision and never derives a quantity from money. Multiplication
uses sufficient locally scoped precision without changing global Decimal settings.

`configurationChange` compares exact owner-issued inquiry identity with the
preceding validated save: NEW, UNCHANGED or CHANGED. It is **not** an approval
decision, validity extension or Case identity. A recovery revision alone does not
cause mismatch; quantity-only edits can retain the same identity. No private
identity/hash/context/rate is returned to the Partner.

## Required owner integration and remaining acceptance

`resolveEvidence` must run read-only inside the supplied transaction, preserve
frozen material/component policies for unchanged configuration, resolve real safe
catalog facts, and issue exact `InquiryIdentity` evidence with quantity, Delivery,
Customer, Contract and retail values excluded. The module verifies actor, row,
catalog, family, unit and policy bindings; it cannot infer the producer's semantic
provenance from a hash. The fixture adapter is not production authority. Actual
317/318 producer composition, 319 authorization/grant-lock protocol, authenticated
transport and 334 registration remain required before activation or live use.

Still pending: durable pending inquiry/Case command adapters, owner-issued Case
submission binding, field-addressed save errors for the UI, presentation content,
330 full technical-form binding, real end-to-end and visual acceptance in 335.
This module does not complete issue 320 or 330 and does not authorize deployment.

## Verification

The public wire test rejects authority/private fields, incoherent/duplicate refs,
zero quantity and fractional piece count. The existing-local-Postgres suite
`partnerTechnicalRecovery.integration.test.ts` exercises the real service,
canonical compiler and existing schema: safe reload, historical refs, quantity
successors, incomplete edits, idempotent replay, changed intent, stable identity,
revocation during evidence lookup, expired lease, rollback failpoint and corrupted
private evidence. Owner evidence/authorization adapters are explicit fixtures.

Every test uses a namespaced outer rollback transaction and closes its test client
in finally; append-only receipts are rolled back, never deleted or trigger-bypassed.
The commit-failure test uses a savepoint. These are real-schema behavioral tests,
**not independent committed-connection race acceptance**; that remains a 335 gate.
Full graph regressions, package/type tests, whole backend/frontend typechecks,
ordinary recovery regressions, architecture and independent two-axis review are
required before publication. No running service rebuild is needed for this slice.
