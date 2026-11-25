# Accounting production performance after the November 24 update

**The update materially reduced wait times on the Accounting dashboard and several data-heavy registers. The dashboard and reviewable list still took about 7 seconds, duties remained slow and variable, and the production transaction-expiry symptom persisted on shared notification traffic.**

The dashboard's median observed time fell from **16.15 s to 7.29 s (55% lower)**. Reviewable contracts fell from **15.25 s to 7.33 s (52% lower)** with 50 rows visible every time. Invoices, corrections, receivables, payments, audit and tax were **52–68% lower** in the matched spot checks. The dashboard and contracts samples both exceeded the three-second target after release, and the limited sample does not establish a production p95.

## What ran

- Baseline backend commit `3b748867a1740f49967563960575a827833fed85`. After backend commit `697e8946e61cc2811072c5ffdb7f1f769d6e05ef`, confirmed on the serving production backend. Every after browser sample showed `erp_20261124t131229z-697e8946e61c-release`.
- The after sweep ran from 17:31 to 17:35 Tehran time on November 24, after the protected controller reopened public traffic. Both sweeps used the signed-in Chrome administrator profile, the normal browser cache and sequential read-only navigation. Page timings include browser observation overhead and measure visible results. Registers required rows or an explicit empty state. Other pages used their corresponding content marker. Optional secondary panels can load afterward.
- The baseline includes the user's original HAR, browser samples and backend log counts. The after sweep used browser observations and the deployed request observer. The server timings below measure application work through response finish, while the HAR measured browser network time. [Baseline report](accounting-production-baseline-20261124.md)

## Browser comparison

All measurements are seconds. Accounting paths are relative to `/dashboard/accounting` unless shown in full. The counts for repeated samples are visible in the table. Percentages in the summary compare medians for repeated samples or the one completed observation for single-sample routes. The before report retains probes that ended before readiness was confirmed.

| Scenario | Before | After | Result |
| --- | ---: | ---: | --- |
| Dashboard data | 16.37, 15.93 | 7.18, 7.40 | 55% lower median |
| `/contracts?view=reviewable` | 17.12, 13.39 | 8.00, 6.66 | 52% lower median. 50 rows throughout. |
| Switch reviewable list to Partner type | 8.55 | 5.37 | 37% lower |
| Ordinary contract detail, two linked examples | 4.93, 2.06 | 2.82, 2.75 | Mixed across the two dossiers |
| Partner case detail | 3.27 | 2.75 | Accounting dossier visible |
| Financial evidence review detail | — | — | No existing review link on either sampled ordinary dossier on either build |
| `/workflows/review` | 1.40 | 1.24 | Workflow links visible |
| `/workflows/money` | 1.01 | 1.10 | Workflow links visible |
| `/workflows/records` | 0.98 | 1.65 | Workflow links visible |
| `/workflows/reports` | 1.57 | 1.78 | Workflow links visible |
| `/dispatch` | 1.63 | 1.85 | First visible page changed from 71 rows to 50 after pagination |
| `/dispatch-documents` | 0.92, 0.78 | 2.19, 1.51 | Queue took longer in both after observations. The repeat showed the normal queue. |
| `/invoice-candidates` | 9.87 | 3.69 | 63% lower. 50 rows. |
| Invoice candidate detail | 2.60 | 2.73 | Financial record review visible |
| `/correction-requests` | 12.83 | 4.37 | 66% lower. 50 rows. |
| `/receivables?view=open` | 10.49 | 4.40 | 58% lower. 10 rows. |
| `/payments?view=due-soon` | 13.69 | 4.41 | 68% lower. Explicit empty state on both builds. |
| `/customer-accounts` | 1.57 | 2.99 | Slower in the spot check. 25 rows. |
| Customer account detail | 1.92 | 2.37 | Detail content and rows |
| `/treasury` | 2.89 | 1.86 | Workspace content visible |
| `/ledger` | 1.87 | 2.36 | Ledger content and row |
| `/ledger/customer-rules` | 1.26 | 1.91 | Accounting rules content |
| `/supply-chain` | 2.23 | 1.99 | Workspace content visible |
| `/period-end?tab=assets` | 2.20 | 2.66 | Workspace content visible |
| `/period-end?tab=payroll` | 2.52 | 2.28 | Workspace content visible |
| `/period-end?tab=reports` | 2.50 | 2.32 | Workspace content visible |
| `/period-end?tab=close` | 1.89 | 2.66 | Workspace content visible |
| `/tax?view=needs-attention` | 9.40 | 4.47 | 52% lower. 50 rows. |
| `/tax-center` | 1.53 | 1.32 | Workspace content visible |
| `/audit` | 10.14 | 4.20 | 59% lower. 50 rows. |
| `/performance?view=last30days` | 0.93 | 1.14 | Workspace content visible |
| `/settings` | 0.89 | 1.34 | Workspace content visible |
| `/settings/biometric-connector` | 1.27 | 1.71 | The diagnostics error and retry appeared on both builds |
| `/duties` | 20.22 | 22.46, 11.73 | Slow and variable. One after sample exceeded the before sample. |
| Duty detail | 1.30 | 1.68 | Linked duty opened |
| `/replacement` | 1.93 | 2.78 | Workspace content visible. Replacement verification itself was outside this page-load sweep. |
| `/dashboard/hr/hiring?view=collateral-contracts` | 1.24 | 2.35 | Linked hiring workspace content |
| `/dashboard/hr/hiring/collateral-templates?view=active` | 1.24 | 1.01 | Linked collateral-template workspace content |

