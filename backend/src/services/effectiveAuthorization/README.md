# Central explicit scoped actions — issues 296 / 315 / 319

User-approved narrow extension, review base `1609c4637f2cd28b1cae14f876bc5005291547b4`.
Entry point: `effectiveAccessService.ts` exports `grantScopedAction`,
`revokeScopedAction`, and `resolveScopedActions`. This is shared resource-scoped
authority, not a Partner route-local fallback. Existing workspace/feature
resolution is unchanged; these stores start empty. Full issue 296 (ordinary
Accounting correction, legacy migration and all-workspace parity) is not done.

## Explicit authority and provenance

A grant identifies domain, action, root kind, purpose, scope, optional exact
purpose-bound root, User or role principal, effective interval, issuer, reason
and correlation. Scope membership remains the owning domain policy's decision.
Partner uses its published vocabulary and all four ADMIN exceptions, never a
raw generic grant as a permit. Unknown Partner action/purpose/root rows cannot
grant access. Internal grants never expand the fixed Partner capability bundle.

At a given domain/action/root-kind/purpose, current direct rows replace inherited
role rows. A current direct DENY removes that action; explicit direct narrower
scope does not retain a broader inherited scope. Revoked, future and expired
rows are not current grants. No workspace ADMIN or MANAGER role manufactures an
explicit resource grant. System ADMIN authority remains in the domain policy,
with mandatory audit and mutation reason in the persisted Partner composition.
Grant provenance is DIRECT_ACTION/ROLE_ACTION, immutable grant id, version 1.

Provisioning is an internal, unmounted seam restricted to active, non-Partner
system ADMIN with reason/correlation. It does not bypass domain restrictions.
No HTTP endpoint, role editor, auto-conversion, baseline seeding or activation is
added. Grant identity/provenance are immutable; revocation is one-way and retains
its own actor/reason/correlation. Duplicate revoke is a no-op. Issuance is not an
idempotent public command: transport command-journal binding belongs to #334.

## Transactions

Use the existing application's Prisma transaction, never a new runtime client.
Lock resource/profile first when present, then involved Users in sorted order,
then singleton `effective_authorization_state`, then child records. Grant writers
lock issuer/subject Users before the singleton; they must not subsequently enter
business aggregates. The singleton serializes the small explicit-authority store
and protects absence, direct narrowing and role grant insertion through commit.
The grant database trigger increments its revision for insertion/revocation and
also protects writers using the database directly. User locks stabilize role and
activation; no cached permissions survive transaction boundaries. Always refresh
authorization immediately before the final write after other work/lock waits.
The coarse lock is deliberate correctness-first behavior, not a throughput claim.

Audit contains decision metadata, current revisions and evaluated grant ids, not
private pricing or business DTOs. Database triggers reject update/delete/truncate.
Only the domain's current scoped AUDIT_READ projection exposes records. Successful
command and audit commit together; denials must be returned from their transaction
to retain audit. Other transaction failures/transport logs require the integration
owner; this module does not secretly open a second client or independent commit.

## Local migration evidence and limits

Only existing `sabalanerp-local` was used. Before changes: 181 applied migrations,
257 Users, zero Partner profiles/Cases. Four checksum differences already exist
in the retained pre-315 baseline: shipment quantity projections, guard queue
append-only events, physical gate exit, recovered approved pricing rows. Their
ledger entries and migration files were not changed or declared repaired.
Two unrelated HR migrations were pending and were not applied by this work.

Each new additive migration was first run with its final COMMIT replaced by an
intentional division-by-zero. Rollback removed all new tables and left the User,
Partner profile and Case counts unchanged. The exact transaction SQL was then
applied with Prisma `db execute`; only that successful migration was registered
using `migrate resolve --applied`, avoiding execution of unrelated pending HR
work. No existing ledger row, checksum or constraint was bypassed or overwritten.
New local ledger count: 183. No runtime rebuild, production or activation.

Rollback fixtures test explicit grants, provenance, direct narrowing, expiry,
revocation, immutable history, ADMIN reasons and scoped audit disclosure. A real
two-connection test proves a new role grant waits on the absence/revision lock
even with no shared User lock; only mutable namespaced Users are committed and
cleaned, the retained role grant rolls back. Full grant/assignment/lifecycle
first-valid-command-commit acceptance remains #334/#335.
