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
- Sales contract detail now resolves an explicit `PARTNER_CUSTOMER` link through
  the lifecycle owner's full hash/provenance rebuild. A missing, unauthorized, or
  mismatched projection fails closed instead of rendering ordinary contract data.

## Verification and evidence

`npm run test:partner-sales:integration` runs the request-bound transport and
strict-projection tests and stores an immutable manifest below
`test-results/partner-sales/`. The `all` harness mode includes this suite.

The real-schema `db` mode additionally creates a namespaced user/workspace grant in the
existing `sabalanerp-local` database, authenticates through the current session,
checks both Partner shell routes remain closed without a Partner-domain grant, calls the live workspace endpoint, verifies the
session actor and no-store boundary, rejects a browser actor override, and removes
only its namespace. The standard fixture concurrency and foreign-reference cleanup
guards run in the same mode.

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

This candidate is not yet complete for issue 334. It composes the authenticated
management/responder reads and a Sales detail consumer, but production adapters and
mounted transports are still absent for Case submission/lifecycle, Accounting,
fulfillment, customer output/OTP/PDF, collections, reports, correction/voiding and
operations. Profile activation is also deliberately not projected until a new
versioned workspace DTO carries the owner-required opaque gate evidence. Issue 335 validates the combined implementation after those #334 gaps
are closed; it does not own their runtime composition. Issue 336 must explicitly
approve cohort activation after that evidence is reviewed.
