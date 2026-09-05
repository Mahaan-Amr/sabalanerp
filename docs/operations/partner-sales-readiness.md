# Partner operations readiness and containment

Issue #333; contract `@sabalanerp/partner-sales-contracts@1.0.0`, wire schema 1,
hash `sha256-v1`. Authority: final resolutions of #307/#308, `CONTEXT.md`, and
ADR-0046. This supplements, and never replaces,
[zero-data-loss deployment](zero-data-loss-deployment.md) and ADR-0039.

## Delivery boundary

This is **Module/interface acceptance**, not activation or release acceptance.
The operations module supplies policy, transactional control/monitor ports,
safe telemetry projection, and authenticated HTTP handlers. It has no default
database adapter, process-memory production store, automatic route mount, worker,
fixture activation switch, or production configuration change.

#315 owns schema/migrations and #334 owns runtime/package/route/consumer wiring.
#335 must prove real-schema concurrency, all user paths, downstream reconciliation,
and combined acceptance. #336 owns release authorization. A green fixture test
does not satisfy those gates. No production deployment, real SMS, or activation
traffic is authorized by this ticket.

## Initial state and cohort

Initialize the durable global control row explicitly with revision 1, both pauses
enabled, and no cohort. Missing/unreadable/malformed state fails closed. Do not
derive membership from role, workspace grants, Admin, Manager, historical Customer
ownership, creator, names, price, or JSON. Ordinary internal Sales never enters
these Partner-only guards.

`defineCohort` requires fresh company-scoped `OPERATIONS_MANAGE`, a named cohort,
an expected revision, a Persian reason, and paused enrollment. It cannot replace
an existing cohort or rewrite membership history. `enroll` additionally resolves
a dedicated eligible Partner profile through the profile owner's adapter.
It appends membership and audit atomically. It does not activate the User/profile.
Profile activation still requires all #316 identity, commercial, assignment,
conversion, and persona gates, plus this operations gate.

| Control | Effect |
| --- | --- |
| Enrollment pause | Stops new cohort membership and profile activation. Existing active members may continue when emergency pause is off. |
| Operational emergency pause | Stops uncommitted Partner/responder work, including recovery writes, customer/project mutation, inquiries/decisions/reassignment, Draft edits, submit, confirmation send/OTP mutation, and commitment. |
| Committed work | Authorized Accounting, fulfillment, financial gates and retail collection continue only with verified current integrity. A committed predecessor does not unlock an unfinished correction successor. |
| Exceptions | Authorized reads, internal support cancellation, and named internal remediation continue. These are operation-specific paths, never impersonation or a role bypass. |

Internal HR identity onboarding and security suspension/termination remain
available through their separately authorized onboarding purpose. They do not
require prior cohort membership or activate the profile; final activation stays gated.

Sensitive reads/output retain their own projection/hash/authorization gates.
The operations read exception is not permission to expose corrupted evidence.
Support cancellation still invokes the atomic Case cancellation owner; it never
cancels only one record or deletes numbers/history. Remediation cannot edit retail
evidence as the Partner or bypass Accounting separation of duties.

## Mandatory integration contract for #315/#334

1. Implement `OperationsStore.transaction` using the application Prisma client in
   `backend/src/lib/prisma.ts`. Do not construct/disconnect another runtime client.
   Acquire the same durable global control-row lock for controls, incidents,
   membership, and **every** Partner mutation before reading current permission,
   lifecycle, readiness and Case state. Hold it through business commit. Document
   one consistent lock order before acquiring Case/inquiry/profile locks.
2. Persist the versioned control row, dedicated cohort membership/profile links,
   command outcomes, incidents, protected append-only audit, remediation/release
   evidence, and telemetry outbox. Enforce unique command and incident keys in the
   database. A callback exception rolls back everything, including audit/outbox.
   No partial results, unlocked preflight-only guards, cache-only pause checks,
   or local-memory fallback are acceptable across replicas.
3. Bind `authorize` to the authenticated principal and current CENTRAL #319
   `OPERATIONS_MANAGE` decision. The operations service also checks internal
   persona, operations purpose, company scope, current grant expiry and domain
   restrictions. `isAdmin` alone grants nothing. Persist the authorization and
   lifecycle revisions with the actual actor and reason.
