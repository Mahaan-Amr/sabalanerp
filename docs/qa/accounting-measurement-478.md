# Accounting request measurements for #476 and #478

## Request evidence

The nginx access log writes one JSON line with kind `accounting_edge_request` for Accounting app pages, the Accounting API and dispatch confirmation. The line carries a fixed route label, edge wall time, upstream time, final status, outcome, response-body bytes and the upstream commit and request ID when the upstream supplies them. The Express log writes `accounting_api_request` with the same server-generated ID on responses and full application duration in milliseconds. Successful application responses return that ID and commit as `X-Accounting-Request-Id` and `X-Accounting-Commit`. The commit is the existing runtime `APP_COMMIT`. Set it to the full source commit in both comparison runs.

The edge logs its own ID and `unattested` when there are no upstream Accounting response headers. Use this record for an edge-side 499 or gateway failure and the app record for an app-observed abort. They may lack a shared ID when the client or gateway disconnects before response headers. Upstream time preserves nginx's per-attempt format and is `-` when there was no upstream. Do not substitute it for total edge time.

The application observer distinguishes the full dashboard, workspace refresh, change check, and exact reviewable list. It also records Accounting duty queue and summary GETs, the Accounting route-availability GET, the Partner Accounting payment-plan candidate GET, and the shared notification GETs. These use fixed labels and omit raw URL parameters. The existing Nginx Accounting labels remain grouped.

On dashboard and contract register reads, `stagesMs` records completed stages under the same request ID. `lockWait` covers the Partner operations lock. `scopeSetup` covers creation of the fenced read scope. `authorization` covers initial Case decisions and capability checks. `authorizationAudit` separately measures the audit writes, including the preparation-list batch. `provenance` measures the source marker query and `partnerEvidence` covers the Partner invoice, child and audit validation. `ordinaryPopulation`, `partnerPopulation`, `registerRanking`, and `rowHydration` time the main parts of the list read. `workspace` and `trend` cover the dashboard's separate content reads. Stages overlap and do not sum to total duration.

Use status and outcome to group client disconnects, database contention, pool timeouts, transaction expiry, and internal failures. A business conflict such as an unregistered workstation is a rejected 409. Database contention requires a recognized database error code. A reported dashboard trend failure can be recorded even when a fallback workspace is served with HTTP 200. Treat 502 upstream unavailability, 503 maintenance or draining, and 504 upstream timeout as separate from application errors. Attribute a startup-related failure to startup only when the timestamp and target instance match its `backend_startup` records or authoritative restart and readiness history.

These measurement records exclude identifiers from paths, input parameters, submitted correlation headers, referrers, account details, document contents and credential material. They are access and performance measurements and do not replace security audit logs. Nginx's separate native error diagnostics and legacy logs outside these measured paths retain their existing policies and must not be exported as measurement evidence without review.

## Browser comparison

Invoice-candidate receipts record first invoice rows and full-page readiness separately. Full readiness requires the completed payment-plan response and every returned plan action to render. An empty response or an expected non-administrator `FORBIDDEN` response must also finish and leave no plan actions visible. The November 24 deployed baseline `697e8946e61cc2811072c5ffdb7f1f769d6e05ef` requested an unmounted plan URL, so compare first invoice readiness across that baseline and the candidate and report the candidate’s complete invoice page separately.

Run on the authorized existing local test environment or approved private, loopback-only rehearsal. Use the same clean fixture and accountant authority for baseline and candidate, and record provenance privately. Run once with one browser session at a time and once with the same representative parallelism for each version. The runner opens fresh authenticated Chrome contexts, measures from navigation to the first usable action in each surface, and counts the loopback application requests started in that interval. The byte total covers completed response bodies only, and `completedRequests` makes interrupted and unfinished requests visible. Dashboard and reviewable-list samples match the GET on the configured app origin. The register opens `/dashboard/accounting/contracts?view=reviewable` and requires exactly one `view=reviewable` parameter on the contracts API request. Earlier browser receipts from the unfiltered register cannot establish reviewable-list timing. Each matched read records its fixed API path and view. Its `fullHttpMs` measures from browser request start through the last response byte, including completed HTTP error responses. The receipt reports its own count and p95 separately from first-action timing. Interrupted transfers have no full-response duration, and the receipt retains their failure.

Set these environment variables before running `node scripts/measure-accounting-browser.mjs`.

