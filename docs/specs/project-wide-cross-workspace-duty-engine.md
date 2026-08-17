# Project-wide cross-workspace duty engine

Status: Proposed implementation specification from confirmed product decisions  
Date: 2026-08-16  
Scope: Sales, Accounting, Logistics, Security, Human Resources, CRM, Inventory, System Administration, and their actionable handoffs

## Outcome

SabalanERP will replace the HR-specific destination-duty implementation with one project-wide module that presents accountable actions in the operational destination where they must be performed. A duty is an actionable projection of an authoritative source workflow, never a second business source of truth and never a generic free-text task.

The Persian surface is `وظایف بین‌واحدی`. It contains registered duty types from every approved source, supports permission-based shared queues, explicit claiming and manager reassignment, structured results, minimum-necessary evidence, immutable history, deadlines, durable notifications, and a red assigned-open count in expanded and collapsed navigation.

The module is not a general task manager. It may carry same-workspace successor stages only when they are necessary stages of an inter-workspace handoff chain, such as Accounting preparation followed by Accounting approval after a Sales Contract becomes Accounting-ready.

## Existing implementation facts

- `HrDuty`, `HrDutyEnvelope`, assignment history, audit versions, and notification identities already provide useful lifecycle storage in `backend/prisma/schema.prisma`.
- `hrDutyEngine.ts` owns envelope validation, response concurrency checks, assignment successors, deadline events, and notification publication.
- `hrDutySurface.ts` and `/api/hr-duties` expose summary, assigned, manager-triage, history, detail, and response operations to eight workspace routes.
- Only `sourceType = HR_WORK_ITEM` is implemented. Both response and destination projection load `HrWorkItem` directly; every other source fails with `HR_DUTY_SOURCE_ADAPTER_NOT_REGISTERED`.
- Legacy HTTP creation and reconciliation routes return `410`, so the current pages are not a live generic creation interface.
- The current queue assigns named responsibility holders. The confirmed product model instead requires permission-based available queues, explicit claim, and manager reassignment.
- The current page and feature names remain HR-specific, the detail UI assumes one universal four-action schema, and the navigation has no authoritative red count.
- `AccountingDispatchCandidate` and `AccountingDispatchWorkItem` already model one actionable Accounting handoff. They must be migrated or projected, not duplicated.

## Module shape

### External seam

The command-side module exposes a small interface to source workflows and duty routes:

```ts
export interface CrossWorkspaceDuties {
  synchronizeSource(
    tx: Prisma.TransactionClient,
    input: SynchronizeDutySourceInput,
  ): Promise<SynchronizeDutySourceResult>;

  claim(
    tx: Prisma.TransactionClient,
    input: ClaimDutyInput,
  ): Promise<DutyCommandResult>;

  reassign(
    tx: Prisma.TransactionClient,
    input: ReassignDutyInput,
  ): Promise<DutyCommandResult>;

  respond(
    tx: Prisma.TransactionClient,
    input: RespondToDutyInput,
  ): Promise<DutyCommandResult>;

  maintain(
    tx: Prisma.TransactionClient,
    input: MaintainDutiesInput,
  ): Promise<MaintainDutiesResult>;
}
```

The query-side module exposes only destination-safe projections:

```ts
export interface CrossWorkspaceDutyInbox {
  summary(database: DutyDatabase, query: DutySummaryQuery): Promise<DutySummary>;
  list(database: DutyDatabase, query: DutyListQuery): Promise<DutyListPage>;
  detail(database: DutyDatabase, query: DutyDetailQuery): Promise<DutyDetail>;
}
```

Callers do not choose payload fields, result schemas, destination permissions, assignment policy, actor-separation rules, deadline calculations, or source transitions. Those rules are code-registered behind the module.

All source mutations and duty synchronization or response application use the caller's existing `Prisma.TransactionClient`. Runtime code reuses the single application client from `backend/src/lib/prisma.ts`; the module never creates or disconnects a `PrismaClient`.

