# Sales XLSX contention measurement

Issue [#491](https://github.com/Mahaan-Amr/sabalanerp/issues/491) compares Sales reads while the report service generates an actual workbook with the same reads while no export is running.

## Setup

- Node 22.23.4 on the Windows development host, authenticated Express loopback requests against PostgreSQL in the existing `sabalanerp-local` project.
- One department-scoped Sales manager reads a 20-contract population, while another department-scoped Sales manager requests a 12,000-contract workbook with the default sheets and columns. The fixture uses generated accounts, namespaced records and fixed dates and amounts. The harness checks the reader's scope and population, then cleans up its fixtures.
- Each benchmark pairs three quiet and three export windows with 125 sequential real HTTP requests per window. The intended dispatch interval is 20 ms. The HTTP p95 runs from actual dispatch to the complete response. The harness separately records latency from scheduled arrival, which includes backlog when one reader cannot keep pace.
- Event-loop delay uses a 5 ms histogram resolution. Memory deltas are sampled peaks above each window's start. Main heap excludes worker-isolate heap and RSS includes the full process. A synchronous block can delay the sampling callback, so recorded peaks are lower bounds.

## Matched source runs

The synchronous reference keeps the original workbook encoder in the API process. The worker candidate here uses the same Sales report path and fixture before #490 was merged. Values are ranges across the three windows.

| Run | HTTP read p95 (ms) | Worst HTTP read (ms) | Worst event-loop delay (ms) | Main heap above start (MiB) | RSS above start (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Synchronous reference, quiet | 33.46–34.38 | 39–83 | 17–19 | | |
| Synchronous reference, export | 48.34–50.22 | 921–949 | 323–325 | 210–217 | 350–358 |
| Worker candidate, quiet | 36.28–47.21 | | | | |
| Worker candidate, export | 50.18–59.46 | 372–1066 | 320–333 | 211–226 | 354–422 |

Both served 6,263,911-byte files. The synchronous request took 1,691–1,843 ms and the worker request took 2,133–2,349 ms. The worker does not demonstrate an end-to-end read-latency or memory improvement in these windows.

An isolated 12,000-row contract worksheet using the actual synchronous encoder held the API loop for 161–194 ms, compared with an 18 ms idle maximum. It added 36.4–41.2 MiB to main heap and produced a 4,166,908-byte workbook. This isolates an event-loop stall during encoding even though the full authenticated workload has additional blocking.

## Verification

The authenticated worker test verified 401 without a session, 429 on an overlapping export, and 403 with no attachment after an in-flight Sales permission downgrade. Retrying after restoring the grant returned a private attachment with the original filename and exact bytes from the synchronous reference on the same fixture.

Use the compiled backend and the existing local database connection to repeat the benchmark. Add `--verify-only` to exercise authorization, overlap, retry and byte parity without timing windows. Add `--diagnose` to measure canonical report construction and encoding in isolation while the authenticated reader remains active.

```powershell
node --expose-gc backend/dist/scripts/measure-sales-report-export.js 12000 --verify-worker
node --expose-gc backend/dist/scripts/measure-sales-report-export.js 12000 --diagnose
```
