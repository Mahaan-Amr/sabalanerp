# Roadmap for Accounting page loads under three seconds

Production took a median 7.29 seconds to display the Accounting dashboard and 7.33 seconds to display the first 50 reviewable contracts after the November 24 update. Duties took 11.73 and 22.46 seconds. These are browser spot checks on deployed commit `697e8946e61cc2811072c5ffdb7f1f769d6e05ef`. [Production comparison](accounting-production-comparison-20261124.md) · [Source and timing analysis](accounting-under-three-seconds-20261124.md)

## What counts as done

| Surface | Browser completion signal | Proposed target |
| --- | --- | --- |
| Dashboard | Work queue, authorized metrics, deadlines and fresh financial chart are ready | p95 strictly below 3 s |
| Reviewable contracts | First 50 authorized rows or verified empty state, exact total and pagination controls | p95 strictly below 3 s |
| Invoice candidates, corrections, receivables, payments, tax and audit | First authorized page or verified empty state, with its required filters and totals | p95 strictly below 3 s on each route |
| Accounting duties | First actionable authorized queue, or its verified empty state. Measure summary badges independently and include them in the full-page result. | Both first actionable queue and full page p95 strictly below 3 s |
| Notifications | Exact authorized unread count and usable preview when opened | Zero unexpected errors and expiries in the matched workload. Report latency separately. |

Use **1.5–1.8 seconds at application p95** as an initial engineering budget for priority reads, then adjust it using measured browser overhead. Keep the other Accounting surfaces in the regression sweep, particularly dispatch documents and customer accounts. Record scanner diagnostics as a separate functional result. Compare the same roles, views and data across builds.

## Implementation sequence

| Milestone | Work | Dependency |
| --- | --- | --- |
| 0 | Add timing and capture a benchmark that fails at the current load times | Start here |
| 1 | Bound the shared Accounting read scope | Milestone 0 |
| 2 | Page reviewable contracts in PostgreSQL and reuse the population for the dashboard | Milestone 1's ownership and authorization interface. Build parity fixtures alongside milestone 1. |
| 3 | Bound the dashboard chart and counters | Start trend instrumentation in milestone 0. Qualify the complete dashboard after milestone 2. |
| 4 | Move duties to one authorized queue and summary read path | Can proceed alongside milestones 1–3 after the duties baseline is captured |
| 5 | Reduce notification requests and batch resource authorization | Can proceed alongside milestones 1–4 after notification instrumentation is available |
| 6 | Verify the full user journey on one candidate and compare again in production | Includes all in-scope milestones |

### 0. Measure the exact paths

1. Start from the verified serving commit. Reconcile the implementation branch with the release baseline before edits and preserve the checkout's uncommitted work.
2. In `backend/src/middleware/accountingRequestObserver.ts`, distinguish the full dashboard, workspace refresh, change check, and reviewable list using fixed labels. Add timing around scope setup, authority and audit append, provenance queries, evidence validation by family, ordinary population, ranking and totals, page hydration, workspace counters, and chart. For duties and notifications record fixed route and provider labels, counts, elapsed time, and failure codes. Correlate records by generated request ID. Export only sanitized metrics.
3. Extend `scripts/measure-accounting-browser.mjs` for the slow routes above. Check the exact API view on the register, use data or empty-state assertions, and verify a rendered fresh dashboard chart. Capture first usable content, complete HTTP time, response size, and failed or aborted requests. Record the current checkout's failing threshold result before optimizing.

**Acceptance.** Diagnostics identify whether the time is spent in the browser, shared scope, ordinary query, trend, duties list or summary, or a notification provider. The dashboard and reviewable timings can be attributed to the exact requests under test.

### 1. Make the Accounting scope bounded

**Files.** `backend/src/services/partnerSales/accounting/readScope.ts`, `batchCaseAuthority.ts`, `backend/src/services/accountingReadProjection.ts`, and the scoped callers in `accountingService.ts`.

