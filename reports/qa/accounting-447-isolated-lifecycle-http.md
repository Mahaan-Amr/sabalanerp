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

## Integration replay with concurrent local work

After merging into integration, the same opt-in qualification passed on 2026-11-15 with the ownership-safe temporary database cleanup change (`a417a66b`). During this replay, a backend TypeScript build ran concurrently, and the separate temporary-database cleanup probe overlapped the later part of the run. The dashboard p95 was **3,744 ms**, above the original run's three-second observation; the reviewable list p95 was **2,115 ms**. This replay passed all count, source-filter, route, and revocation assertions and had no `P2028`. The concurrent work is a possible source of timing variation, not a proven cause.

| Complete request | Replay samples (ms), sorted | Nearest-rank p95 |
| --- | --- | ---: |
| Dashboard | 2022, 2175, 2316, 2347, 2391, 2400, 2403, 2563, 2662, 2665, 2795, 2870, 2991, 3152, 3179, 3293, 3440, 3531, 3744, 3778 | 3744 ms |
| Reviewable list | 1820, 1834, 1840, 1872, 1880, 1896, 1907, 1916, 1930, 1936, 1964, 1997, 2006, 2009, 2013, 2015, 2056, 2109, 2115, 2166 | 2115 ms |

After the build, cleanup probe, and another isolated qualification had fully exited, the same qualification passed again without concurrent QA work. The quiet replay measured dashboard p95 **2,133 ms** and reviewable list p95 **1,948 ms**. The difference is consistent with local contention affecting the earlier replay, but these runs alone do not isolate its cause or establish a concurrent-load target.

| Complete request | Quiet replay samples (ms), sorted | Nearest-rank p95 |
| --- | --- | ---: |
| Dashboard | 1834, 1873, 1884, 1901, 1901, 1913, 1933, 1936, 1948, 1954, 1965, 1971, 1973, 2017, 2029, 2053, 2063, 2064, 2133, 2199 | 2133 ms |
| Reviewable list | 1776, 1806, 1810, 1813, 1817, 1819, 1824, 1827, 1830, 1844, 1859, 1872, 1873, 1880, 1893, 1899, 1910, 1922, 1948, 2303 | 1948 ms |

## Reproduction and remaining gates

Set `CONTRACT_RECOVERY_TEST_DATABASE_URL` to the existing local PostgreSQL URL for `/sabalanerp`, set `ACCOUNTING_447_QUALIFICATION=1`, then run `tsx --test --test-name-pattern='Accounting qualification creates' backend/src/services/__tests__/partnerCaseDraft.integration.test.ts` from the repository root. The test manages the temporary database and cleanup. It is skipped during ordinary test runs.

At this initial stage, the valid fixture verified counts, source filters, complete dashboard and first reviewable page, but did not exhaust every authorized ID, ordering tie, page, filter, financial action, private customer projection, or concurrent mutation/revocation case. It also did not call the customer workspace or internal-document routes. The 43-Case authority and concurrent revocation tests in [accounting-447-authority-batch.md](accounting-447-authority-batch.md), and historical/customer-focused authenticated tests in [accounting-447-local-read.md](accounting-447-local-read.md), cover different seams; they do not convert this fixture into a full parity proof. Production-state admission remains open under #448.

## Exact fixture parity follow-up

A follow-up on `codex/accounting-447-parity-followup`, based on integration `dfcfadb0`, kept the same lifecycle-created 30 committed and 13 draft Cases. It placed 935 ordinary Contracts under a separate direct CRM customer, since a Partner-owned customer is intentionally excluded from the customer workspace. All ordinary Contracts shared one `createdAt` to exercise an ordering tie. The authenticated HTTP probe retrieved all ten reviewable pages and compared their 965 unique IDs to the fixture's exact 935 ordinary IDs and 30 committed internal record IDs. The ordinary source's first page followed ascending ID under the tie. Source, `DRAFT`/`SIGNED` status, and ordinary contract-number search filters returned the expected populations. Preparation-only Partner rows exposed internal document context and `CREATE_INVOICE`, while the focused internal-document route returned `COMMITTED` evidence for three Cases. The direct customer's workspace returned exactly the 935 ordinary Contracts, with no Partner retail Contract.

The probe started concurrent dashboard and reviewable reads while adding one ordinary Contract; the next read had exact total 966. It then started both reads during actor deactivation: both in-flight responses completed HTTP 200, and subsequent dashboard, list, customer workspace, and internal-document requests each returned HTTP 401. This verifies eventual revocation at those routes, but the in-flight HTTP 200 responses do not establish a stronger instant revocation guarantee. Filters beyond those named above, all financial action transitions, and mutation snapshot linearizability remain outside this fixture's proof.

An intermediate concurrency attempt used the temporary harness's `connection_limit=2`. Its sequential assertions passed, but the two in-flight revocation reads logged Prisma `P2024` pool timeouts that were not yet asserted, so that attempt is a **failed concurrency qualification**. The probe was corrected to assert both responses and use `connection_limit=10`, matching the local backend Compose configuration; `pool_timeout` remained explicit. The final run passed without `P2024` or `P2028`. Twenty sequential full HTTP samples measured dashboard p95 **2,035 ms** and reviewable p95 **2,254 ms**. The temporary database was dropped after the run; the six existing services and serving data were preserved. These timings remain local fixture evidence, not production-state or concurrent-load admission.