### Internal source-adapter seam

Every supported source type has one registered Adapter:

```ts
interface DutySourceAdapter<Snapshot, Result> {
  readonly sourceType: string;
  load(tx: Prisma.TransactionClient, ref: DutySourceRef): Promise<Snapshot>;
  version(snapshot: Snapshot): number;
  isActionable(snapshot: Snapshot, dutyTypeCode: string): boolean;
  route(snapshot: Snapshot, definition: DutyTypeDefinition): Promise<DutyRoute>;
  project(snapshot: Snapshot, context: DutyProjectionContext): DutySafeProjection;
  validateActor(snapshot: Snapshot, context: DutyActorContext): DutyActorDecision;
  validateResult(snapshot: Snapshot, result: unknown, definition: DutyTypeDefinition): DutyResult;
  applyResult(tx: Prisma.TransactionClient, snapshot: Snapshot, result: Result, context: DutyResultContext): Promise<DutySourceTransition>;
}
```

This is a real seam because production Prisma adapters and in-memory test adapters both exercise the same engine interface. Adapter details remain internal; source routes and frontend code never call adapters directly.

An Adapter owns source-specific truth: how to load the current version, whether the action is still valid, what minimum evidence may be projected, and how a structured result changes the source atomically. The engine owns generic truth: lifecycle, assignment, concurrency, audit, deadline, notification identity, successor linkage, and destination-safe authorization.

### Code-owned duty definitions

Each `DutyTypeDefinition` is registered in code and versioned. It contains:

- stable duty type code and definition version;
- source type and source workspace;
- destination resolver and queue code;
- required action permission and optional destination feature permission;
- assignment mode: available permission queue, direct responsible person, parallel prerequisite, or system-administration queue;
- deadline policy code, business calendar, policy version, and priority rules;
- actor policy code;
- minimum field/evidence projection policy;
- allowed action codes and per-action structured result schema;
- notification templates and escalation policy;
- source staleness and successor policy.

Definitions are synchronized to immutable version rows for audit. Request bodies may select only an allowed action on an existing duty; they can never register or alter definitions.

The current HR definitions route both `FINANCE_RECORDING` and `FINANCE_APPROVAL` through `MANAGE_FINANCE_EVIDENCE`. Generic cutover must introduce distinct action grants for preparation/recording and approval; a shared broad evidence permission cannot prove that an ordinary user is authorized for both stages. General Manager and `ADMIN` use the separately audited privileged override policy rather than silently inheriting both actions from a read/evidence grant.

## Actor policies

Actor separation is duty-type policy, not one global boolean.

| Policy | Rule |
| --- | --- |
| `PERMISSION_ONLY` | Any current assignee with the required action grant may respond. A person holding both stage grants may perform both explicit stages. |
| `REQUESTER_EXCLUDED` | The initiating requester cannot review, approve, or verify their own request even if they later receive destination grants. Used by Seller-originated Contract correction. |
| `PRIVILEGED_SELF_APPROVAL` | Ordinary users remain separated. An explicitly authorized General Manager or `ADMIN` may perform both stages, each as a separate action with an override audit marker. Used by confirmed compensation and Payroll flows. General Manager eligibility comes from an explicit authority or action grant, never a display title. |
| `STRICT_DISTINCT_ACTORS` | The same person may perform only one protected side, regardless of `ADMIN`, General Manager, or multiple grants. Used by Manual Outage Exit dual control. |

Every protected result records the actor, effective permissions/authority, actor-policy code and version, whether self-approval occurred, whether a privileged override was used, and the event time.

## Persistence model

### Logical rename without destructive table replacement

The Prisma models become:

- `CrossWorkspaceDutyEnvelope @map("hr_duty_envelopes")`
- `CrossWorkspaceDuty @map("hr_duties")`
- `CrossWorkspaceDutyAssignment @map("hr_duty_assignment_history")`
- `CrossWorkspaceDutyAudit @map("hr_duty_audit_versions")`
- `CrossWorkspaceDutyNotificationIdentity @map("hr_duty_notification_identities")`