1. Keep one current, audited actor snapshot. Inside it, map each endpoint to the source families it needs to produce membership, totals, sorting and rows. Give callers a small interface that selects the read purpose. Keep the choice of evidence queries and validation inside the scope.
2. Separate the cheap owner and provenance predicates from evidence reconstruction. Apply those predicates before counting, filtering or paging. Keep current checks for ambiguous and orphaned legacy records. Fetch and validate the evidence families needed for the result, and use narrow selects and batched joins for related records. Retain existing whole-population validation wherever it enforces an integrity guarantee. Replace it only after an equivalent check passes parity.
3. Capture plans on the representative local dataset. If exact aggregates still replay too much history, introduce an indexed per-source summary with the source revision and integrity state. Maintain it in the source transaction with the shared Prisma client. Backfill idempotently, compare against the authoritative read, and use the authoritative path when the summary is absent or does not match the source revision. Prove the affected cohort meets the budget, including any supported fallback.

**Acceptance.** Partner ownership, active revocation, audit decisions, monetary totals, and denied or ambiguous cases match the current path. The receipt shows how query counts and scanned evidence change when page size and historical volume change. Use `accountingReadProjection.integration.test.ts`, `accountingMixedListSnapshot.integration.test.ts` and `accountingSnapshotBoundary.integration.test.ts` for parity and add the specific cases they miss.

### 2. Move the default reviewable page into PostgreSQL

**Files.** `backend/src/services/accountingService.ts`, `accountingListProjection.ts`, and `accountingPopulations.ts`.

1. Start with the actual default `view=reviewable` request. Create a compact candidate relation with authorized ordinary and Partner rows, the commercial and financial fields used for membership and ranking, and exact amounts. Resolve ties using the existing comparators. Apply ordering and pagination in SQL. Preserve the total and aggregate results even on an empty page.
2. Hydrate only returned IDs inside the same snapshot. Preserve historical display-date fallbacks, approved financial state, and action availability. Keep Decimal rounding and currency conversion exactly equivalent. Retain the authoritative path for unsupported filters and precision cases, record how often it runs, then extend SQL coverage in order of measured volume and latency.
3. Reuse the same membership and summary facts for the dashboard count and its 12-row work queue. Preserve the work queue's attention ordering independently from the register's order. Share the financial rules through one implementation and test the two callers through their existing HTTP read routes.

**Acceptance.** The old and new paths match ordered IDs, exact totals, status, visible actions, and pagination on mixed ownership, ties, deep pages, empty or out-of-range pages, and representative filters. Use `accountingReviewableDates.integration.test.ts`, `accountingListProjection.integration.test.ts`, and the existing authenticated HTTP probe.

### 3. Make the full dashboard inexpensive

**Files.** `backend/src/services/accountingService.ts`, `accountingDashboardSnapshot.ts`, and the dashboard readiness check in the browser harness.

1. Replace row fetches used only for counts or totals with equivalent SQL counts or grouped aggregates. Keep the deadline definitions, bucket totals and first 20 displayed items compatible with their drilldowns.
2. Use the timings from milestone 0 to identify which trend queries or replay stages matter most. First tighten the selects and date ranges where the results are identical. If older events still dominate, use validated monthly movements and an exact opening balance. Replay only events newer than the checkpoint while accounting for backdated changes, voids and reallocations. Tie the result to source revisions and current authorization.
3. Keep the first response coherent across the workspace and chart. Check every supported range, Tehran/Persian month boundaries, late corrections, and linked register totals. Keep the existing explicit chart failure and retry behavior and exclude a failed chart from passing the fresh-dashboard benchmark.

**Acceptance.** Full-dashboard p95 below 3 s in the agreed matched browser workload, with exact chart and drilldown parity. Run the dashboard snapshot, financial trend, historical drilldown and operational drilldown suites.

### 4. Remove duplicate duties work

