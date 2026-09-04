# Partner runtime integration — issue 334

Production activation remains closed. This candidate composes the authenticated
Partner runtime into the existing application and QA harness; it does not deploy,
send real SMS, or enable a release cohort.

## Composed runtime

- The existing technical catalog/recovery/save, technical-policy, inquiry, and
  management transports remain mounted under `/api/partner`.
- `POST /api/partner/workspaces/query-v2` now supplies strict v2 management and
  responder workspaces. Authentication runs before composition, the actor comes
  only from the current session, all reads use the shared Prisma client and one
  transaction snapshot, and responses are `private, no-store`.
- The management projection reads real profiles, lifecycle gates, terms policies,
  responder assignments, pending inquiries, conversion evidence, cohorts, and CRM
  transfer matches. Each purpose/action is independently projected by the central
  audited Partner authorization service and is reauthorized by its command route.
- The responder projection selects only each inquiry's latest assignment for the
  current actor, reauthorizes candidates, and rejects widened or corrupt producers.
- Sales Partner pages now default to authenticated HTTP ports. The HR identity-only
  production projection remains uncomposed rather than widening to the management DTO. Synthetic
  previews exist only when `NEXT_PUBLIC_ENABLE_PROTOTYPES=1` and an explicit
  fixture query is supplied; fixtures cannot enter the normal runtime path.
- The shared navigation registers management and responder destinations only after
  the backend confirms an explicit current Partner-domain grant. Workspace
  membership alone neither reveals nor admits a Partner entry point.
- Authenticated `/api/partner/cases`, `/accounting`, `/fulfillment`,
  `/retail-collections`, `/reports`, `/corrections`, and `/operations` transports
  are mounted against the shared application Prisma client. Their repositories
  read and write the migrated Partner Case, official Accounting, shipment,
  immutable customer-output, collection, report-export, correction, outbox, and
  operations-incident records; runtime fixtures are not used by these routes.
- Customer confirmation freezes the exact Case revision, stores only hashed
  confirmation credentials, and binds final PDF bytes to both the frozen output
  hash and a recomputed byte hash. Initial confirmation and correction
  reconfirmation retain separate lifecycle semantics.
- Accounting owes only the frozen Sabalan-to-Partner amount; private customer
  collections do not mutate that debt. Fulfillment lineages retain the exact
  Case/revision/product row and direct-customer destination. Reports use
  repeatable-read snapshots and frozen, actor-bound exports.
- Retail, shared, Sabalan-terms, and void workflows reauthorize every gate,
  preserve predecessor evidence, serialize competing openings on the Case row,
  and reject simultaneous correction scopes. Effective voiding retains the
  Case while voiding its contract, Accounting records, receivables, and pending
  customer confirmation sessions atomically with adjustment/outbox evidence.
- Sales contract detail now resolves an explicit `PARTNER_CUSTOMER` link through
  the lifecycle owner's full hash/provenance rebuild. A missing, unauthorized, or
  mismatched projection fails closed instead of rendering ordinary contract data.

## Verification and evidence

`npm run test:partner-sales:integration` runs the request-bound transport,
strict-projection, and real-schema lifecycle/downstream tests against the approved
local environment and stores an immutable manifest below `test-results/partner-sales/`.
The `all` harness mode includes this suite. Hosted CI uses the runtime-independent
`transport` mode; real-schema integration remains mandatory in trusted local `all`.

The real-schema `db` mode additionally creates a namespaced user/workspace grant in the
existing `sabalanerp-local` database, authenticates through the current session,
checks both Partner shell routes remain closed without a Partner-domain grant, calls the live workspace endpoint, verifies the
session actor and no-store boundary, rejects a browser actor override, and removes
only its namespace. The standard fixture concurrency and foreign-reference cleanup
guards run in the same mode.

The browser mode signs in through the real login UI, selects a projected technical
catalog product, persists the leased technical recovery, submits a real inquiry,
switches to an explicitly granted responder, records the approved wholesale price,
returns to the Partner, and creates a real DRAFT Case through the production Wizard.
It also reads one exact namespaced committed Case and its 150 IRT retail / 100 IRT
Sabalan / 50 IRT resale projections, private collection and Partner-account balances,
frozen report/export, Accounting queue/preparation, and direct-to-customer fulfillment
lineage. It persists a retail correction request, reloads it from the database, and
proves that a competing void request fails closed. Duplicate React reads are retained
in the flow to exercise deterministic Case-root-before-profile locking. The runner
restores the normal backend and drops only the exact namespaced browser database
during cleanup; it does not bypass evidence retention to delete individual Case rows.
The external `trustseal.enamad.ir/logo.aspx` footer image is replaced with a neutral
test placeholder. Local UI, authentication, APIs, and persistence are not intercepted.
The manifest records the rebuilt browser runtime separately from the initial
runtime, confirms the exact browser database was dropped, and captures the restored
normal runtime. Every runner Docker action rechecks the existing Compose project.

Required candidate checks:

```text
npm run test:partner-sales:integration
node scripts/run-partner-sales-tests.mjs db
npm run build --prefix backend
npm run build --prefix frontend
npm run architecture:check
npm run design-system:check
npm run test:design-system-foundation
npm run test:design-system-adoption
npm run test:design-system:e2e
```

The Partner CI workflow installs both backend and frontend dependency graphs,
runs the authenticated integration suite, and watches backend Partner composition,
Sales consumers, Partner frontend adapters, and shared navigation for changes.