Keeping the physical tables during initial cutover avoids a destructive rename and preserves every existing identifier, foreign key, and audit record. A later physical rename is optional and has no product value, so it is not part of initial implementation.

### Required additions

Add or make explicit:

- `dutyTypeCode` and `definitionVersion`;
- `sourceWorkspaceCode` for safe filtering and display;
- `requiredActionPermissionCode` in the immutable envelope version;
- `deadlinePolicyCode`, `deadlinePolicyVersion`, and `businessCalendarCode`;
- `priorityCode` with reasoned, audited priority changes;
- `claimedAt` on the active assignment projection;
- `actorPolicyCode` and `actorPolicyVersion` in the envelope/audit evidence;
- an optional safe source display code, never an unrestricted source URL or arbitrary payload;
- an explicit response-attempt or idempotency identity so concurrent retries return the committed result.

The existing source identity uniqueness remains conceptually:

```text
(sourceType, sourceId, dutyTypeCode, sourceVersion) -> at most one duty
```

One active-chain constraint is additionally required for workflow aggregates that prohibit parallel chains, especially Sales Contract correction. This should be enforced by a source-owned unique active-chain record or a database constraint, not by a preflight query alone.

### Lifecycle

Persist only `OPEN`, `COMPLETED`, `WAIVED`, and `CANCELLED`. `OVERDUE` is derived from `OPEN` plus `dueAt` and never becomes a competing status.

- `COMPLETED`: a valid structured result and source transition committed atomically.
- `WAIVED`: the same source action continues through a replacement assignment or equivalent successor.
- `CANCELLED`: the source action is no longer compatible or actionable.
- Rejection and return are valid business results, not technical failure states.

Completed rows and audits are append-only. Renewed work creates a linked successor instead of reopening or rewriting history.

## Assignment and authorization

### Available permission queue

An unclaimed duty is visible in `available` only to active users who currently hold its required action permission for the destination. It is not visible solely because the user can enter that workspace. The first eligible claim wins under a serializable transaction and row/advisory lock.

Once claimed:

- only the current assignee may respond;
- permission and source validity are rechecked on every detail load and mutation;
- manager reassignment ends the previous assignment and creates a new assignment event;
- a revoked, inactive, or unavailable assignee returns through reconciliation to the eligible queue or a configured fallback;
- unclaimed available/triage duties do not contribute to personal red badges.

Managers see bounded destination triage information, not the complete source record. Claiming a duty grants task-scoped evidence only; it never grants general source-workspace access.

### Direct responsibility

Responsible Seller, Responsible Supervisor, prior Accounting processor, and similar person-bound routes use snapshotted stable identity. If the preferred person is inactive or ineligible, the registered fallback is used, usually the destination permission queue. Managers may reassign only to a currently eligible user.

### System Administration destination

`SYSTEM_ADMINISTRATION` is a first-class operational destination with slug `admin`, protected by the specific administration action permission. It is not added as a commercial workspace in `WORKSPACE_CONFIG` merely to make routing possible.

Its queue and badge appear in the authorized Administration navigation. Ordinary workspace users cannot enumerate the destination, summary, duties, or evidence.

## Deadlines and priority

Deadline calculation uses a shared Tehran business-calendar module. Raw `24 * 60 * 60 * 1000` arithmetic cannot implement one-working-day or three-working-day policies.

Confirmed policies include:

- Accounting Contract candidate preparation: one working day from Accounting eligibility;
- Accounting financial approval: one working day from candidate readiness;
- Sales Contract correction opportunity: three working days from manager approval;
- return or incompatible source change closes the prior deadline; a valid new source version receives a fresh policy-calculated deadline;
- reassignment preserves the deadline unless the duty type explicitly defines a reasoned extension;
- priority changes require an allowed actor, reason, before/after audit, and notification when accountability changes.

