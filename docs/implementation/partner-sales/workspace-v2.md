# Companion workspace contracts — coordinated follow-up

Status: implemented candidate; public-export tests pass. Publication/review evidence
is recorded below when complete. This is not a runtime activation or producer-completion claim.

Requested by #330/#331 under #334 shared ownership, following the #302 inquiry,
#307 conversion, and #309 authorization decisions. The existing strict v1 DTOs,
commands, query port, and testing fixtures remain supported unchanged. Package
1.1.0 adds explicitly named wire-version-2 exports; it does not silently add
fields to v1 responses. A v1 request must still receive v1 output. Unsupported v2
requests fail closed; adapters must not coerce them to v1 or manufacture evidence.

## Inquiry

`PartnerInquiryViewV2Schema` / `PartnerInquiryViewV2` retain the safe v1 display
fields with `schemaVersion: 2`. Each row adds:

- `configurationRef`: `{ recoveryId, recoveryRevision, productRowId }` resolved by
  the recovery/inquiry owner, not reconstructed from catalog IDs or row positions.
- Optional `predecessor`: `{ inquiryId, rowId, revision, reason }` with the
  mandatory Persian supersession reason.
- Optional `successor`: `{ inquiryId, rowId, revision, state }` identifying the
  durable next row, including a pending successor after page reload.

These references do not grant access or guarantee that recovery remains editable.
The recovery owner validates current lease/ownership and may return an explicit
conflict for an unavailable recovery. A pending/rejected/cancelled successor must
not invalidate a still-valid predecessor; only successful successor approval does.
The inquiry owner enforces linear history, one open successor, current status and
transactional concurrency. The browser neither calculates expiry authority nor
supplies internal pricing identity, rates, formula inputs or evidence hashes.

## Management and responder workspaces

The companion query interface exposes `PartnerManagementWorkspaceViewV2`
and `ResponderWorkspaceViewV2`, with schemas and inferred types exported from the
package root. These are server-filtered views, not browser permission contexts.
`ActionAvailabilityV2` describes visible actions; omitted actions are hidden and
availability never replaces server reauthorization inside the write transaction.

Management sections are independently optional according to the actor's explicit
purpose/scope: identity, owner-issued commercial/credit terms options, eligible
responder options, conversion blockers/disposition evidence, and masked CRM
transfer decisions. HR/CRM identity access must not disclose commercial terms or
Case economics. Raw entity spreads and role-local policy fallbacks are forbidden.
Report links remain outside this follow-up pending #326's approved shared export.

`PartnerManagementWorkspaceViewV2` uses purpose `PARTNER_MANAGEMENT`, `actorId`,
`personaLabel`, root `actions`, `profiles`, `transfers`, and optional `nextCursor`.
Optional root `identityCandidates` contains only `identityEvidenceId`/`displayName`
and requires an enabled `PROFILE_CREATE` action. Profile entries contain `profile`
(the v1 gate view), `displayName`, `actions`, and optional sections:

- `identity`: `evidenceId`, `legalName`, `phone`, `address`, `personType`.
- `commercialTerms` / `creditTerms`: optional `currentVersionId`, `summary`,
  `options: [{ id, label }]`; option IDs are owner-issued terms versions.
- `responder`: optional `currentId`/`displayName`, `eligibleOptions`, and
  `pendingInquiries: [{ inquiryId, assignmentRevision, label, actions }]`.
  Reassignment uses these exact inquiry references, never the profile ID.
- `conversion`: `started`, `irreversible`, `blockers: [{ id, label }]`, and
  producer-issued `dispositionEvidenceIds`.

Transfers contain `transferId`, `revision`, the v1 masked duplicate `match`, and
`actions`. Identity and commercial/credit sections are separately permissioned;
the schema's capacity to represent a section does not authorize its disclosure.

Responder rows expose explicit state, approval/expiry instants and row actions;
absence of an approved price is never interpreted as a pending state. Assignment
and eligibility are rechecked by the producer. No customer/retail/payment/margin
fields are introduced into the responder view.

`ResponderWorkspaceViewV2` uses purpose `RESPONDER_WORKSPACE`, `actorId`,
`inquiries: ResponderInquiryViewV2[]`, optional `nextCursor`. Each inquiry keeps
the v1 inquiry/assignment/display fields with schema 2, inquiry `actions`, and
normalized rows (not a second parallel row list). Row `state` and `actions` are
required; `approvedAt`, `expiresAt`, `noteOrReason` are optional according to the
explicit state. Approved/expired/superseded rows retain the price and exact 48-hour
validity. Pending/rejected/cancelled rows cannot assert approval or usage evidence.

