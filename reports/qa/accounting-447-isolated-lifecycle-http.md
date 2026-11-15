# Accounting #447 isolated lifecycle HTTP qualification

Observed 2026-11-15 on `codex/accounting-447-isolated-qualification`, based on integration `689f00d2`. This is a production-shaped **local fixture** result, not production-state release admission.

## Target, population, and ownership

Before the run, `docker compose -f docker-compose.local.yml ps` identified the existing six healthy `sabalanerp-local` services. The test uses only their PostgreSQL service. `createPartnerLifecycleDatabase` clones its schema into a uniquely named temporary database, verifies the Compose target again, and drops that database in `finally`. No serving database QA rows or second Compose project were created.

The test made 935 ordinary Sales Contracts and 43 Cases. The Cases used the actual submit, approved-inquiry pricing, commercial approvals, customer acceptance, and commitment lifecycle; 30 became `COMMITTED`. It verified 73 Case revisions and 30 `CASE_COMMITTED` events. The remaining 13 Cases were drafts. The accountant was a real active admin user with explicit Accounting workspace permission and an authoritative session. The probe sent its session cookie and actor/session binding headers through the Accounting Express router and middleware, using the isolated database as the application's runtime database in a child process.

## Results

Twenty sequential, complete HTTP requests were made for each surface, with nearest-rank p95. All responses were HTTP 200 with successful bodies. The complete dashboard's reviewable count and reviewable list's exact total were 965. Source filters returned 935 ordinary contracts and 30 Partner internal records, with no Partner internal rows in the ordinary response. Seven additional authenticated routes returned successful bodies: financial records, receivables, payments, tax, correction requests, audit, and performance. Deactivating the actor made the next dashboard request return HTTP 401.

| Complete request | Samples (ms), sorted | Nearest-rank p95 |
| --- | --- | ---: |
| Dashboard | 1863, 1894, 1901, 1901, 1910, 1912, 1916, 1935, 1938, 1944, 1972, 1979, 1983, 1986, 2014, 2015, 2055, 2117, 2121, 2174 | 2121 ms |
| Reviewable list | 1771, 1773, 1778, 1781, 1802, 1825, 1826, 1826, 1846, 1856, 1856, 1864, 1918, 1920, 1939, 1942, 1948, 1958, 1999, 2000 | 1999 ms |

No request returned a Prisma `P2028` or 30-second read expiry. This establishes the two local fixture p95 values below three seconds under this sequential workload. It does not establish concurrent-load or production-state p95.

## Reproduction and remaining gates

Set `CONTRACT_RECOVERY_TEST_DATABASE_URL` to the existing local PostgreSQL URL for `/sabalanerp`, set `ACCOUNTING_447_QUALIFICATION=1`, then run `tsx --test --test-name-pattern='Accounting qualification creates' backend/src/services/__tests__/partnerCaseDraft.integration.test.ts` from the repository root. The test manages the temporary database and cleanup. It is skipped during ordinary test runs.

The new valid fixture verifies counts, source filters, complete dashboard and first reviewable page, but does not exhaust every authorized ID, ordering tie, page, filter, financial action, private customer projection, or concurrent mutation/revocation case. It also does not call the customer workspace or internal-document routes. The 43-Case authority and concurrent revocation tests in [accounting-447-authority-batch.md](accounting-447-authority-batch.md), and historical/customer-focused authenticated tests in [accounting-447-local-read.md](accounting-447-local-read.md), cover different seams; they do not convert this fixture into a full parity proof. Production-state admission remains open under #448.
