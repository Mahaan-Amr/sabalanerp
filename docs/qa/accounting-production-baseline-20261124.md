# Accounting production performance baseline · November 24, 2026

Production Accounting took **15.93–16.37 seconds** to show dashboard data and **13.39–17.12 seconds** to show the first 50 reviewable contracts. The attached trace independently recorded **17.39 seconds** for the dashboard API with HTTP 200. The slow loads reproduced on the November 23 production build. [November 24 post-update comparison](accounting-production-comparison-20261124.md)

## Release and measurement conditions

- Origin was `https://sabalanerp.com`. Browser assets identified `erp_20261123t081608z-3b748867a174-release` throughout the sweep, including the last repeated dashboard load. A read-only production backend inspection confirmed `APP_COMMIT=3b748867a1740f49967563960575a827833fed85`.
- The attached `download1` is a HAR network capture. Its SHA-256 is `a7db843aecc8e66efd6b4b0da2b470b0bc36efca3a5ca39b878747c0f9772ddd`. It covers request starts between 16:16:52 and 16:17:30 Tehran time and contains 114 entries for one dashboard navigation and its background traffic. The companion file retains timings and statuses for 51 selected requests. [Redacted HAR measurements](../../reports/qa/accounting-production-baseline-har-20261124.json)
- The live sweep ran from 16:33 to 16:41 Tehran time, using signed-in Chrome with administrator scope and normal caching. One navigation was issued at a time. Times run from the browser navigation command to the first polling observation of the scenario's visible content. For registers the signal was rows or a verified empty state. For other pages it was the menu, workspace content, or a named page marker. Those other timings may precede optional panel completion. The Partner filter was timed from selection to the appearance of a case link.
- These are browser spot checks. Samples are too few for p95. Browser polling and tool latency are included. No Accounting data mutations were required.

## Attached network capture

| Request or browser event | Samples | Time | Observation |
| --- | ---: | ---: | --- |
| Dashboard HTML document | 1 | 69 ms | HTTP 200 |
| Browser window load event | 1 | 725 ms | HTML and initial assets could load while data was pending |
| `GET /api/accounting/dashboard?range=6m` | 1 | 17,388 ms | HTTP 200. First-byte wait 17,272 ms. Transfer then took 114 ms for about 74.5 kB of response content. The request completed about 18.87 s after the document request started. |
| `GET /api/accounting/dashboard/change` | 2 | 772–1,829 ms | Both HTTP 200 |
| `GET /api/duties/workspaces/accounting/summary` | 2 | 6,215–6,469 ms | Both HTTP 200 |
| `GET /api/notifications/unread-count` | 5 | 1,879–19,935 ms | All HTTP 200. Two exceeded 18 seconds. |
| `GET /api/notifications` | 10 | 335–17,494 ms | All HTTP 200 |
| `GET /api/auth/me` | 15 | 62–428 ms | All HTTP 200 |
| `GET /api/hr-hiring/dashboard-metrics` | 4 | 299–665 ms | All HTTP 200 |

The document, profile, and HR metrics were fast during the captured load. The largest Accounting delay was waiting for the dashboard API response to start. Slow notification and duty requests overlapped the same navigation. The HAR cannot attribute the delay to a specific query, lock, connection pool, proxy, or network component.

The HAR contains 108 HTTP 200 responses, five 304s, and one 101 WebSocket upgrade. It contains no HTTP 5xx and no visible Prisma expiry marker in captured API response bodies. A prior read-only production investigation documented a 500 on a 50-row Accounting contracts request and a Prisma `P2028` after a 30-second interactive transaction expired in the Partner read scope. [November 15 Accounting incident](accounting-incident-20261115.md)

## Production backend log window

Read-only aggregation on the serving backend covered 16:15:00–16:42:30 Tehran time, including the HAR and browser sweep. The backend logged 11 lines containing `P2028` across 10 distinct seconds and zero lines containing `P2024`. Each of those 10 seconds also contained one unread-notification HTTP 5xx. This is a timestamp association. The available entries provide no shared request ID to prove a one-to-one mapping. The counts below include traffic from all sessions in the window.

| Read route | Requests logged | HTTP 5xx |
| --- | ---: | ---: |
| Accounting dashboard | 6 | 0 |
| Accounting contracts | 9 | 0 |
| Accounting contracts with `view=reviewable` (subset) | 6 | 0 |
| Duties | 159 | 0 |
| Notifications | 669 | 10, all on unread count |

The log search counted code occurrences, so 11 is a log-line count. The successful dashboard and contract-list HTTP results coexist with the browser's long data waits. The baseline therefore tracks slow successful loads and transaction-related failures as separate outcomes.

## Live production browser sweep

Accounting paths below are relative to `/dashboard/accounting` unless shown as full dashboard paths. Detail scenarios used live links and omit record identifiers. Durations are in milliseconds.

