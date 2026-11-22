# Accounting #447 production-shaped local qualification: blocked

Observed 2026-11-15 on `codex/accounting-447-qualification`, based on integration `fc94fac0`. This is a fixture feasibility finding, **not** a production-shaped performance result or release admission.

## Verified target and starting population

`docker compose -f docker-compose.local.yml ps` showed the existing six `sabalanerp-local` services healthy before database inspection: backend, frontend, Inquiry, ClamAV, PostgreSQL, and Redis. No service was started, rebuilt, or reconfigured. Read-only SQL against that PostgreSQL service found 869 ordinary Sales Contracts and 39 Partner Cases: 27 committed, 6 cancelled, 4 draft, and 2 voided. There are 126 Case revision rows and 24 Partner internal financial records. The minimum count delta to the observed production shape is 66 ordinary contracts and 4 Cases, including 3 committed Cases.

## Why the available fixture is insufficient

`backend/src/services/__tests__/accountingScopeScale.integration.test.ts` reaches 935/43 in an isolated database, but creates 42 Cases using raw inserts after `SET LOCAL session_replication_role = 'replica'`. Those rows have no real head/committed revision, lifecycle event, commercial preparation, or financial witness. That fixture tests authority decisions; it cannot establish complete authenticated dashboard or reviewable-list correctness or latency.

`backend/src/services/__tests__/partnerCaseDraft.integration.test.ts` does exercise the real Case command and commercial lifecycle, including the approved inquiry, revision, customer acceptance, and financial preparation paths. Its `fixture()` deliberately rolls back one transaction. Reusing it in the serving database requires a committed, uniquely namespaced creation path and a verified dependency-aware cleanup path. Neither exists in the repository now. An isolated test database would keep the six services intact, but the serving backend points at the normal database and would not exercise those records through its authenticated API. Raw Case inserts or leaving persistent QA financial records behind would give an invalid or unsafe result.

## Qualification still required

Create a reviewed lifecycle-backed fixture with owned IDs and cleanup in `finally`, then prove pre/post counts and witnesses in the existing database. For complete authenticated dashboard and reviewable-list requests, assert exact authorized IDs, totals, page count, filter/order behavior, source actions, private Partner exclusion, and all dashboard sections. Run concurrent revocation; measure declared cold/warm samples and nearest-rank p95 for both complete API calls; inspect request errors and PostgreSQL/Prisma logs for zero `P2028` and 30-second read expiries. Recheck the six service identities and data after cleanup. The current read measurements in the earlier #447 reports do not meet this gate.

No QA rows were inserted, no load test was run, and no p95 claim is made here. #447/#448 production-shaped and production-state admission remain open.