**Files.** `backend/src/services/crossWorkspaceDutyInbox.ts` and `frontend/src/features/hr-duties/DestinationDutyQueue.tsx`.

1. Time active list, active counters, history and per-source reads independently. Replace repeated assigned, available and triage scans with one active candidate read and a shared current authorization result per duty in the same operation. Reuse the existing request-local source projection reader. Load history counts from the actor's receipt using the same visibility policy and page history details independently.
2. Let the page display the authorized queue when ready. Keep summaries and receipt acknowledgements from blocking the first actionable row. Preserve exact counts, view and role eligibility, recent receipt behavior, and the command-side authorization on claim, response, and reassignment. Use existing Design System loading and error states for queue and summary.

**Acceptance.** Active queue and complete summary meet the browser targets, counts and visibility match for each role, and query-count assertions demonstrate one active candidate pass rather than a pass for each view. Run `npm --prefix backend run test:duty-read-performance` plus the relevant duty integration and browser cases.

### 5. Fix shared notification pressure

**Files.** `frontend/src/components/NotificationCenter.tsx`, `frontend/src/hooks/useNotificationCatchup.ts`, `backend/src/routes/notifications.ts`, `backend/src/services/notificationAuthorization.ts`, and `backend/src/services/partnerSales/notifications/inquiryDelivery.ts`.

1. Decouple badge refresh from preview reads. Refresh the unread count independently. Fetch both preview lists on open, coalesce overlapping refresh triggers for the same signed-in scope, and revalidate on reconnect. Clear old responses on scope changes.
2. Correlate slow and failed counts to the provider and its transaction or query timings. Group unread rows by policy and distinct resource, then batch evidence and current authority in the measured expensive providers. Keep per-notice recipient and immutable evidence validation. Bound batch concurrency against the measured connection budget. A failed authorization dependency must surface as an unavailable count where completeness cannot be proven.
3. Rerun with a large unread backlog, mixed resource providers, live revocation, and concurrent Accounting reads. Compare query and transaction counts, unread totals, and runtime error codes. Keep `P2028` transaction expiry and `P2024` pool timeout distinct.

**Acceptance.** A closed header does not fetch preview lists. Badge and preview visibility agree with the existing policies for active and revoked users. Zero unexpected `P2028`, `P2024`, or HTTP 5xx under the qualification workload. Use the existing notification policy and read-state tests.

### 6. Qualify and verify the candidate

1. Use the existing `sabalanerp-local` Compose project for local work and verify its identity with `npm run docker:local:ps` before Docker work. Use the authorized private qualification path for production-scale, matched comparisons. Run the browser and HTTP scenarios with the same role, filters, input sizes, and concurrency on both builds. Include administrator and normal accountant coverage and report different scopes separately.
2. Take at least 20 complete samples per priority route including cold and warm loads. Run sequential and representative concurrent workloads, retain sample counts and failure rates, and repeat cohorts close to the threshold or with noisy results. Never count an error, partial payload, skeleton, or aborted transfer as a successful load.
3. Run `npm run architecture:check` for runtime database work. For interactive changes, run `npm run design-system:check`, the relevant behavioral tests, and the acceptance commands in the [Design System catalog](../design-system/catalog.md). Use the existing [production-state qualification](../../reports/qa/accounting-448-release-qualification.md) where applicable.
4. Hand the exact commit and evidence to the protected operator using the [release handoff](../operations/developer-release-handoff.md). Keep performance acceptance and the owner's release QA decision distinct under [ADR-0144](../adr/0144-make-product-qa-and-periodic-drills-independent-of-release.md). After cutover, verify the serving build and repeat the same browser signals and bounded log checks under normal use.

The first implementation slice is milestone 0 followed by the simplest default reviewable cohort in milestones 1–2. Keep its work small enough to compare directly against the current reader. That establishes how much of the seven-second wait falls away before changing trend storage or broadening SQL coverage.
