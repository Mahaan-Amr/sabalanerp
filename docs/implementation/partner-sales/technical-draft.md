# Safe technical draft and catalog — additive contracts 1.2.0

Approved seams: canonical technical preview and safe catalog/input/result, with
review baseline `1c93b47f`. This is a prerequisite slice for 317/320/330/334, **not
completion of those issues**. No route, runtime registration, database schema or
activation changes are included.

## Public interface

Use only `@sabalanerp/partner-sales-contracts` and its `/testing` export:

- `PartnerTechnicalCatalogPort` has a distinct `PARTNER_TECHNICAL_CATALOG` purpose.
  Product and operation pages are strict allowlists. Catalog snapshot versions
  are public inventory timestamps, not private price/configuration hashes. Width
  and thickness are centimetres; inventory mother length is already metres.
- `PartnerTechnicalDraftSchema` preserves canonical intent and stable IDs for
  prepared/legacy volumetric, longitudinal, slab, independent stair parts,
  layer configurations, remainder children, operation groups and overrides.
  Optional `stairSystems` retain step/staircase input; explicit per-part manual
  quantities remain independent. Landing quantity never derives from total steps.
- `previewPartnerTechnicalDraft(draft, catalog)` is pure and non-persisting.
  Its outer `ok` means the payload decoded, **not** that the graph is valid.
  Inspect global `conflicts`, each row/dependent `calculation`, and each optional
  operation result. Failed previews can retain valid sibling/physical facts.
  `inputRevision` only correlates asynchronous previews; it is not a server revision.
- `/testing`: `createPartnerTechnicalCatalogFixtures` and
  `FixturePartnerTechnicalCatalogAdapter` use explicit safe catalog data and the
  same real canonical calculations. They are not authorization/readiness adapters.

`editingValues` retains unfinished field text separately from last canonical
values. Any pending entry blocks later validation; completing the normal
unit-aware field parse must explicitly clear it. Unknown/private field names are
rejected. Missing/negative geometry is not replaced by guessed values or rates.
No preview issues a `PartnerConfigurationRef` or a Case graph hash.

## Canonical ownership

All geometry, quantities, packing and operations come from the shared graph
package. There is no `bindCanonicalCaseGraph` call, monetary DTO or fake rate in
the browser-facing module. Catalog operation units/incompatibilities are resolved
by exact safe catalog identity/version, not supplied as editable financial facts.

Parent calculations materialize their real remainder inventory. Layer/remainder
events use the same `compareProductDependentOrder` as priced graph writes, including
equal-order kind/identity ties. Successful physical geometry reserves its consumed
stock even when a layer operation remains invalid, so subsequent preview facts do
not spend the same piece twice. This is an invalid editing preview, never a partial
persistence commitment. Duplicate graph identities block every ambiguous owner.
This includes canonical automatic no-operation groups. Layer-side collections
provide their own scope identity; ordinary priced product calls retain their
existing row-based IDs. When blocking an ambiguous allocation frees stock for a
later sibling, the preview rechecks newly usable identities until no new owner
is blocked. Unaffected editing facts remain available.

Layers bind only to their own stair parent; parent-material source identity/version
must match that parent's snapshot. Explicit new material remains a distinct choice.
Paid/fresh priority and strip quantities are canonical. Layer side operations reuse
canonical side/scope validation and actual strip facts without running packing twice.
Remainder children retain witnessed source-piece distributions and secondary-owner
intent, with canonical parent/catalog/source eligibility and ordered consumption.

Stair manual mother length is independent per part. Blank remains blank and derives
effective source length from finished length; catalog mother length never seeds it.
Manual mother length and its display unit survive edits. Stock width still comes
from the exact safe catalog snapshot.

## Producer and completion boundaries

`backend/src/services/partnerSales/crm/technicalCatalog.ts` is an allowlist projection
only. The real producer must authorize before selecting/counting/paginating data;
IDs and public timestamps confer no access. Historical snapshots must be retained
by the owning recovery/Case adapter, not silently refreshed or repriced.

Remaining work includes durable version/lease/idempotent checkpoint and validated
save on existing recovery; server-owned private pricing/configuration evidence;
bounded worker/transport execution; complete 330 UI binding and visual acceptance;
real authorization/CRM/inquiry/Case composition; 334 integration and 335 acceptance.
Standalone service rows, authenticated catalog routes and private pricing are not
implemented by this technical product preview. No issue is closed on this evidence.

## Checks

The new public tests were introduced red before implementation. Run:

```
npm --prefix packages/partner-sales-contracts test
npm --prefix packages/partner-sales-contracts run typecheck
node packages/partner-sales-contracts/node_modules/tsx/dist/cli.mjs --test backend/src/routes/__tests__/partnerCatalogProjection.test.ts
npm --prefix packages/contract-product-graph test
npm --prefix packages/contract-product-graph run test:remaining-recovery
node --test tests/partner-sales/foundation-contract.test.mjs
node scripts/run-partner-sales-tests.mjs unit
node scripts/run-partner-sales-tests.mjs check-inventory
```

The exact-pin change preserves the schemaVersion 1 rejection guard. Prior QA
evidence is historical and is not relabelled as acceptance of this new slice.

Candidate verification: all 46 package tests (24 existing, 3 catalog, 19 technical
draft) and both package typechecks pass; all 3 backend catalog projection tests
pass. Full graph suites and remaining-child recovery pass. The read-only comparison
of 62 complete priced results/hashes against the published remaining-stone graph
remains identical. Foundation 3, harness unit 7 and unchanged inventory freshness
pass after initializing the existing pinned Inquiry gitlink in the isolated worktree.

Independent review found two concrete gaps: parent-material selection checked the
parent but not the actual stock's catalog identity, and identity inspection omitted
nested operation/group/collection IDs. Both have public-seam regression tests and
are corrected before publication. The former now preserves a different stone's
remaining inventory rather than relabelling it; the latter marks all affected
owners across base rows, remainder children and layer sides.
The follow-up review also caught generated no-operation identities, now covered
by product-to-product and layer-to-product collision regressions plus independent
layer-side automatic-group checks.