The generic default sends one near-due event, one overdue event, and one manager escalation after 24 overdue hours. A definition may select a stricter registered policy but cannot receive caller-defined intervals.

## Command behavior

### `synchronizeSource`

Source workflows call this inside the transaction that created or changed the actionable source. The module:

1. resolves the registered definition and Adapter;
2. locks the stable source-action identity;
3. loads and validates current source truth;
4. cancels an incompatible open projection when necessary;
5. calculates route, eligible queue, deadline, and envelope version;
6. creates exactly one duty or returns the existing identical result;
7. appends assignment and audit evidence;
8. creates durable notification identities in the same transaction.

There is no public generic create-duty route. Manual free-text duties and arbitrary JSON envelopes remain prohibited.

### `claim`

The module rechecks open state, current source version, active definition, current permission, and actor eligibility under lock. A successful claim appends assignment history and an audit event. A concurrent loser receives a stable conflict response and reload guidance.

### `reassign`

Only a registered destination-manager permission may reassign. The target must currently satisfy the duty definition. Reassignment never changes source version, result, or deadline silently.

### `respond`

The module validates expected duty version, source version, definition/envelope version, assignment, permission, actor policy, action code, and result schema. The Adapter then applies the source transition in the same serializable transaction. Only after that transition succeeds does the duty become completed and publish its result notification identity.

A retry with the same idempotency key and identical intent returns the committed result. Reusing a key for different intent fails. Concurrent distinct responses permit only one committed source transition.

### `maintain`

Maintenance is idempotent and bounded. It processes deadline events, revoked or inactive assignees, stale source versions, expired opportunities, and registered fallback routing. It never guesses a source transition and never creates a second Compose/database client.

## Query and HTTP interface

The canonical routes become:

```text
GET  /api/cross-workspace-duties/destinations/:destination/summary
GET  /api/cross-workspace-duties/destinations/:destination/duties
GET  /api/cross-workspace-duties/destinations/:destination/duties/:id
POST /api/cross-workspace-duties/:id/claim
POST /api/cross-workspace-duties/:id/reassign
POST /api/cross-workspace-duties/:id/respond
```

List views are `assigned`, `available`, `triage`, and `history`. Filters include source workspace and registered duty type/action. Lists are server-filtered and cursor-paginated.

Every mutation requires the existing idempotency middleware and expected versions. Error families use generic `DUTY_*` codes rather than HR names and map consistently:

- `404`: destination or duty is not available to the actor;
- `403`: permission, assignment, manager scope, or actor policy denies the action;
- `409`: source, duty, envelope, assignment, or idempotent intent became stale;
- `400`: malformed or unregistered action/result.

During compatibility migration, `/api/hr-duties` may delegate reads and responses to the same module. It must not retain a second implementation. After frontend and open-row reconciliation are verified, the compatibility route returns `410` and is removed in a later release.

## Destination-safe projection

The detail response contains only:

- duty identity, state, source workspace label, duty type label, priority, deadline, and expected versions;
- minimum fields produced by the registered Adapter;
- authorized evidence descriptors or task-scoped evidence handles;
- actions currently allowed for this actor and duty state;
- structured result and redacted audit history appropriate to the viewer.

No generic source-record link is accepted. If a destination deep link exists, the backend authorizes its exact task-scoped resource on every request. Closed history may retain safe labels and audit metadata when the live source is no longer available, without disclosing removed evidence.

## Frontend surface

Rename `frontend/src/features/hr-duties` to `frontend/src/features/cross-workspace-duties` and remove HR language from types, components, errors, page titles, and accessible labels.

The unified page title is `وظایف بین‌واحدی`. It provides:

- `وظایف من` for assigned open duties;
- `وظایف قابل دریافت` for permission-eligible unclaimed duties;
- `نیازمند تعیین مسئول` for destination managers;
- `تاریخچه`;
- source-workspace and duty-type filters;
- registered, schema-driven action forms rather than one universal textarea and four hard-coded buttons.

