# How to bring production Accounting under three seconds

The production browser comparison put the median complete dashboard load at **7.29 s** and the median first page of reviewable contracts at **7.33 s**. Those are the first two targets. Cross-department duties needs a separate change because its two after samples took **11.73 s and 22.46 s**. The dashboard's accepted target is complete, fresh, authorized content, including the financial chart. [Production comparison](accounting-production-comparison-20261124.md) · [Dashboard specification](../specs/accounting-dashboard-fast-fresh-load.md)

## Where the time goes

Source review used the deployed commit `697e8946e61cc2811072c5ffdb7f1f769d6e05ef`. Production request measurements are small, naturally occurring samples around the browser sweep.

| Deployed backend measurement | Dashboard full or workspace group, 5 GETs | Contracts, 3 reviewable GETs |
| --- | ---: | ---: |
| Median total request | 6.80 s | 4.88 s |
| Median population work | 2.86 s | 2.36 s |
| Median authorization | 1.12 s | 1.01 s |
| Median measured lock wait | 13 ms | 8 ms |
| Median visible-row hydration | 29 ms | 64 ms |

The sample groups use the new request observer. Its dashboard label combines full and workspace requests. The separation here uses the presence of a row-hydration measurement. Stage timings overlap and do not cover every part of the request. The small lock-wait sample gives little reason to prioritize lock changes for Accounting reads. Receivables and payments each used about 2.8 s in the server in their one measured sample, before browser overhead.

The initial after window also had four `P2028` log entries in the same seconds as four unread-notification HTTP 5xx responses. A later window from 17:36 to 20:55 Tehran time had 42 unread-count GETs with no 5xx and no `P2028` markers in the serving backend logs. Only three instrumented Accounting GETs appeared in that later window. The correlation in the first window identifies where to investigate, while its logs lack the stack and correlation fields needed to identify the failing call.

## Implementation order

### 1. Reduce the work shared by Accounting reads

In `backend/src/services/partnerSales/accounting/readScope.ts`, `createScope` does three jobs. It fences and authorizes Partner Cases, detects hidden or ambiguous provenance across multiple record families, and reconstructs and validates the authorized financial population. Compact reads pay for much of this even when they display a single record family. Broader views currently validate related invoices, payments, receivables, taxes and audit witnesses before yielding any result.

Start by timing the scope's marker queries, Case authorization and audit append, financial witness validation by family, and time between transaction acquisition and completion. Inspect the actual database plans and query counts on the existing `sabalanerp-local` services with representative history and indexes. The current marker indexes and batched Case authority are already present.

Then define the read dependencies for each surface. Keep owner and fail-closed provenance predicates before page selection and aggregation. Bound expensive preparation, child evidence and audit reconstruction to the data needed for the endpoint's membership, totals and display. Retain checks that intentionally enforce a whole-population integrity rule until equivalent coverage is demonstrated. When exact current totals depend on validated history, test indexed relational summaries updated in the same transaction as the source, keyed by owner and source revision. Prove backfill parity on legacy evidence, including ambiguous or orphaned records and revocation during a read. Keep existing shared read fences, audit decisions and write-side reauthorization. [Shared read boundary](../adr/0102-share-partner-read-lock-while-excluding-writers.md) · [Accounting read authority](../adr/0122-authorize-partner-accounting-reads-from-existing-accounting-scope.md)

### 2. Page the real reviewable list in PostgreSQL and reuse its summary for the dashboard

`readAccountingContractPage` in `backend/src/services/accountingService.ts` permits SQL paging only when `!query.view`. The default Accounting link uses `view=reviewable`, so it still fetches ordinary candidates and collections, builds summaries, merges Partner rows, sorts and slices in Node. The dashboard calls the same list function for its first 12 work-queue rows and count. Today's page-only hydration already costs tens of milliseconds. Reducing 50 rows to 25 leaves the full-population work in place.

Build a compact ranked population query for the default reviewable view first. Compute exact membership, count and monetary totals across the authorized population. Return one ordered page of IDs, then hydrate those IDs, including the existing date fallback. Use the same population inputs for the dashboard's count and first 12 work-queue rows, preserving its distinct attention ordering. Compare results against the current implementation for Partner and ordinary ownership, Decimal and currency normalization, status/date/search filters, ties, deep pages and empty results. Keep the existing full calculation for complex or precision-sensitive cases until each has an equivalent path.

### 3. Bound the dashboard's chart and counters

The full dashboard builds the workspace and reads the financial trend sequentially in one authorized snapshot. The trend currently reads the relevant invoice, payment and audit populations, then reconstructs historical values. The displayed six-month range can still depend on events before the range, especially for opening receivables and later corrections.

Measure workspace and trend separately inside the same snapshot. Use exact SQL counts or grouped aggregates for simple dashboard cards where semantics match. For the chart, test revision-bound monthly inputs with an exact opening balance and a bounded replay of later activity. Preserve Tehran/Persian periods, backdated events, voids, payment allocations, owner visibility and all drilldowns. The existing dashboard change versions can help invalidate derived work. Serving a cached private payload still requires current authorization and a matching source revision. Keep the workspace, financial chart and authorized metrics in the complete initial-load measurement.

### 4. Fix the duties queue and notification pressure on separate paths

- **Duties.** `DestinationDutyQueue.tsx` waits for the list and summary together. `getCrossWorkspaceDutySummary` runs assigned, available, manager triage and history passes, and `listDuties` authorizes candidates in batches of four. Add separate timings for active-list reads, summary, history and source adapters. Return the authorized list without waiting for optional badge counts. Build one active visibility pass for the list and counts, and count unseen history against the current receipt without loading detailed histories. Page the authorized history and preserve visibility and acknowledgement behavior. Measure complete summary time as well as time to the first actionable row.
- **Notifications.** The header starts two preview requests plus unread count on catch-up. The unread count reads all unread rows and runs current authorization. In the Partner branch, each row can open its own interactive transaction and rebuild immutable inquiry evidence. That is a concrete source of connection and query fan-out. The observed timeout still needs per-provider timing and request correlation. Fetch the exact badge count independently, fetch preview lists when opened, and batch distinct resource authorization with bounded concurrency and current scope checks. Verify that revoked grants, expired assignments and account changes clear data, and that a provider failure cannot be mistaken for an exact lower count.

## How to know it worked

Start with a working budget of **about 1.5–1.8 s p95 for the priority application requests**, leaving the rest of the three seconds for browser startup, transport and rendering. Confirm the budget using request and browser measurements. On a comparable production-shaped fixture, run the current and proposed builds under the same dataset, role, filters and load. Use the existing loopback browser runner and extend its coverage to the slow registers and duties, with durable data or an explicit empty state as the completion signal. For the dashboard, assert the chart and workspace have usable current data. Use at least 20 matched cold and warm samples per priority route and repeat with representative concurrent use through the authorized private qualification path.

Require browser p95 below three seconds for complete dashboard and actionable registers, exact result parity, and zero transaction expiries or failed requests in the qualification. Track notifications separately, including a large unread backlog and a valid concurrent revocation. For changes that touch the interactive UI or runtime database boundary, run the repository's Design System and architecture checks alongside the behavioral suite. This analysis used deployed source and production log reads. Proposed changes still need implementation and measurement. The deployed commit contains the runner at `scripts/measure-accounting-browser.mjs` and its instructions at `docs/qa/accounting-measurement-478.md`. [Production-state qualification](../../reports/qa/accounting-448-release-qualification.md)
