# Partner QA baseline — #314

This is the initial **Module harness**, not acceptance of Partner sales, the whole ERP, or release activation. Approved requirements: [#314](https://github.com/Mahaan-Amr/sabalanerp/issues/314), the final resolution of [#308](https://github.com/Mahaan-Amr/sabalanerp/issues/308), `CONTEXT.md`, and ADR-0046. Integration and final acceptance belong to #334 and #335.

## Ownership and interfaces

QA owns `tests/partner-sales/`, `docs/qa/partner-sales/`, `playwright.partner-sales.config.ts`, `scripts/run-partner-sales-tests.mjs`, and `.github/workflows/partner-sales.yml`. No application, schema, lockfile, route, shell, or existing CI file is changed by this ticket. The #313 shared-file owner authored the three root script aliases below and explicitly handed that isolated `package.json` diff to #314 for publication.

Harness interface: `partner-qa-harness/v1`. The consumer pins **`@sabalanerp/partner-sales-contracts@1.0.0`, schemaVersion 1**, using only public `.` and `/testing` exports owned by #313. The `foundation` check consumes `createPartnerFixtures`, `FixedTransactionClock`, `SandboxNotificationGateway` and `FixturePartnerQueryAdapter`; it verifies the exact expiry boundary, safe/retryable sandbox delivery and purpose-specific fixture queries. These are contract checks, not actual OTP verification, production authorization or live Partner submission. No substitute Case schema, invented Partner role, local fake clock or DTO is provided. The final published foundation SHA is recorded in `baseline.md` before #314 delivery.

The #313 shared-file coordinator supplied these root scripts; #334 owns future shared wiring:

| Root script | Callable command |
| --- | --- |
| `test:partner-sales` | `node scripts/run-partner-sales-tests.mjs unit` |
| `test:partner-sales:local` | `node scripts/run-partner-sales-tests.mjs all` |
| `test:partner-sales:inventory` | `node scripts/run-partner-sales-tests.mjs check-inventory` |

Direct commands and the reserved workflow also work without those aliases. CI's protected `partner-sales-qa` environment and `[self-hosted, sabalanerp-local]` runner require infrastructure-owner setup. Hosted CI runs infrastructure/foundation contracts, typecheck and inventory freshness; local database/browser QA runs only from explicit trusted `workflow_dispatch` on `main`. It does not rebuild the runtime. Other runtime-changing jobs must be coordinated by that owner.

## Reproduce

Install the existing root, canonical graph, Partner foundation and frontend locked dependencies; build the canonical graph before installing/building its Partner consumer; install Chrome for the root Playwright version. Node 22 is the CI runtime. Use the repository checkout as the working directory. The workflow records this order explicitly; foundation build outputs must exist before its consumer check.

```powershell
node scripts/run-partner-sales-tests.mjs unit
node scripts/run-partner-sales-tests.mjs foundation
node scripts/run-partner-sales-tests.mjs typecheck
node scripts/run-partner-sales-tests.mjs check-inventory
node scripts/run-partner-sales-tests.mjs db
node scripts/run-partner-sales-tests.mjs browser
# Complete applicable #314 suite, including all of the above:
node scripts/run-partner-sales-tests.mjs all
```

Only the existing healthy `sabalanerp-local` project is accepted. Fixed loopback ports: frontend 3000, backend 5000, PostgreSQL 55432, Redis 56379. Do not override the database or Docker context to make a failing preflight pass. The runner checks project/service identity, health, published ports, local Docker socket, backend database target, non-production mode, and credential-free SMS sandbox before runtime access. It checks `docker compose -f docker-compose.local.yml ps` before every additional Docker operation. HTTP readiness and API calls reject redirects. SQL goes through the verified PostgreSQL service, never an inherited `DATABASE_URL` or host PostgreSQL connection.

No stack creation, migration, seed of shared users, production access, external gateway, or real SMS is part of these commands. Browser requests are limited to same-origin GET/HEAD. Authenticated API checks use a 20-minute, fixture-owned session with a disabled password, not an existing user's password or an Admin impersonation. The API baseline is an authorization/entry test; it is **not a login-flow or sales-submission test**.

## Fixture lifecycle and cleanup

`createFixture(namespace)` commits exactly four namespaced rows: one USER, one Sales workspace view grant, one explicit create feature grant, and one short-lived session. Namespaces must be `partner-qa-<UUIDv4>`; a seed collision fails atomically without upsert. Token material remains in process memory, is never printed, and no authenticated browser trace is captured.

`withFixture(namespace, callback)` removes owned rows in `finally`, including assertion/API failures. Cleanup runs transactionally, locks owned rows, checks ownership, and refuses unexpected foreign-key dependencies instead of cascading through business records. Composite or non-ID referenced keys fail closed for owner review. A refusal rolls back cleanup; do not widen deletion criteria. Repeat cleanup is safe. Tests prove failure cleanup, duplicate-seed rollback, simultaneous namespace preservation, alternate-key refusal, and before/after fingerprints of non-fixture users, sessions, grants, Sales Contracts and CRM Customers. The alternate-key test creates a namespaced table inside one transaction and rolls back all DDL. These checks do not claim that every database table is unchanged.

Coordinate a stable runtime and business-data window with other active QA tasks for the fingerprint comparison. An unrelated concurrent write legitimately fails this evidence check; preserve the failure and rerun after coordination rather than ignoring the changed table.

Power loss, process kill or unavailable Docker can prevent `finally` from completing. Inspect the run's logged namespace and use the same guarded recovery command once the local stack is healthy:

```powershell
node scripts/run-partner-sales-tests.mjs cleanup partner-qa-<the-exact-UUIDv4>
```

Never truncate tables or delete by prefix, email domain, role, or age. The harness must not erase a committed Partner Case; ADR-0046 retains such evidence even when Draft/Cancelled. Future real Case fixtures need an approved rollback or retention-compatible harness from the domain owner.

## Coverage and evidence

[inventory.md](inventory.md) enumerates every current ERP and auxiliary inquiry page/route handler, exported server actions, all legacy feature actions and the separate HR action catalog, with workspace, business personas, acceptance owner and explicit status. It is generated from source, not from a screenshot or an assumption about enabled grants. Prototype routes are `not-applicable` to production acceptance; other entries remain `blocked` until their role-specific workflow is actually exercised. A route's presence does not prove that it is enabled for a given user.

[coverage-ledger.md](coverage-ledger.md) records the narrowly executed baseline and outstanding Partner flows. `pass`, `fail`, `blocked`, and `not-applicable` are the only outcomes. Passing one navigation or API assertion never promotes the whole route/workspace. The source inventory is deliberately independent of the run result: a future route/action change fails `check-inventory` until its new coverage rows are reviewed.

```powershell
node scripts/run-partner-sales-tests.mjs inventory
git diff -- docs/qa/partner-sales/inventory.md
```

Each runner invocation writes a unique `test-results/partner-sales/partner-qa-<UUID>/` directory containing a manifest and full machine-readable inventory. Browser runs additionally retain all four project traces, login screenshots and Playwright JSON results. Capture details and limitations are in [evidence-manifest.md](evidence-manifest.md). Review screenshots before calling visual QA passed; generated images alone are not visual acceptance. No authenticated financial payload, OTP or token belongs in an uploaded artifact.

Legacy defects are recorded in [defects.md](defects.md), with reproducer, affected role/path, runtime identity, evidence and responsible owner. Keep the affected ledger row failed; do not silently fix another lane or suppress an unexpected failure. The anonymous redirect's known 401s on `/api/auth/me`, `/api/dashboard/profile` and `/api/dashboard/route-availability`, and the exact corresponding `Auth check error` 401 message, are expected authentication rejections. The observed cancelled login requests/RSC fallback are tracked separately as open `LEGACY-314-01` in browser attachments; functional browser success does not claim clean diagnostics. Other console/network failures still fail tests.
