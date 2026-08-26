# Partner Sales, CRM, and Access Boundary Audit

## Purpose and source baseline

This note resolves the research question in **«ممیزی مرزهای فعلی فروش، CRM و دسترسی Partner»** for the **«نقشه طراحی کانال فروشنده همکار»** map. It describes current production behavior, not the proposed Partner model.

The audit uses only primary repository sources at `origin/main` revision `602923ebd1fac3234eea3dd5dea7021f4ebd541b`: Prisma schema and migrations, backend routes and services, accepted ADRs, tests, and the production glossary. The local checkout was behind that revision and contained unrelated dirty changes, so evidence was read directly from the Git object database. No runtime or product code was changed.

## Decision-grade conclusion

The current system does **not** have a Partner Seller security principal or lifecycle. It has an ordinary active `User`, mutable per-user/per-role workspace and feature grants, an optional `CrmCustomer.ownerUserId`, department-scoped Sales Contract access, and separate Responsible Seller/realized-credit attribution. These pieces are useful seams, but they do not compose into an owner-only Partner boundary.

The most important consequence for the new specification is that Partner access cannot be expressed by assigning an existing broad role or by reusing `customerType = Collaborative`. It needs an explicit Partner profile and activation state, centralized subject-plus-resource authorization, and a Partner Sale Case aggregate whose two linked commercial records have separate projections. Until those exist, several current routes permit cross-owner disclosure or linking even though the customer list looks owner-scoped.

## Current boundary by concern

| Concern | Current authoritative state | Current enforcement |
|---|---|---|
| Customer ownership | `CrmCustomer.ownerUserId` is an optional mutable foreign key; `createdBy` and `updatedBy` are also optional. Deleting a User sets ownership to null, and no transfer-request or owner-history relation exists (`backend/prisma/schema.prisma:1937-1990`). | New Customers are assigned to the creator (`backend/src/routes/crm.ts:831-868`). List and duplicate-check queries scope every non-ADMIN actor without owner-assignment permission to `ownerUserId = actor` or legacy unowned rows created by that actor (`backend/src/routes/crm.ts:14-25`, `backend/src/routes/crm.ts:476-513`). An actor with either CRM or Sales owner-assignment permission becomes globally unscoped (`backend/src/routes/crm.ts:92-97`). |
| Contract identity and attribution | A Sales Contract stores distinct `createdBy`, `responsibleSellerId`, `realizedSellerId`, `customerId`, and `departmentId` (`backend/prisma/schema.prisma:1737-1780`). ADR-0011 makes responsible seller distinct from technical creator and freezes realized credit at first realization (`docs/adr/0011-stable-sales-attribution-and-reporting-events.md:15-21`). | CRM conversion defaults responsibility from the Potential Project; other creation defaults it from the creator (`backend/src/services/contractService.ts:674-709`, `backend/src/services/contractService.ts:756-772`). Realization snapshots the then-current responsible seller and emits an idempotent reporting event (`backend/src/services/salesAttributionService.ts:7-42`). Reassignment is Sales-admin-only, same-department, reasoned, and audited (`backend/src/routes/sales.ts:1581-1605`, `backend/src/services/salesAttributionService.ts:120-148`). |
| Contract access | There is no owner or Partner scope on the Contract model. | Sales list/detail/edit access is ADMIN-or-department, and a User with no department receives flexible global access (`backend/src/routes/sales.ts:589-614`, `backend/src/services/contractService.ts:1303-1322`). Sales reporting is narrower: ordinary Users see contracts where they are creator, Responsible Seller, or realized seller (`backend/src/services/salesReportingService.ts:202-256`). Thus reporting scope and operational Contract scope answer different authorization questions. |
| Sales/CRM permissions | Non-HR authorization is stored as string-valued direct and role workspace/feature grants with active and optional expiry state (`backend/prisma/schema.prisma:1673-1734`). `ADMIN` is the only schema-level global override; `UserRole` has no Partner role (`backend/prisma/schema.prisma:4408-4414`). | CRM Customer endpoints deliberately accept either CRM or Sales customer features (`backend/src/routes/crm.ts:371-398`, `backend/src/routes/crm.ts:476-479`, `backend/src/routes/crm.ts:693-706`). Ordinary feature middleware may inherit a whole workspace grant, while narrow-feature resolution treats a direct feature grant as a narrowing override and grants workspace-admin oversight (`backend/src/middleware/feature.ts:724-812`, `backend/src/services/narrowFeatureAccess.ts:14-38`). |
| Partner activation | No `PartnerProfile`, Partner commercial account/debtor identity, price responder assignment, Partner activation status, price inquiry, or Partner Sale Case exists in the production schema or backend. `Collaborative` is only an accepted CRM customer type and the existing collaboration Contract mode is a sales-kind distinction, not an external-seller identity (`backend/src/routes/crm.ts:984-989`; `CONTEXT.md:370-380`). | The only general login gate is `User.isActive`; inactive Users are rejected by authentication (`backend/prisma/schema.prisma:11-24`, `backend/src/middleware/auth.ts:20-51`). User creation defaults `isActive` to true, and both ADMIN and MANAGER may create accounts; a MANAGER may assign any non-ADMIN system role and non-admin-level workspace grants (`backend/src/routes/users.ts:155-204`, `backend/src/routes/users.ts:215-228`, `backend/src/routes/users.ts:298-317`, `backend/src/routes/users.ts:395-417`). Managers may also toggle another non-ADMIN User's active state; deactivation revokes sessions (`backend/src/routes/users.ts:663-705`, `backend/src/routes/users.ts:737-794`). |
| Cross-workspace Contract use | Workspace ownership is expressed at the consuming route, not as one universal Contract ACL. | Accounting requires Accounting workspace plus Accounting Contracts feature access, then lists and opens Contracts without seller, customer-owner, or department filtering (`backend/src/routes/accounting.ts:152-170`, `backend/src/routes/accounting.ts:479-506`, `backend/src/services/accountingService.ts:975-1017`, `backend/src/services/accountingService.ts:1255-1275`). Logistics similarly derives financially approved Contract items by Customer/Project for loading rather than by seller ownership (`backend/src/routes/logistics.ts:217-255`). This is appropriate operational cross-workspace access, but it proves that `ownerUserId` must not become a universal filter. |