4. Use `runGuardedOperation` with a resolver that centrally authorizes the actual
   operation and loads current resource/integrity facts inside the same transaction.
   Its writer must use that exact transaction for Case/pair/evidence/audit, without
   external I/O. Do not accept `GateInput`, readiness, scope, integrity booleans or
   actor identities from HTTP. A policy result of `null` is denial-only, not an
   authorization grant.
5. Map every parsed v1 command with `operationForCommand`. Recovery save/discard
   maps to `RECOVERY_WRITE`; OTP verification maps to `CUSTOMER_OTP_VERIFY`;
   confirmation sends map to `CUSTOMER_CONFIRMATION_SEND`. `CUSTOMER_OUTPUT` alone
   means a read, not sign/print/OTP/issuance. Signing/printing that commits uses
   `CASE_COMMIT`. Shared correction uses `SHARED_CORRECTION_SAVE`, and its target
   is the unfinished successor, not a bypass from its committed predecessor.
   Customer/project writers, profile activation and downstream actions enter the
   explicit action matrix. Add a mapping/test when the shared package adds a port.
6. Install the public contract runtime with its graph dependency through the
   single package/Docker writer; inject public exports into the module factories.
   Runtime imports are type-only until that packaging exists. Use the shared
   `/testing` export only in tests. Register the reserved operations route only
   through #334 with server-resolved authentication; never mount the monitor as
   public ingestion. No body-supplied permission or readiness endpoint exists.
7. Run real-schema races against `sabalanerp-local`: pause versus commitment,
   pause versus recovery/inquiry/OTP/correction, two control commands, duplicate
   incidents from separate connections, resume versus new incident, and audit/
   outbox failure. Assert a single valid winner, rollback, deduplication and intact
   committed evidence. Use namespaced data and safe cleanup; no parallel database
   service or disposable stack. Run `docker compose -f docker-compose.local.yml ps`
   before every Docker action. Never rebuild another task's runtime window.

The v1 `OPERATIONS_PAUSE` idempotency target is `partner-operations`. Its payload
hash is the canonical hash of `{kind, paused, expectedRevision, reason}` after
schema parsing; transport command/correlation IDs are not intent. The server
recomputes it and binds actor, operation, target and key. Same identity/intent
returns the recorded state; another intent conflicts. Authorization is rechecked
even for replay. Concurrent distinct commands compare the durable revision.

## Readiness evidence

The readiness adapter must **verify** release evidence provenance and the actual
migrated schema; `DATABASE_VERIFIED` is a trusted adapter result, not a magic
boolean or self-asserted HTTP field. `FIXTURE` evidence always fails. Missing,
expired, future-dated, wrong-release or wrong-schema evidence fails closed.

Every gate in `readinessGates` must pass: exact pair, immutable identity, stable
row identity, central authorization, profile activation, inquiry, atomic Case,
one-time commitment, allowlisted output, Partner-only Accounting, Delivery lineage,
retail collections, corrections/voiding, reporting, preserved internal Sales,
real integration, combined QA, recovery drill, connected telemetry and no open
release defects. Acceptance references are required for release owner, Sales,
Accounting, technical/security, HR and Logistics. One person may hold several
responsibilities; no acceptance replaces a failed gate.

Activation, cohort entry, Case creation/commit and resume consume current evidence.
There is no pilot waiting period, minimum Partner count or minimum Case count.
Existing active Draft work is not stopped by enrollment pause alone.

## Telemetry and detection

The monitor accepts observations from trusted domain detectors, never a Partner,
customer or browser claim of a confirmed violation. Detector owners establish
facts using exact historical decimal/quantity policies; no global tolerance,
current-price substitution or missing-evidence-as-zero is permitted.

| Signal | Detector / responsibility |
| --- | --- |
| Pair/hash health | Case owner verifies exact reciprocal pair, stable rows, effective revision and projection hashes. |
| Submit/commit/realization idempotency | Case/command ledger distinguishes same-event replay from two effective commitments. |
| Financial and quantity reconciliation | Accounting/fulfillment/reporting owners compare canonical historical evidence and dated adjustments. |
| Permission denial and leakage | CENTRAL policy/output owners distinguish correct denials from confirmed cross-owner/wholesale disclosure. |
| Inquiry/assignment state, workflow latency/stuck work | Inquiry and duty owners publish bounded state/health observations. |
| Job retries, latency and notification backlog | Outbox/delivery owners publish counters and integer milliseconds without message bodies. |
| Backend/frontend failures and connection pool | Runtime owner publishes classified failures and pool occupancy/wait measurements without exception strings, URLs or credentials. |

