# Partner CRM and technical catalog producer — issue 317

`createPartnerCrmService` is the single transactional boundary for Partner-owned
Customer, Project, follow-up and next-action reads/writes. The authenticated
routes live under `/api/crm/partner/**`; they do not reuse ordinary CRM response
objects. Every command decodes a strict input, recomputes its canonical payload
hash, authorizes inside the write transaction, uses optimistic revision checks
and records a replay-safe outcome. Partner Customer and nested CRM writes also
have database guards, so bypassing the service fails closed.

Duplicate lookup returns only name, person type, city and a masked four-digit
witness. Its short-lived opaque evidence can request a transfer. A decision is
retained as append-only evidence and notifies the current owner with fixed,
in-app-only text. Approval changes only Customer ownership; Project
responsibility, follow-up history, Case ownership and sales credit are not
rewritten. Approval is blocked while the previous owner has an unresolved Partner
Case; its cancellation/remediation workflow must finish first. Retained
prior-owner Projects and their follow-ups remain available to that responsible
seller through ordinary CRM, but are excluded from the new Partner owner's
positive projection. Ordinary Customer list/detail/count/search responses exclude
Partner-owned roots and continue to serve ordinary Customer data through their
existing rules.

Project status, work type and communication type use the closed Persian CRM
vocabulary. A Partner cannot directly mark a Project `برنده شده`; only the
existing Sales Contract linkage owns that transition. `از دست رفته` requires a
lost reason, while `راکد` requires a dormant reason and may carry a revisit date.

The migration adds Partner revision/CAS fields, immutable match/transfer/event
evidence and transaction-local owner/transfer guards. It does not change an
ordinary Customer until an approved transfer binds that Customer to an active
Partner Profile. Public contracts 1.9.0 keep wire schemaVersion 1 and add only
the v2 CRM action vocabulary plus the inferred masked-match type.

## Technical catalog

`createPartnerTechnicalCatalogReader(transaction, { actorId, correlationId })`
implements public `PartnerTechnicalCatalogPort` from contracts 1.5.0. Call within
the existing shared Prisma transaction. The authenticated technical transport
mounts this reader at `/api/partner/technical/catalog/query`; central Partner UI
composition and navigation remain closed.

The reader binds the authenticated actor to their current Profile and invokes
the same audited pre-Case read policy before querying and after IO. This is the
Partner form's catalog, not a replacement for internal Inventory access. Pending,
terminated, inactive and internal-only identities cannot use it; a suspended
Partner keeps read-only access only while enrolled in exactly one active release
cohort. Operational pause preserves that enrolled read path but blocks technical
mutations. The request cannot supply actor or permission context. Creation,
editing and save still require their independent mutation authority and lease gates.

Queries use positive Prisma selects, then the existing explicit technical
projectors and strict public schema. Product family eligibility, active/deleted
state and safe name/code search are applied in SQL before cursor pagination.
Cursor is a stable id, not permission. No count or raw entity is returned.
Available=false remains a visible availability fact, not a made-up price/rule.
Empty eligible results are valid. Invalid stored technical facts fail closed.

TOOL uses SubService, FINISHING uses StoneFinishing and LAYER uses LayerType;
only their current names, ids, versions and calculation units are selected.
Inventory currently has no persisted finishing incompatibility relation, matching
the existing catalog's absent `incompatibleWithIds`; the producer returns an empty
list, not invented conflicts. Canonical preview/save still enforce any explicitly
supplied incompatibility evidence; adding configured Inventory relationships
requires its authoritative producer/schema rather than a UI-only list.

No rates, price policy, images, notes or customer data cross the current strict
technical catalog shape. Full presentation parity may need an explicitly
versioned safe display extension; it is not simulated by exposing raw Inventory.
Private graph/pricing evidence production, full CRM ownership/transfer workflows,
transport and UI binding remain their respective #317/#320/#330/#334 work.

Seven focused tests (four real existing-local-DB tests plus three projection
tests) cover pagination, family eligibility/prepared compatibility, units,
confidentiality/search, current lifecycle and forged authority. All fixture data
is rolled back, including retained Profile/audit evidence. No migrations,
ordinary inventory endpoint changes, deployment or activation in this slice.