## Concrete leakage and coupling gaps

### 1. Customer list scoping is bypassed by direct detail reads

`GET /api/crm/customers/:id` requires a CRM-or-Sales Customer view feature but performs an unscoped `findUnique` and returns contacts, phone numbers, projects, Leads, communications, and recent Sales Contracts. It never calls `ensureOwnershipOrDeny` (`backend/src/routes/crm.ts:607-683`). By contrast, update routes do call the owner check (`backend/src/routes/crm.ts:1017-1022`). Any owner-scoped User who learns a Customer id can therefore read substantially more than the list route exposes.

This is the clearest current cross-owner disclosure seam and must be closed before Partner accounts receive production access.

### 2. Duplicate handling is inconsistent and over-disclosing

The explicit duplicate-check endpoint applies the caller's owner scope (`backend/src/routes/crm.ts:371-381`), so it cannot warn a Partner about a duplicate owned by somebody else. The create endpoint instead runs the same duplicate search with no scope and returns the full suggestion projection on conflict (`backend/src/routes/crm.ts:788-797`). That projection includes national code, owner identity, every active phone, full project addresses, project manager/marketer phone numbers, and counts (`backend/src/routes/crm.ts:245-294`).

The new specification needs one server-owned duplicate policy with a minimal cross-owner DTO and an explicit transfer-request action. It must neither hide the duplicate completely nor return the current rich suggestion object.

### 3. Customer ownership does not protect relationship creation

Potential Project creation checks that the Customer exists but not that the actor owns or may use it (`backend/src/routes/crm.ts:2101-2133`). Follow-up creation has the same gap when no Potential Project is supplied (`backend/src/routes/crm.ts:2317-2359`). Sales Contract creation checks Customer/Project identity consistency but not actor-to-Customer authority (`backend/src/routes/sales.ts:940-1002`, `backend/src/services/contractService.ts:682-709`). An actor with a leaked or guessed Customer id can therefore attach new CRM or Sales records to another owner's Customer.

