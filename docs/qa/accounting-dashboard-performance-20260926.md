# Accounting dashboard performance verification — 2026-09-26

The existing `sabalanerp-local` Compose project was healthy before database work. The local database contained 327 reviewable contracts. No production request waterfall or current production p95 was available; the reported user experience is usually at least ten seconds.

| Local measurement | Observed time |
| --- | --- |
| Earlier deployed-image workspace service, authenticated actor | 415 ms |
| Earlier deployed-image six-month trend service, same actor | 1324 ms |
| New complete dashboard service after endpoint consolidation | 1523–1750 ms over three exploratory calls |
| New complete dashboard service after lighter projections and contract-read overlap | 1333–1567 ms over three exploratory calls |

These are warm local service-call observations, not browser timings, production-size load tests, or a controlled comparison of identical images. The 3-second p95 goal remains unverified until an authorized deployment is measured under ordinary production data and concurrency.

The targeted safety checks cover exact chart movement and cutoff behavior, the authorized complete-dashboard response, the shared-reader/exclusive-writer lock boundary, deadline totals and register navigation, backend and frontend builds, database-client ownership, and Sabalan Design System adoption. The operational-drilldown integration test's direct route-handler mock was updated to supply its required authenticated actor, and the test passes against the existing local services.