All controls use the Sabalan Design System. The page does not redirect a destination actor into a source workspace and does not expose source fields merely because the viewer is a destination manager.

BI remains read-only and is not a routable duty destination, so it does not receive a duty navigation item. Inventory receives the surface only after a registered Inventory action duty exists; catalog visibility alone does not justify an empty operational queue. Support and System Recovery retain their own navigation and lifecycles.

### Red attention badge

The navigation badge uses the authoritative `summary.openAssigned` count for the current destination and signed-in user:

- visible on both expanded label and collapsed icon;
- red circular presentation using design-system tokens/primitives;
- `99+` above 99;
- counts only `OPEN` duties currently assigned to that user in that destination;
- excludes available, unassigned triage, history, unread notifications, Support, and operational queues;
- never clears when the page is viewed;
- refreshes after claim, reassignment, response, workspace change, window focus, and notification-center invalidation.

Polling may provide resilience, but unread notification state is never the source of the count.

## Notifications

Assignment, near due, overdue, manager escalation, reassignment, and structured result create durable Unified Notification Center events. A privacy-safe Web Push may deliver the same event without sensitive lock-screen content.

Stable identity is based on duty, audit/response version, event kind, and recipient. Provider retry does not create another notification. Available shared-queue work does not notify every eligible user individually by default; manager triage receives the configured bounded notification. Claiming creates the personal assignment notification.

Notification read state and duty lifecycle remain independent.

## Confirmed source adapters and boundaries

| Adapter / chain | Trigger | Destination action | Key policy |
| --- | --- | --- | --- |
| HR Work Item | Existing actionable registered HR work | Registered destination response | First compatibility Adapter; preserve current history while removing HR engine ownership |
| Sales Contract registration | Active Contract becomes Approved, Signed, or Printed | Prepare invoice candidate, then approve financial record | Two sequential one-working-day duties; same user may perform both with both grants |
| Sales Contract correction | Responsible Seller submits correction request | Accounting processing and manager decision, one Sales correction save, Accounting verification | Requesting Seller never approves; one active chain; three-working-day opportunity; one successful save |
| Accounting Dispatch Candidate | Logistics finalizes driver/vehicle allocation | Accept and issue, Reject, or Return | `AccountingDispatchCandidate` remains authoritative; retire duplicate WorkItem lifecycle after cutover |
| Dispatch return reconciliation | Guard verifies physical return | Accounting posts linked negative correction | Guard evidence immutable; Accounting cannot rewrite physical truth |
| Manual Outage Exit | Registered outage exception requires both approvals | Accounting administrative approval plus Guard supervisory approval | Parallel prerequisites, strict two-person control even for General Manager and `ADMIN` |
| Compensation and Payroll approvals | Registered HR compensation/Payroll stage becomes ready | Required finance or Payroll stage | General Manager and `ADMIN` may perform both explicit stages with privileged override audit |
| Payroll Accounting handoff | Payroll Run reaches approved immutable state | Accounting posting and settlement | Accounting cannot edit employee calculation lines; correction returns to HR as supplemental/reversal work |
| Leave coverage | Approved leave produces a concrete Security coverage gap | Arrange replacement coverage | Approved leave without a gap is data, not a duty; Security never approves leave |
| Overtime | System derives Overtime Candidate from immutable attendance | Responsible Supervisor confirms; HR reviews only when required | Security records physical truth and never decides pay entitlement |
| User provisioning | Supervisor requests ERP access and owners approve | System Administration fulfills approved access | No automatic account from employment state; destination protected by exact admin permission |
| Offboarding | Employment Termination Decision opens obligations | Equipment, settlement, ERP revocation, and physical-access revocation | Employment end does not wait for incomplete obligations; overdue work remains visible |
| CRM Contract conversion | Another actor marks a potential project ready while conversion remains outstanding | Responsible Seller creates draft Contract | No duty when the Seller converts atomically in the readiness action |

