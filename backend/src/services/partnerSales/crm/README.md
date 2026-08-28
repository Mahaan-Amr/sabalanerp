# Partner technical catalog producer — issue 317 subset

`createPartnerTechnicalCatalogReader(transaction, { actorId, correlationId })`
implements public `PartnerTechnicalCatalogPort` from contracts 1.4.0. Call within
the existing shared Prisma transaction. No runtime route is mounted here.

The reader binds the authenticated actor to their current Profile and invokes
the same audited pre-Case read policy before querying and after IO. This is the
Partner form's catalog, not a replacement for internal Inventory access. Pending,
terminated, inactive and internal-only identities cannot use it; a suspended
Partner keeps read-only access. The request cannot supply actor or permission
context. Creation, editing and save still require their independent mutation
authority and lease gates.

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
