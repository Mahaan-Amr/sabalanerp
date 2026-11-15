# Accounting shared-scope local read qualification (2026-11-15)

Issue #447 remains open against spec #443. The branch was based on integration `b6bf6353` and merged integration `0b38f817` after the #446 dashboard change. All runtime reads used the existing `sabalanerp-local` PostgreSQL service after `docker compose -f docker-compose.local.yml ps` confirmed the six existing services; no Compose service was rebuilt.

## Callers and evidence boundary

| Caller | Population needed | Current scope work |
| --- | --- | --- |
| Reviewable contracts | Every authorized ordinary and committed Partner row for exact global filters, order, total, and page | Full Case authority, financial and collection evidence, and preparation candidates before global selection. |
| Dashboard, financial trend | Complete authorized aggregates and historical movement cutoffs | Full Case authority and invoice/collection/audit validation. Trend now fetches payment rows once and reuses the published invoice set, while official outstanding evidence is still checked at each cutoff. |
| Financial, receivable, payment, tax lists | SQL-filtered exact total and selected page | Shared scope still validates the whole authorized Partner financial population before paging. Historical receivable/payment modes also need complete dated evidence. |
| Correction, audit, performance | Exact authorized owner references and complete activity population | Shared scope resolves hidden owners and validates Partner audit witnesses. |
| Customer workspace | Ordinary customer contracts, financial rows, receivables, and payments only | `ordinaryOnly` retains Partner contract and marker exclusions and skips unrelated Partner authority/evidence. |
| Internal document and internal accounting target | One requested Partner Case | `focusedCaseId` authorizes and validates only that Case; ordinary and audit/correction reads are unavailable in this mode. |
| Preparation documents | Every eligible authorized Case for a complete list | Full Case authority and preparation evidence remain intentional. |

The full invoice witness validation on dashboard and reviewable list is still necessary under the current financial contract: all authorized invoices can affect the exact population, statuses, totals, or trend. Skipping an unreturned invoice without a new set-oriented integrity proof could present a corrupt obligation as valid. Further gains require batched Case projection/plan verification or a validated relation-level selection that preserves fail-closed results.

## Changes and measured local results

- The shared scope still evaluates each Case's current READ and WRITE authority under ordered locks. Its 70 independently evaluated decisions for 35 Cases are appended in one database statement within the same repeatable-read transaction, retaining each decision's root, correlation, revision, timestamp, grant evidence, and denial.
- Scope collection validation replays the payment rows already fetched in the snapshot. Trend replays one fetched payment population across periods and reuses the published invoice set for each period's official outstanding check. Movement, currency, status, historical coverage, replacement, and void checks remain in place.
- On the existing local database, the first page returned exactly 896 reviewable rows in total (869 ordinary and 27 committed Partner). Before the final trend reuse, three complete reviewable reads took 2,858, 2,985, and 2,605 ms; complete dashboard reads took 3,447, 3,276, and 3,627 ms. After collection and published-set reuse, three complete dashboard reads took 3,669, 3,342, and 3,143 ms with `trendError=false`. These are small warm samples, not p95 or production admission.
- Profiling before the final collection change showed scope creation about 2.0–2.3 s, dashboard revisions 18–24 ms, workspace queues including the reviewable list about 814 ms, and trend another 0.5–0.6 s. Earlier scope stages were 1,119 ms for per-Case authorization and 1,416 ms for invoice context/financial witness validation. Batched audit writes reduced three warm empty-scope reads from about 2.63 s before the change to 2,219, 1,970, and 2,066 ms after it.

## Checks and remaining gate

- The 35-Case real-schema integration regression failed before the focused document/customer changes and passed afterward for ADMIN and USER. It verifies per-Case audit decisions, a document restricted to its requested Case, and no Partner authorization work in an ordinary customer statement.
- Authenticated historical Accounting integration (financial, receivable, payment, tax, audit, reviewable list, dashboard) passed both historical-plan variants. The dashboard integration passed complete workspace/trend parity and change checks. Historical witness and trend tests passed 34/34. Backend TypeScript, `npm run architecture:check`, and `npm run design-system:check` passed.
- No production-state qualification or concurrent mutation/revocation run was performed here. The complete local dashboard still exceeded three seconds in all final samples. The production p95 under three seconds, zero 30-second expiry, and complete shared-scope surface qualification remain unresolved release gates for #447/#448.