Workflow-specific Adapter contracts additionally preserve these confirmed distinctions:

- A pre-financial Accounting return sends the current Contract version to its Responsible Seller with a required category and reason and needs no Accounting manager decision. The Seller's successful correction creates a new version and a fresh preparation deadline.
- A financially locked Contract cannot be reopened through that lightweight return. It follows the Seller-originated correction request, Accounting manager decision, one three-working-day edit opportunity, one successful save, and Accounting verification chain.
- Correction verification prefers the prior Accounting processor, falls back to the shared eligible queue when that actor is unavailable, and may be reassigned by an authorized Accounting manager.
- Dispatch `RETURN` means the allocation is correctable: it releases the reservation and creates the linked Logistics successor while preserving the driver, vehicle, and queue turn when still valid.
- Dispatch `REJECT` is terminal for that candidate: it releases the reservation and creates no automatic successor. Logistics must explicitly choose cancellation/unloading or a fresh allocation.
- A post-issuance void/replacement request is an Accounting duty; a pre-issuance Logistics withdrawal remains a source-owned command rather than a duty.

Explicit non-duty boundaries:

- ordinary Guard admission, driver pool, reservation, loading, confirmation, and physical exit remain operational queue states;
- approved leave and work schedules are shared data until a concrete coverage action exists;
- Inventory catalog visibility is data unless a registered correction request exists;
- BI is read-only and refers discrepancies to authoritative operational sources;
- Accounting-to-Sales informational state changes remain notifications unless a registered Sales action exists;
- Support Tickets and System Recovery remain separate workflows.

## Migration and cutover

### Phase 0 — characterization and safety gates

1. Capture counts and integrity for every existing HR duty, envelope, assignment, audit, notification identity, open source, and destination page.
2. Add interface-level characterization tests for current valid behavior, denial codes, concurrency, audit append, deadlines, and notification deduplication.
3. Record existing open `AccountingDispatchWorkItem` and candidate reconciliation.
4. Run `npm run architecture:check`; no runtime code may add a `PrismaClient`.

### Phase 1 — generic module over existing physical tables

1. Apply the logical Prisma model rename with existing `@@map` table names and additive columns only.
2. Introduce code-owned generic definitions, the Adapter registry, generic errors, and generic notification resource types.
3. Implement the HR Work Item Adapter and prove parity through the new module interface.
4. Point compatibility HR routes to the generic module; prohibit dual command implementations.
5. Deploy with reads and reconciliation only before enabling new source creation.

### Phase 2 — generic destination surface and badge

1. Add canonical routes, cursor pagination, available queue, claim, reassignment, and schema-driven detail responses.
2. Rename the frontend feature and Persian titles.
3. Add source/action filters and the expanded/collapsed assigned-open badge.
4. Add the protected System Administration destination surface.
5. Verify with `npm run design-system:check` and the acceptance commands in `docs/design-system/catalog.md`.

### Phase 3 — source adapters in risk order

Enable one adapter family at a time behind a one-way database-backed cutover state:

1. current HR-originated cross-workspace actions;
2. Sales Contract Accounting registration;
3. Seller-originated Contract correction chain;
4. Accounting Dispatch Candidate and return reconciliation;
5. Payroll Accounting handoff, leave coverage, and overtime;
6. onboarding, System Administration, and Offboarding;
7. conditional CRM-to-Sales conversion.

For each family:

- backfill only currently actionable source versions;
- use the source's stable identity and version; never infer missing actors or decisions;
- compare actionable-source count, open-duty count, duplicates, orphans, stale versions, and assignments;
- enable new creation only after two clean reconciliation runs;
- stop the legacy writer in the same promotion that enables the Adapter;
- retain old history read-only until retention policy permits removal.

### Accounting Dispatch WorkItem retirement

`AccountingDispatchCandidate` remains source truth. During its Adapter cutover:

