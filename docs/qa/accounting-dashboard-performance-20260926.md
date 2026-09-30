# Accounting dashboard performance verification — 2026-09-26

The existing `sabalanerp-local` Compose project was healthy before database work. The local database contained 327 reviewable contracts. No production request waterfall or current production p95 was available; the reported user experience is usually at least ten seconds.

| Local measurement | Observed time |
| --- | --- |
| Earlier deployed-image workspace service, authenticated actor | 415 ms |
| Earlier deployed-image six-month trend service, same actor | 1324 ms |
| New complete dashboard service after endpoint consolidation | 1523–1750 ms over three exploratory calls |
| New complete dashboard service after lighter projections and contract-read overlap | 1333–1567 ms over three exploratory calls |

To compare the read boundary under the same source build and local data, I ran three sequential warm service calls per row with one authenticated actor and the six-month chart range. The *previous-lock* pass temporarily restored the original `FOR UPDATE` read lock; I then restored the implemented `FOR SHARE` lock. No database records were changed by this comparison. Values are individual calls in milliseconds:

| Service call | Previous `FOR UPDATE` read lock | Implemented `FOR SHARE` read lock |
| --- | --- | --- |
| Shared Accounting read scope only | 399, 459, 786 | 382, 262, 245 |
| Standalone workspace | 487, 354, 426 | 371, 347, 342 |
| Standalone six-month chart | 1327, 1297, 1352 | 1291, 1072, 1179 |
| Combined dashboard | 1242, 1451, 1420 | 1065, 1136, 1131 |

The standalone workspace and chart currently require two separate read scopes; the combined dashboard uses one. These small warm samples show local behavior but cannot isolate every source of variance or establish a p95. The earlier deployed-image measurements above represent the pre-consolidation implementation; they were not obtained from the same image as this controlled lock comparison.

These are warm local service-call observations, not browser timings or production-size load tests. The exploratory before/after implementation rows do not compare identical images. The 3-second p95 goal remains unverified until an authorized deployment is measured under ordinary production data and concurrency.

The targeted safety checks cover exact chart movement and cutoff behavior, the authorized complete-dashboard response, the shared-reader/exclusive-writer lock boundary, deadline totals and register navigation, backend and frontend builds, database-client ownership, and Sabalan Design System adoption. The operational-drilldown integration test's direct route-handler mock was updated to supply its required authenticated actor, and the test passes against the existing local services.

The broad Partner integration command passed the Accounting list deadlock scenario and other preceding cases, then failed in a dispatch-document scenario because the local Puppeteer Chrome binary (`152.0.7977.75`) was unavailable. That environment failure does not establish a regression in the Accounting dashboard; the complete broad suite remains unverified here.
