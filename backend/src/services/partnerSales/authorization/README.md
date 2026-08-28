# Partner central authorization — first slice, issue 319

Review base: `1609c4637f2cd28b1cae14f876bc5005291547b4` (user approved).
Public contracts: `@sabalanerp/partner-sales-contracts@1.4.0`, authorization wire v1.
No runtime registration, activation, schema, ordinary Sales policy or shared grant
resolver changes are included. **This does not complete issue 319.**

## Interfaces

- `createPartnerAuthorization(source, binding)` implements the public
  `PartnerAuthorizationPort`. Actor, purpose and channel are trusted server
  composition values; evidence is freshly resolved on every call, never accepted
  as an HTTP permission payload. The fixed Partner bundle cannot be expanded by
  internal grants or a stray ADMIN role. Internal grants must already be resolved
  explicit action/root-kind/purpose/scope evidence from the central owner (#296).
- `projectActionAvailability` projects canonical Persian denials, omits hidden
  resources and deduplicates actions. It is advisory; it is not a write permit.
- `createAuthorizedCaseReader` covers the three private Case query purposes:
  Partner/management economics, Sabalan Accounting, and price-free fulfillment.
  It reauthorizes after IO, checks the exact revision/hash/root, and rejects
  unknown fields recursively using public strict schemas. It does not turn a raw
  entity into a DTO. Positive DTO construction/integrity remain the owner adapter's
  responsibility. Customer output continues through the separate #325 immutable
  snapshot/token authority; this reader cannot substitute for it.
- `createPrismaPartnerAuthorization` uses a supplied transaction from the shared
  Prisma client. The initial persisted adapters cover PROFILE and owned CRM
  CUSTOMER; `authorizeProject` additionally checks actual Customer binding and
  independent Project responsibility. Other persisted roots fail closed.

## Transaction contract

Call authorization within the command transaction, immediately before its write,
including on retry. Do not retain a port beyond its transaction. The adapter locks
the resource/profile, then actor/owner Users in sorted-id order, then any Project
child. Owner department and Project linkage are read under locks. Callers and
future profile/CRM writers must preserve that order. Database `clock_timestamp()`
is read after evidence loading. The active owning Partner's `CASE_COMMIT` command
uses PARTNER purpose; output preview/download permission does not authorize
commitment. The Case writer still validates the signed/printed trigger atomically.

`ResolvePartnerAuthority` is a REQUIRED #296 integration adapter, not a new grant
model or a route-local permission resolver. It must resolve current explicit
actions/scopes, preserve direct narrowing, lock every relied-on grant and its
absence/role guard against concurrent insert/revoke, and provide revision evidence.
There is intentionally no workspace fallback or default grant provider. The
test-only persisted grant adapter is never installed into runtime.

The generic evidence adapter is also trusted: it must validate relationships,
current assignment eligibility and requester evidence, and keep evidence stable
until the owning transaction completes. The pure policy does not manufacture
those facts or acquire database locks itself.

## Acceptance still open

- #296 persisted action/scope/provenance adapter and coordinated shared hooks;
  existing generic feature/workspace rows have no complete Partner scope model.
- Persisted Inquiry/Case and remaining child adapters, current assignment and
  financial-chain binding, creation/recovery targets before a Case exists.
- Public v2 management actions, all non-Case query producers, safe list/count
  database predicates, sensitive decision audit and Admin reason evidence.
- Cross-connection grant/assignment/lifecycle races and complete atomic command
  commit acceptance, operations/cohort/domain gates and durable audit integration.
- #330 consumers, #334 live closed composition, #335 comprehensive acceptance.

## Current verification

Red/green tests exercise public authorization and Case query seams, including
the fixed bundle, lifecycle, explicit scopes, current grant expiry/revocation,
all four ADMIN exceptions, purpose restrictions, channel parity, safe availability,
nested unknown-field rejection and exact Case ownership. The real existing-local
PostgreSQL suite proves current grant/user checks and CRM Project responsibility.
One additional cross-connection regression holds a Project lock until the grant
expires, then verifies that authorization refreshes after the wait. It commits
only namespaced mutable User/CRM fixtures and deletes those exact fixtures in
`finally`; all retained Partner evidence is rolled back. Every temporary client
closes in `finally`. No retained evidence is deleted. This does not prove the
remaining assignment/lifecycle first-valid-commit acceptance matrix.