1. map each open `AccountingDispatchWorkItem` to exactly one generic duty;
2. preserve candidate identity, creation time, status, actor, and decision evidence;
3. compare every pending candidate with exactly one open duty;
4. switch candidate creation to `synchronizeSource` in the same transaction;
5. stop creating or mutating new WorkItem rows;
6. retain legacy rows read-only for audit and remove the model only in a later verified migration.

No period may allow both WorkItem and generic duty responses to decide the same candidate.

### Rollback

Before a family is enabled, rollback may disable its reads and discard only unpromoted, reconciliation-only projections. After a generic duty has committed the first authoritative source response, rollback must not reactivate the legacy writer. It may roll the application back only to a compatible image that reads the same generic rows and Adapter contract.

All schema and deployment work follows ADR-0039 and `docs/operations/zero-data-loss-deployment.md`; no force, partial promotion, or mutable-image rollback is permitted.

## Verification strategy

The module interface is the primary test surface.

### Policy tests

- definition and schema registration;
- working-day deadlines in Asia/Tehran;
- available, claimed, reassigned, terminal, stale, and successor lifecycles;
- all four actor policies, including privileged self-approval audit and strict outage dual control;
- badge exclusion rules and `99+` presentation state;
- notification identity and escalation idempotency.

### Integration and concurrency tests

- source transition plus duty creation is atomic;
- response plus source mutation plus completion plus notification identity is atomic;
- concurrent claims produce one assignee;
- concurrent responses produce one source transition;
- stale source, definition, assignment, and permission fail closed;
- retry with identical idempotency intent replays; conflicting intent rejects;
- no source Adapter can expose fields outside its safe projection;
- one active Sales Contract correction chain;
- one pending Dispatch Candidate maps to one open duty;
- General Manager/`ADMIN` override creates two explicit actions, never an implicit second completion;
- Manual Outage Exit rejects the same actor on both sides regardless of grants.

Integration tests use the existing `sabalanerp-local` Docker Compose services and isolated test data or transactions. They do not create another Compose project, PostgreSQL container, or runtime Prisma client.

### Route and frontend tests

- authentication and exact destination permission on every route;
- task-scoped access does not grant source-workspace access;
- available queue claim and manager reassignment;
- filter and cursor stability;
- expanded and collapsed badge equality;
- badge unchanged by page view or notification read;
- stale-last-success behavior remains safe;
- Persian labels contain no HR-only wording on the generic surface;
- BI, Support, Recovery, and operational queues are excluded.

Old tests that exercise only the shallow HR implementation are removed after equivalent behavior is covered through the generic interface. They are not layered indefinitely beside the replacement tests.

## Acceptance gates

Implementation is ready only when:

1. no runtime duty code directly branches on `HR_WORK_ITEM` outside its Adapter;
2. no source has two actionable work-item truths;
3. every mutation is idempotent, version-checked, authorized, and atomic with its source transition;
4. every registered duty projects only minimum-necessary evidence;
5. personal badge counts reconcile exactly with assigned open rows;
6. all existing HR history remains readable after logical model rename;
7. Dispatch pending-candidate reconciliation is exact before its legacy writer stops;
8. Administration is routable without exposing it as a general commercial workspace;
9. BI, Inventory data visibility, notifications, Support, Recovery, and normal operational queues do not create false duties;
10. `npm run architecture:check`, `npm run design-system:check`, relevant behavioral/integration tests, and `npm run docker:verify` pass against `sabalanerp-local`.

## Explicitly deferred

- arbitrary user-created or free-text duties;
- caller-defined JSON envelopes, actions, deadlines, or permissions;
- BI-owned correction workflows;
- generic low-stock or catalog-maintenance duties without an authoritative Inventory request model;
- merging Support, Recovery, notification, or operational queue lifecycles;
- physical renaming of the existing `hr_duty_*` database tables;
- a new real-time transport solely for the navigation badge.