`ActionAvailabilityV2` contains `action`, `enabled`, optional canonical
`disabledReason` and `expiresAt`. Hidden resources are omitted, not exposed through
a 404 disabled action. `PartnerActionV2` retains v1 actions and adds named
`COMMERCIAL_TERMS_MANAGE` and `PROFILE_CONVERSION_MANAGE`; the companion
`PartnerAuthorizationV2Port` is implemented by the central policy owner. Do not
route a new action through the v1 denial helper by casting or ignoring validation.

New management commands use a separate `PartnerManagementCommandV2Port`; existing
v1 lifecycle, inquiry and transfer commands retain `PartnerCommandPort`. New
commands refer to owner-issued identity, terms or disposition evidence instead of
allowing callers to assert activation gates. #316/#317/#318/#319 must implement
the producer/authorization adapters before integration is enabled by #334.

`PartnerQueryV2Schema`, `PartnerQueryV2`, `PartnerQueryV2Results`, and
`PartnerQueryV2Port` are separate from their v1 counterparts. Queries use schema 2:
`PARTNER_INQUIRY` / `RESPONDER_INQUIRY` take `inquiryId`; `PARTNER_MANAGEMENT` /
`RESPONDER_WORKSPACE` take optional opaque `cursor` and `limit` (1–100). Producers
filter before pagination. They bind the authenticated actor rather than accepting
actor/scope/permission inputs from the query.

All new management commands carry schema 2, `commandId`, `correlationId`, scoped
`idempotency`, and mandatory Persian `reason`:

| Command | Payload | Central named action |
| --- | --- | --- |
| `PROFILE_CREATE` | `identityEvidenceId` | `PROFILE_CREATE` |
| `IDENTITY_VERIFY` | profile + `evidenceId` | `IDENTITY_VERIFY` |
| `COMMERCIAL_TERMS_SET` | profile + `termsVersionId` | `COMMERCIAL_TERMS_MANAGE` |
| `CREDIT_TERMS_SET` | profile + `termsVersionId` | `CREDIT_TERMS_MANAGE` |
| `RESPONDER_ASSIGN` | profile + `responderId` | `RESPONDER_ASSIGN` |
| `PROFILE_CONVERSION` | profile + `transition: START/ABANDON/RESOLVE`, `dispositionEvidenceIds` | `PROFILE_CONVERSION_MANAGE` |

Here "profile" means `profileId` and `expectedRevision`. Idempotency target is
`identityEvidenceId` for creation and `profileId` otherwise. Resolution requires
at least one owner-issued disposition reference; the owner validates whether the
references actually resolve every blocker. Execution returns only
`{ commandId, replayed, profileId, revision, eventIds }` inside `Result`, not a raw
profile entity. Existing v1 `PROFILE_TRANSITION`, `INQUIRY_DECIDE`,
`INQUIRY_REASSIGN`, and `CUSTOMER_TRANSFER_DECIDE` remain unchanged.

Every named schema above exports its inferred TypeScript type from the package
root. `/testing` adds `createPartnerWorkspaceFixturesV2()` returning `inquiry`,
`responder`, `management`, `responderWorkspace`, and `FixturePartnerQueryV2Adapter`
with an explicit allowed-purpose list. Queries return clones, reject unavailable
purposes/IDs and unsupported cursors, and never mutate or activate. V1 fixtures
and adapters are unchanged. Synthetic evidence IDs are not production authority.

## Packaging and publication

Production consumers import `@sabalanerp/partner-sales-contracts`; tests may use
the explicit `/testing` entry. No source-path alias or backend-source import is a
replacement for the dependency. Frontend/backend manifests and locks, Docker
package copying, graph-before-contract compilation, and runtime retention of both
linked packages must land together. Build dependencies are pruned only after both
packages compile. No Compose/service/health/deployment/backup/recovery/maintenance
behavior changes are included; #333 has reviewed this narrow scope.

The package also publishes a `typesVersions` entry for `/testing`, since the
backend uses legacy `moduleResolution: node` rather than exports-aware Node16.
`npm run typecheck:backend:legacy` in the package compiles the public consumer at
`backend/contract-tests/partner-sales-public.ts` through the installed backend
dependency (no source aliases). It requires backend dependencies to be installed
and is included in `test:consumer:backend`; standalone package typecheck remains
independent of application installation. No backend tsconfig change is needed.

#314 retains its exact 1.0.0 final verification candidate until publication. Its
owner then updates the harness pin for 1.1.0 while retaining wire-v1 regression
coverage. Shared index and origin/main publication are serialized: #314, the
isolated remaining-stone release, then this follow-up. No local runtime is rebuilt
while another task owns its verification window.