| Scenario | Observed ms | Visible result |
| --- | ---: | --- |
| Accounting dashboard | 16,370 / 15,929 | Dashboard data and financial-trend content |
| `/contracts?view=reviewable` | 17,116 / 13,386 | 50 rows each time |
| Reviewable list, switch to Partner type | 8,550 | A linked Partner case appeared |
| Contract detail | 4,932 / 2,061 | Two different ordinary contract dossiers |
| Partner case detail | 3,274 | Accounting dossier opened |
| Financial evidence review detail | — | No existing review link appeared on the two sampled ordinary dossiers |
| `/workflows/review` | 1,396 | Workflow links visible |
| `/workflows/money` | 1,014 | Workflow links visible |
| `/workflows/records` | 979 | Workflow links visible |
| `/workflows/reports` | 1,570 | Workflow links visible |
| `/dispatch` | 1,631 | 71 rows visible |
| `/dispatch-documents` | 923 / 779 | Dispatch document queue heading appeared. Second run confirmed neither the degraded nor denied state. An earlier generic readiness probe ended at 18,155 ms without establishing queue readiness. |
| `/invoice-candidates` | 9,870 | 50 rows |
| Invoice candidate detail | 2,596 | Financial record review |
| `/correction-requests` | 12,829 | 50 rows. Earlier probes ended at 9,506 and 12,002 ms before confirming readiness. |
| `/receivables?view=open` | 10,488 | 10 rows. Another run had unconfirmed readiness at 12,333 ms. The unfiltered route had unconfirmed readiness at 9,729 ms. |
| `/payments?view=due-soon` | 13,687 | Confirmed empty-state message. Another run had unconfirmed readiness at 12,080 ms. The unfiltered route had unconfirmed readiness at 9,747 ms. |
| `/customer-accounts` | 1,573 | 25 rows |
| Customer account detail | 1,915 | Account detail with table rows |
| `/treasury` | 2,888 | Treasury workspace content |
| `/ledger` | 1,869 | Ledger content with a table row |
| `/ledger/customer-rules` | 1,264 | Customer accounting rules content |
| `/supply-chain` | 2,232 | Supply-chain workspace content |
| `/period-end?tab=assets` | 2,198 | Period-end workspace content |
| `/period-end?tab=payroll` | 2,524 | Period-end workspace content |
| `/period-end?tab=reports` | 2,500 | Period-end workspace content |
| `/period-end?tab=close` | 1,891 | Period-end workspace content |
| `/tax?view=needs-attention` | 9,398 | 50 rows. Earlier probe ended at 6,136 ms before confirming readiness. |
| `/tax-center` | 1,531 | Tax center workspace content |
| `/audit` | 10,139 | 50 rows. Earlier probe ended at 6,116 ms before confirming readiness. |
| `/performance?view=last30days` | 934 | Accountant performance workspace content |
| `/settings` | 893 | Settings workspace content |
| `/settings/biometric-connector` | 1,269 | Scanner diagnostics displayed an error and retry. A prior generic probe did not confirm readiness. |
| `/duties` | 20,217 | Cross-department duty queue with linked items. Earlier probe ended at 8,219 ms before confirming readiness. |
| Duty detail | 1,299 | Linked duty content |
| `/replacement` | 1,934 | Replacement workspace content. Verification actions were outside this page-load sweep. |
| `/dashboard/hr/hiring?view=collateral-contracts` | 1,235 | Linked hiring workspace content |
| `/dashboard/hr/hiring/collateral-templates?view=active` | 1,243 | Linked collateral-template workspace content |

Unconfirmed readiness is an observation-window result. The table keeps those attempts distinct from successful observations and the visible scanner error. For the reviewable list, the browser visited the same URL planned for comparison. The live browser probe did not independently validate the API query parameters.

For log correlation, the dashboard probes started at 16:33:41 and 16:40:52 Tehran time. The two reviewable-list probes started at 16:34:02 and 16:40:06. The completed duties probe started at 16:39:21. The original HAR dashboard API request started at 16:16:54.467. These are client timestamps and may differ from server log time.

## Post-update comparison

**Status: production cutover verified and comparison recorded.** The eventual serving backend commit was `697e8946e61cc2811072c5ffdb7f1f769d6e05ef`. [Post-update results](accounting-production-comparison-20261124.md)

1. Repeat the browser scenarios in the same Chrome environment, from the same network and account scope, with matched filters and caching conditions. Capture several sequential passes and a HAR for the dashboard and reviewable list, including the exact `view=reviewable` API query. Check dashboard data, first rendered rows, empty and error states, and the content reached by each workflow link. Record response completeness and failures alongside timings.
2. Compare first usable content and complete HTTP time separately. Report per-surface counts, median, range, and percentage change when the signal and scenario match. Compare success and failure counts before calling a route faster. Keep isolated or local rehearsal data with its own provenance.
3. For the historical transaction issue, obtain the protected operator's bounded request and log records for the matched windows. Count `P2028` transaction expiries separately from `P2024` pool timeouts, HTTP 5xx, UI errors and incomplete requests. Break down Accounting dashboard, contract register, duties and notifications where logs allow attribution.
4. Use the existing private qualification workflow for the production-scale threshold. It calls for at least 20 full-response samples per priority surface, includes cold and warm requests, and tests p95 below 3 seconds with no transaction expiries. The existing browser measurement script is loopback-only. [Accounting production-state qualification](../../reports/qa/accounting-448-release-qualification.md)