| Variable | Value |
| --- | --- |
| `ACCOUNTING_TIMING_RUN` | `baseline` or `candidate` |
| `ACCOUNTING_TIMING_ORIGIN` | App's loopback origin, default `http://127.0.0.1:3000` |
| `ACCOUNTING_TIMING_COMMIT` | The full installed source commit. Candidate successful responses must attest the same commit. |
| `ACCOUNTING_TIMING_WORKLOAD` | Nonpersonal fixture name shared by matching runs |
| `ACCOUNTING_TIMING_IDENTIFIER`, `ACCOUNTING_TIMING_PASSWORD` | Private authorized accountant credentials |
| `ACCOUNTING_TIMING_SAMPLES`, `ACCOUNTING_TIMING_CONCURRENCY` | Samples **per surface** and parallel Chrome-context ceiling, default 20 and 1 |
| `ACCOUNTING_TIMING_PHASE` | `cold` starts after login, `warm` opens the target once before timing, and `mixed` alternates. Default `cold`. |
| `ACCOUNTING_TIMING_ACTOR_CLASS` | Declared cohort, `accountant` or `administrator`. Default `authenticated`. Record evidence of actual authority separately. |
| `ACCOUNTING_TIMING_SURFACES` | Comma-separated surface names, or `all`. Default is `dashboard,reviewable-list,dispatch`. Additional surfaces are `invoice-candidates,correction-requests,receivables,payments,tax,audit,duties,customer-accounts`. |
| `ACCOUNTING_TIMING_OUTPUT` | A new path in the private evidence directory |
| `ACCOUNTING_TIMING_SEPIDAR_FIXTURE` | Optional private JSON with one `{ "row", "reference", "amount" }` object per sample. Omit for read-only. |

The optional fixture enables real Sepidar registration through the Accounting dispatch interface. Use only approved disposable loadings, one distinct visible driver row and unused digit-only reference per sample. For a comparison between legacy Sepidar reference and loading invoice registration, use single-driver loadings with the exact digit-only Rial amount. The receipt records the workflow used. Restore the equivalent isolated fixture before each version because browser execution does not undo accepted writes. Keep the command fixture and credentials outside the repository. The receipt contains neither. The browser reports submit-to-visible and response-to-visible using its monotonic clock. The candidate also reports backend transaction acknowledgement to browser-visible confirmation using co-clocked wall time. Confirm clock alignment for the backend and runner before comparing this interval. The pre-instrumentation baseline may lack that header, in which case only the two common browser timings are comparable.

The receipt reports sample and failure counts, nearest-rank p95, request counts, response bytes, error classes and normalized request counts per sample. Parallelism is the number of independent browser contexts attempted concurrently, not verified overlapping SQL operations. Use the server records for overlap and retain environment, load and time-window provenance with the receipt. Candidate measurements on local data do not fill the production-shape p95 and 30-second-expiry gates in #443 and #448. Apply the existing protected qualification workflow for those gates.

The dashboard receipt measures the work queue and the complete page separately. Complete readiness requires the current chart, reviewable count and deadline data or the displayed empty state. The duty receipt separates queue and summary readiness. Exit status 2 marks a failed sample or a selected priority surface with p95 at or above 3,000 ms. Each sample authenticates a fresh browser context. For a warm sample the second navigation uses the same context after the first verified load. Record the actor's actual scope alongside the run and use the same authority and equivalent fixture in both runs.

## Evidence at implementation

The HTTP observer regression exercised sanitized request records, public correlation and commit headers, and one record each for 503 unavailability, 409 rejection, database contention, 500 internal error and client abort. The Accounting contracts route regression preserved the Partner integrity conflict and the Persian technical-error tracking response. The architecture check passed. The browser runner passed JavaScript syntax validation and rejected missing arguments. The local backend and frontend were unavailable for an authenticated browser comparison. A native Nginx configuration and live edge test, matched browser baseline and candidate measurements, and production-scale acceptance evidence remain outstanding.

The isolated HTTP fixture ran on the existing `sabalanerp-local` PostgreSQL service with the Accounting runtime at `f1bff4554`. It used 935 ordinary contracts and 30 committed Partner Cases. Each surface completed 20 sequential authenticated requests with no errors or transaction expiries. All 965 authorized IDs matched, both reads in the mutation race returned 200, and the request after revocation returned 401.

| Surface | HTTP p95 | Maximum | Lock p95 | Authorization p95 | Population p95 | Page hydration p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Complete dashboard | 2,167 ms | 2,271 ms | 4.68 ms | 286.50 ms | 100.20 ms | 0.05 ms |
| Reviewable contracts | 2,915 ms | 6,819 ms | 10.15 ms | 326.29 ms | 149.61 ms | 0.16 ms |

The stage columns cover the instrumented operations. The HTTP time includes the complete response and additional shared work. These numbers are local fixture evidence. #448 still requires independently verified production-state measurements.

## Three-second roadmap implementation slice

The deployed baseline `697e8946e` completed the earlier local fixture at 933 ms dashboard p95 and 932 ms reviewable p95 with a three-month chart and 12-row page. It did not reproduce the production latency.

The revised probe tested runtime commit `e7f9a2458` against an isolated schema on the existing `sabalanerp-local` PostgreSQL service. It used 935 ordinary contracts, 30 lifecycle-backed committed Partner Cases, and 20 authenticated sequential HTTP samples per surface. The probe opened a six-month chart and the 50-row reviewable page. Dashboard p95 was **881 ms** and reviewable p95 was **814 ms**. The fixture does not reproduce production invoice history or load, and the two local runs used different chart ranges and page sizes.

All 965 expected authorized IDs matched. Concurrent reads during a mutation returned 200 and a revoked actor's next read returned 401. A separate fixture with a saved Partner invoice showed one full invoice evidence read per snapshot, down from three. The preparation-list fixture kept the individual authorization decisions and reduced audit insert statements from five to two. The full Chrome receipt regressions ran against the browser test fixture. A matched real-browser run on both builds and production p95 remain outstanding.