The existing Contract Party Identity validator is valuable but answers only referential and snapshot consistency: Customer id, embedded Customer, rendered name, and Project ownership must agree (`backend/src/services/contractPartyIdentity.ts:58-97`). It must be followed by a separate resource-authorization check; it cannot substitute for one.

### 4. Current Customer scoping is coupled to permissions, not actor kind

`isOwnerScopedUser` means every non-ADMIN actor, not specifically a Partner Seller, and `canAssignCustomerOwner` removes the scope entirely (`backend/src/routes/crm.ts:14-25`, `backend/src/routes/crm.ts:92-97`). This conflates two questions:

1. Is this actor an external Partner who must always remain owner-scoped?
2. Does this internal actor have authority to assign or transfer Customer ownership?

The Partner specification must make Partner subject type/profile authoritative. A Partner must not escape owner scope merely by acquiring a generic owner-assignment feature, while ordinary internal Sabalan sellers must retain the intended internal visibility policy.

### 5. Contract operational access is department-wide, not responsibility-wide

The Contract list filters by department, and `validateContractAccess` grants every same-department User access; Users without departments receive global access (`backend/src/routes/sales.ts:589-614`, `backend/src/services/contractService.ts:1303-1322`). Creation validates only the requested department against the actor's department (`backend/src/routes/sales.ts:978-985`). Neither Customer owner nor Responsible Seller participates.

This is incompatible with “Partner may view and use only their own Customers and related Contracts.” It is also dangerous to solve by changing `validateContractAccess` globally, because Accounting and Logistics legitimately require broader, purpose-specific Contract projections.

### 6. Responsibility, Customer ownership, and access can drift independently

Potential Projects have their own Responsible Seller and expose detail to that seller or CRM management (`backend/src/routes/crm.ts:216-242`). Contract creation then copies the project's Responsible Seller even when another User creates the Contract (`backend/src/services/contractService.ts:695-709`, `backend/src/services/contractService.ts:756-768`). Neither operation checks that the project's responsible seller owns the Customer. Customer owner, project seller, Contract creator, Contract responsible seller, and Contract department can therefore be mutually inconsistent while still satisfying current validators.

The new Partner invariant should be explicit and transactional: at creation, Partner User = Customer owner = Contract creator = Contract Responsible Seller, while the internal price responder remains a separate assignment with no ownership or sales-credit consequence. Existing realized-credit behavior should remain unchanged because it already snapshots Responsible Seller rather than responder or approver (`backend/src/services/salesAttributionService.ts:17-40`).

### 7. Authorization is not yet resolved through one production seam

Accepted ADR-0044 requires one backend-effective authorization result, including provenance and expiry, with no frontend precedence logic (`docs/adr/0044-centralize-authorization-and-accounting-originated-corrections.md:7-11`). Current non-HR paths still mix:

- workspace middleware with direct-then-role fallback (`backend/src/middleware/workspace.ts:47-114`);
- ordinary feature middleware that can inherit workspace permission (`backend/src/middleware/feature.ts:724-812`);
- narrow feature evaluation with different narrowing and workspace-admin rules (`backend/src/services/narrowFeatureAccess.ts:14-38`); and
- `getEffectiveUserAccess`, used by reporting and other projections (`backend/src/services/effectiveAccessService.ts:72-158`).

A Partner feature bundle layered onto these route-specific resolvers can yield different answers between navigation, list, detail, and action routes. The spec should require all Partner route guards and UI capabilities to consume one centralized decision containing subject kind, workspace/feature/action permission, resource relationship, provenance, expiry, and denial reason.

### 8. `User.isActive` is insufficient Partner activation

An active account proves only that authentication may proceed. It does not prove a commercial debtor identity, legal fields, Admin approval, assigned price responder, Partner permission bundle, or completed audit evidence. Because user creation defaults active and MANAGER can activate non-ADMIN accounts, mapping Partner activation onto `User.isActive` would allow bypass of the intended Admin-owned commercial gate (`backend/src/routes/users.ts:155-228`, `backend/src/routes/users.ts:663-705`).