## Release boundary

### Current #334 review follow-up (2026-09-03)

The previous green validation run is not release acceptance: both independent
reviews returned blocking findings. The candidate has changed since that run and
requires fresh complete validation and two passing independent reviews.

The product owner approved the Partner document policy recorded in ADR-0046:
atomic issuance retains the price-free customer waybill and a wholesale statement
restricted to authorized internal Accounting users. Ordinary shipment behavior is
unchanged. The document service now checks the audience separately for retrieval,
mixed print requests, retry, adjustments, and the combined pricing read model.
The immutable allocation revision has an explicit source discriminator; historical
allocations retain `SALES_CONTRACT` semantics. Real-schema access tests cover an
isolated legacy-corruption grant, current internal authorization and revocation.

The real-schema retail correction journey now exercises the authenticated HTTP
request/scope/save routes, immutable sequenced workflow evidence, the canonical
Case revision/projection writer, a fresh customer output and actual OTP verification
with only SMS delivery replaced by a local capture adapter. OTP and successor
activation occur atomically; revision-owned payment plans are staged during the
successor's assembly and remain excluded from effective plan readers until activation.

The physical integration is complete. A committed Partner Case now supplies an
explicit revision-bound loading source through the existing Logistics and Guard
path: loading creation, driver reservation, canonical allocation, financially
gated finalization, paired document issuance, confirmation, physical exit, and
shipment evidence all retain the stable Case/Delivery/lineage owner. An emergency
operational pause or later cohort deactivation still blocks uncommitted commercial
mutation while preserving this already-committed fulfillment obligation. Real-schema
HTTP regressions exercise create, reserve, allocate, and finalize while paused and
outside an active cohort, plus release and Guard close remediation.

The existing immutable shipment-evidence table and shared quantity reducer now
support an explicit Partner Case/lineage source without customer ContractItems.
Database constraints reject mixed ordinary/Partner ownership and wrong revision
hashes. Materialization uses the frozen Case recipient, validates replay hashes,
and records contracted quantity. Effective retail/shared successors synchronize
already-materialized obligations atomically, retaining removed lineages with zero
current obligation. Reads reconcile all expected rows against exact revision-bound
baselines, expose missing/stale coverage, and use the same effective instants as
capture. Historical rows remain retained; current reports exclude only fully-zero
retired rows and reject outstanding retired balances or incomplete active rows.
Focused independent re-review passed these shipment fixes; this is not whole-flow
or whole-candidate acceptance.

Accounting collection reads now consume dated receipt/cheque-clear/reversal
movements, not mutable received labels; missing ledger coverage fails closed.
Official obligations are selected by their published approval, not a newer pending
draft. Net-sales adjustments exclude tax/charges while official receivables retain
the full payable. Invoice voiding preserves receivable provenance. Correction
command replay rechecks current authority.

The Accounting replacement workflow is now staged and append-only: settlement or
reversal evidence, current Accounting approval, and successor publication are
validated together before the successor becomes effective. Real-schema tests cover
financial and physical voiding, replay, concurrent writers, retained lineage, and
corrupted evidence that must fail closed.

Latest full validation (2026-09-04): `node scripts/run-partner-sales-tests.mjs all`
passed the complete unit, transport, lifecycle/downstream (65/65), foundation,
typecheck, live-browser (5 passed with 3 intentional duplicate-mutation skips), and
authenticated real-schema/API (6/6) gates. The final-candidate manifest is
`partner-qa-184d0694-3546-47a8-a134-12cb227f11a0`; source HEAD is
`1a222ab0476b334ec6dfe61c06c90e3552504146`, review base is
`f0b116e1dad634f0026bc37982050a3f683def86`, and the validated staged-content patch
identity (all issue content except this self-describing evidence file) is
`00ea121bc2cfcb29f834529b7596e4a8aa8b4276`. The manifest records cached patch
`e103c7c346590b6c4ba5090bc61d57971de586ac98496e8c93a0c06502bcb867`, working patch
`f94f6fee0fb8450abad866e2a13b565bc2cc67809611b4f0fab1579b432ac989`, exact schema
hash `58ee6e50c449e0b8c0bd473399e9b779`, 223 applied migration-ledger rows, isolated
browser database cleanup, candidate container identities, and restoration of the
normal local runtime. Prisma independently reports 221 migration directories, a
valid schema, no pending migration, and an up-to-date local database; the differing
counts describe ledger rows versus migration directories rather than a schema gap.
The production build, architecture ownership check, design-system checks (25/25 and
14/14), Prisma validation/generation, and idempotent migrate-deploy check also passed.
Rendered A4 Partner documents were visually inspected: the customer waybill is
price-free and the separate wholesale statement is legible and priced. Unscoped
Accounting HTTP regressions prove that Partner retail contracts are absent from both
ordinary contract listings and workspace aggregation; approval regressions prove one
central authorization audit per invocation and replay.

These results authorize candidate review and issue integration only. They do not
authorize deployment, production cohort activation, or live SMS.

Issue 334 composes the runtime and proves the candidate; it does not activate a
production cohort, deploy, or send real SMS. Persistent local and production
cohorts remain disabled and paused. The browser suite temporarily enables and
unpauses only its namespaced cohort inside an isolated database, then drops that
database during cleanup. Issue 335 remains the independent combined-candidate QA
gate, and issue 336 must explicitly approve any later cohort activation.