Only the explicit metric/outcome/category allowlists become dimensions. The
server-owned correlation key must have at least 32 bytes, be stable across replicas,
and never enter logs or this repository. Correlation, subject and evidence IDs are
domain-separated HMAC references in structured records, **not metric labels**.
Keep a protected evidence lookup under the owning domain; do not copy its payload.
Never log raw OTP/token, phone/address, wholesale/retail economics, pricing input,
graph, contractData, HTTP body, exception or event payload. Even numeric financial
and quantity observations are rejected; only approved operational counters/latency
fields accept numeric values. `PartnerEvent` is validated then projected to event
type and pseudonymous references, with all financial fields removed.

Persist safe records to the transactional outbox before exporting. The exporter
must deduplicate/retry delivery and keep retention/access controls. Track outbox
delivery/lag and pool health from the start; source factories alone do not prove
that any exporter or detector is running.

## Incident containment and resume

Confirmed incomplete pair, projection/hash mismatch, duplicate commitment,
unexplained financial/quantity divergence, cross-owner disclosure or wholesale
disclosure produces an incident and emergency pause in one transaction. An
incident key derives from category, subject and stable violation evidence, not
the retry/job/correlation identity. Detectors must reuse that evidence identity
for the same violation. Repeated delivery increments occurrences without another
critical notification. Late delivery of resolved evidence stays resolved and does
not re-pause or notify; a confirmed recurrence needs a new immutable violation
evidence identity and creates a new incident while preserving the old resolution.
Ordinary delay, denial, retry, conflict and classified failure generate alerts,
never automatic emergency containment by themselves.

On containment:

1. Preserve affected work, all committed evidence, numbered Cases, append-only
   revisions, receipts, realization, and adjustment histories. Investigate through
   authorized support/audit projections with safe references.
2. Correct the cause forward through its domain owner. Use formal correction,
   cancellation/voiding, return or financial adjustment workflows; do not patch
   commercial history, delete a pair, impersonate a Partner or reprice committed
   evidence from the current catalog.
3. Reconcile the affected evidence and rerun the failed test. The trusted
   remediation adapter must bind a real evidence record to the incident and prove
   cause correction, reconciliation and test success after its last observation.
   `resolveIncident` records actual operator authorization and reason without
   lifting the pause. Fixture or stale remediation evidence cannot resolve it.
4. Recheck all readiness against the current release/schema, after containment,
   with release-owner and affected responsibility acceptance. A fresh authorized
   `OPERATIONS_PAUSE` command may resume only when no incident remains open.
   A concurrent new incident wins through the same lock/revision boundary.

If incident/audit/outbox persistence fails, return failure and alert through the
existing infrastructure channel; never report successful containment or resume.
Committed obligations continue only with their own valid integrity evidence.

## Deployment and forward recovery

Before traffic opens, follow the complete existing release lease, Nginx maintenance
boundary, local checkpoint, encrypted remote verification, immutable image-set
identity, health gates and fail-closed rollback/recovery-drill procedures. No new
public write may occur in maintenance. No force flag, partial promotion, mutable
image rollback, unverified backup, lock deletion or weaker retention is introduced.

After any newly accepted business write, restoring an old checkpoint is **not** a
Partner pause. Contain new work and fix forward while preserving acknowledged
writes and committed obligations. Any exceptional recovery follows the existing
documented recovery procedure and its authorization/evidence requirements.

## Reproducible module verification

Run the four `backend/src/services/__tests__/partnerOperations*.test.ts` files with
the installed `tsx --test` runner. They cover action/command gates, readiness,
transactional control/replay, fixture concurrency/fault injection, telemetry
allowlists and authenticated HTTP handler behavior. These fixtures do not prove
database locks, production authorization, live monitoring or real activation.

Also run backend build/typecheck, `npm run architecture:check`, the full Partner
contract suite and Partner harness unit suite. Real-schema and combined acceptance
remain required through #334/#335, with exact commands and candidate identity in
their evidence report. Shared manifest/CI/inventory wiring belongs to those owners.