Partner activation therefore needs a distinct lifecycle. `User.isActive` should remain the login/session switch; Partner profile status should decide whether Partner actions are available. Deactivation should revoke Partner capabilities immediately and preserve Customer/Contract history, while ordinary account deactivation continues to revoke sessions (`backend/src/routes/users.ts:749-794`).

### 9. Existing public confirmation is a one-record projection and would leak mixed economics

Public access is possession-based: a long token or a Contract number plus matching phone selects an active confirmation session (`backend/src/routes/public-contracts.ts:8-31`, `backend/src/services/contractConfirmationService.ts:175-227`). The serializer returns the Contract's full `contractData`, total, items, deliveries, and payments (`backend/src/services/contractConfirmationService.ts:103-131`). That is coherent for one ordinary Sales Contract, but it is unsafe if a Partner case stores Sabalan buying price and Partner retail price together or reuses one mixed `contractData` payload.

The Partner customer-facing Contract needs an explicit public DTO that excludes the Sabalan-to-Partner record, approved inquiry price, and resale difference. The internal record needs a separate Accounting projection.

### 10. Tests establish narrow helpers, not the full security boundary

Current Customer-scope coverage asserts only three pure helper outcomes (`backend/src/routes/__tests__/crmCustomerScope.test.ts:1-8`). Contract Party Identity tests validate snapshot/relation consistency but do not test actor ownership (`backend/src/services/__tests__/contractPartyIdentity.test.ts:17-68`). Sales reporting tests prove personal reporting uses creator/responsible/realized relationships (`backend/src/services/__tests__/salesReportingFoundation.test.ts:96-108`), but that scope is not reused by operational Contract routes.

The Partner specification must require route-level negative tests for id enumeration, cross-owner reads and writes, Customer-to-Project/Contract linking, duplicate disclosure, expired/revoked grants, inactive Partner profiles, public output leakage, and cross-workspace projections.

## Authoritative seams the new specification should build on

### Preserve and extend

1. **Stable Customer identity and owner relation.** Keep `CrmCustomer` as the end-Customer record and `ownerUserId` as the current owner pointer, but add an audited transfer-request/decision history and central scope policy. Do not create a second Partner-only Customer table (`backend/prisma/schema.prisma:1937-1990`).
2. **Creator, Responsible Seller, and realized credit as distinct facts.** These already encode the right sales-attribution vocabulary and audit behavior. Partner creation should set creator and Responsible Seller to the Partner, and the price responder must remain outside both fields (`docs/adr/0011-stable-sales-attribution-and-reporting-events.md:15-19`; `backend/src/services/salesAttributionService.ts:7-42`).
3. **Contract Party Identity validation.** Reuse its relational Customer / embedded Customer / Project consistency rules after resource authorization. Do not weaken them to accommodate Partner flow (`backend/src/services/contractPartyIdentity.ts:58-97`).
4. **Bounded Contract Customer snapshots.** The current sanitizer deliberately freezes Customer facts while excluding recursive CRM collections; tests prove Products, Deliveries, and Payment evidence remain intact (`backend/src/services/contractSnapshotBoundary.ts:62-127`, `backend/src/services/__tests__/contractSnapshotBoundary.test.ts:55-90`). Use this projection discipline independently for both linked records.
5. **Transactional Contract creation.** `createContract` already validates identity, assigns attribution, sanitizes snapshots, writes the Contract, and persists related evidence inside one transaction (`backend/src/services/contractService.ts:674-729`, `backend/src/services/contractService.ts:756-790`). The Partner Sale Case requires a higher aggregate transaction that creates both records and their shared Product Graph or creates neither; do not invoke two independent ordinary create flows.
6. **Central effective authorization direction.** ADR-0044 is the governing seam for route/action/provenance/expiry decisions, and narrow-feature evaluation already demonstrates explicit-feature narrowing and workspace-admin oversight (`docs/adr/0044-centralize-authorization-and-accounting-originated-corrections.md:7-11`, `backend/src/services/narrowFeatureAccess.ts:14-38`). Partner policy should become a first-class resource-scope input to that resolver rather than a route-local role check.
7. **Cross-workspace duty accountability.** ADR-0046 distinguishes shared decisions from individually accountable execution/custody (`docs/adr/0046-use-workspace-scoped-shared-duty-decisions.md:7`). A price inquiry assigned to one internal responder should use an individually accountable duty/assignment with audited Admin reassignment; any genuinely shared approval step should use the shared-decision model. Neither should infer Contract ownership or sales credit.
8. **Purpose-specific cross-workspace projections.** Accounting and Logistics should continue to access the source facts required by their workflows through their own permissions, not through Partner Customer ownership (`backend/src/routes/accounting.ts:152-170`, `backend/src/routes/logistics.ts:217-255`). The Partner Case must designate the Sabalan-to-Partner record as the Accounting and fulfillment source, while the customer-facing record remains a presentation and Partner receivable truth.
9. **Creator-private Draft ownership.** Creation recovery already treats a Draft as private to its creator with one writer lease (`docs/adr/0043-separate-contract-creation-recovery-from-live-ownership.md:3`). Preserve that seam for the Partner wizard, but bind successful completion to the atomic Partner Sale Case rather than to one ordinary Contract.