## Transaction timeouts and backend timings

The read-only after log review covered **17:30:00–17:35:30 Tehran time**. It identified **four `P2028` log lines**, in four different seconds. Each of those seconds had one HTTP 5xx on `GET /api/notifications/unread-count`. The legacy notification logs have no common request ID for direct linkage. The unread-count endpoint logged **4 failures out of 88 requests**. No `P2024` lines appeared. The corresponding before window lasted 27.5 minutes and had **11 `P2028` lines** and **10 unread-count HTTP 5xx**. The different window lengths and traffic volumes prevent treating the raw counts as proof of a reduced timeout rate.

| Production backend read | Before traffic / HTTP 5xx | After traffic / HTTP 5xx |
| --- | ---: | ---: |
| Accounting dashboard | 6 / 0 | 5 / 0 |
| Accounting contracts | 9 / 0 | 3 / 0 |
| Accounting contracts with `view=reviewable` (subset) | 6 / 0 | 3 / 0 |
| Duties | 159 / 0 | 52 / 0 |
| Notifications | 669 / 10 | 278 / 4 |

The new Accounting request observer recorded **55 GETs, zero HTTP 5xx, zero `P2028` and zero `P2024`** in the after window. Its dashboard route label combines the main dashboard and change or workspace reads. Times below are the after server samples, in milliseconds. The median here is nearest-rank.

| Observer route group | Samples | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Dashboard group | 6 | 1,157 | 6,041 | 7,248 |
| Contracts, all three serving-log GETs used `view=reviewable` | 3 | 3,464 | 4,875 | 6,526 |
| Receivables | 1 | 2,817 | 2,817 | 2,817 |
| Payments | 1 | 2,854 | 2,854 | 2,854 |
| Dispatch candidates | 3 | 410 | 632 | 903 |

In the measured dashboard and contract stages, the reported median lock waits were about 13 ms and 8 ms. Median population reads were about 2.86 s and 2.36 s, and median authorization was about 1.12 s and 1.01 s. Those stage samples support where to investigate the remaining backend time. Stages can overlap and their medians should not be added.

The immediate production result is a clear improvement in time to usable Accounting data. The live checks still show delays on the priority pages, and the shared notification expiry continues to appear during Accounting use. The browser sweep did not exercise write transactions or deliberately generate concurrent production load.