### Add explicitly; do not infer

The new specification needs explicit persisted concepts for:

- Partner Profile and lifecycle status, linked one-to-one to `User`;
- Partner commercial/debtor identity and activation prerequisites;
- assigned internal Price Responder plus append-only assignment/reassignment history;
- price inquiry request and immutable per-configured-row decisions with validity evidence;
- Partner Sale Case identity linking exactly two commercial records;
- separate Sabalan buying-price and Partner retail-price facts with authorized projections;
- Customer ownership-transfer request and decision history; and
- one centralized resource-authorization result for Partner Customer, Contract, inquiry, case, output, and management-report actions.

None of these should be encoded in `User.role`, `User.isActive`, `customerType`, `contractData` alone, or a broad Sales/CRM workspace grant.

## Required specification invariants exposed by this audit

1. Every Customer, Project, follow-up, Contract, inquiry, case, and output read/write must authorize the actor against the target resource on the server; list filtering alone is insufficient.
2. Partner Customer scope is determined by active Partner identity plus current Customer ownership, not by generic role, department, or owner-assignment permission.
3. Internal managers and operational workspaces receive explicit purpose-bound projections; they do not impersonate Partner ownership.
4. Duplicate detection returns only an approved minimal cross-owner summary and cannot become an id-discovery or contact/address disclosure endpoint.
5. A Partner cannot link another owner's Customer to a Potential Project or Contract even when referential ids and snapshots are internally consistent.
6. Partner activation is an Admin-audited commercial decision separate from login activation and is required at action time, not only when the account is created.
7. Partner Case submission validates active profile, current ownership, responder assignment, still-valid approved inquiry rows, exact Product-configuration identity, and prices inside the same serializable transaction that creates both linked records.
8. Responsible Seller and realized credit remain the Partner's; responder/approver identity is retained separately and never changes attribution.
9. Accounting and physical fulfillment derive only from the Sabalan-to-Partner record; the end-customer record and public output never expose Sabalan price or Partner margin.
10. Revocation, expiry, reassignment, transfer, and concurrency tests must prove deny-by-default behavior across direct-id routes as well as lists, dashboards, exports, PDFs, and public confirmation.

## Bottom line

The codebase already has strong primitives for stable Customer identity, sales attribution, snapshot integrity, transactions, granular permissions, and purpose-specific cross-workspace consumption. Its weak point is composition: ownership, responsibility, department, workspace grants, and route-specific access checks are separate and sometimes contradictory. The Partner specification should preserve those domain truths while introducing one explicit Partner lifecycle and one centralized resource-aware authorization boundary. Attempting to express Partner behavior through the existing `SALES` role, `Collaborative` customer type, department access, or Customer-list filter would preserve the present leakage paths and make the two-record commercial model impossible to secure.
