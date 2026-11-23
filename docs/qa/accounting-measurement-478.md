# Accounting request measurements for #476 and #478

## Request evidence

The nginx access log writes one JSON line with kind `accounting_edge_request` for Accounting app pages, the Accounting API and dispatch confirmation. The line carries a fixed route label, edge wall time, upstream time, final status, outcome, response-body bytes and the upstream commit and request ID when the upstream supplies them. The Express log writes `accounting_api_request` with the same server-generated ID on responses and full application duration in milliseconds. Successful application responses return that ID and commit as `X-Accounting-Request-Id` and `X-Accounting-Commit`. The commit is the existing runtime `APP_COMMIT`. Set it to the full source commit in both comparison runs.

The edge logs its own ID and `unattested` when there are no upstream Accounting response headers. Use this record for an edge-side 499 or gateway failure and the app record for an app-observed abort. They may lack a shared ID when the client or gateway disconnects before response headers. Upstream time preserves nginx's per-attempt format and is `-` when there was no upstream. Do not substitute it for total edge time.

Use status and outcome to group client disconnects, database contention, pool timeouts, transaction expiry, and internal failures. A business conflict such as an unregistered workstation is a rejected 409. Database contention requires a recognized database error code. A reported dashboard trend failure can be recorded even when a fallback workspace is served with HTTP 200. Treat 502 upstream unavailability, 503 maintenance or draining, and 504 upstream timeout as separate from application errors. Attribute a startup-related failure to startup only when the timestamp and target instance match its `backend_startup` records or authoritative restart and readiness history.

These measurement records exclude identifiers from paths, input parameters, submitted correlation headers, referrers, account details, document contents and credential material. They are access and performance measurements and do not replace security audit logs. Nginx's separate native error diagnostics and legacy logs outside these measured paths retain their existing policies and must not be exported as measurement evidence without review.

## Browser comparison

Run on the authorized existing local test environment or approved private, loopback-only rehearsal. Use the same clean fixture and accountant authority for baseline and candidate, and record provenance privately. Run once with one browser session at a time and once with the same representative parallelism for each version. The runner opens fresh authenticated Chrome contexts, measures from navigation to the first usable action in each surface, and counts the loopback application requests started in that interval. The byte total covers completed response bodies only, and `completedRequests` makes interrupted and unfinished requests visible. The dashboard endpoint is the complete dashboard and the register route is the actual reviewable UI.

Set these environment variables before running `node scripts/measure-accounting-browser.mjs`.

| Variable | Value |
| --- | --- |
| `ACCOUNTING_TIMING_RUN` | `baseline` or `candidate` |
| `ACCOUNTING_TIMING_ORIGIN` | App's loopback origin, default `http://127.0.0.1:3000` |
| `ACCOUNTING_TIMING_COMMIT` | The full installed source commit. Candidate successful responses must attest the same commit. |
| `ACCOUNTING_TIMING_WORKLOAD` | Nonpersonal fixture name shared by matching runs |
| `ACCOUNTING_TIMING_IDENTIFIER`, `ACCOUNTING_TIMING_PASSWORD` | Private authorized accountant credentials |
| `ACCOUNTING_TIMING_SAMPLES`, `ACCOUNTING_TIMING_CONCURRENCY` | Samples **per surface** and parallel Chrome-context ceiling, default 20 and 1 |
| `ACCOUNTING_TIMING_OUTPUT` | A new path in the private evidence directory |
| `ACCOUNTING_TIMING_SEPIDAR_FIXTURE` | Optional private JSON with one `{ "row", "reference", "amount" }` object per sample. Omit for read-only. |

The optional fixture enables real Sepidar reference registration through the Accounting dispatch interface. Use only approved disposable loadings, one distinct visible driver row and unused digit-only reference per sample, and the row's exact digit-only Rial amount. Restore the equivalent isolated fixture before each version; browser execution does not undo accepted writes. Keep the command fixture and credentials outside the repository. The receipt contains neither. The browser reports submit-to-visible and response-to-visible using its monotonic clock. The candidate also reports backend transaction acknowledgement to browser-visible confirmation using co-clocked wall time. Confirm clock alignment for the backend and runner before comparing this interval. The pre-instrumentation baseline may lack that header, in which case only the two common browser timings are comparable.

The receipt reports sample and failure counts, nearest-rank p95, request counts, response bytes, error classes and normalized request counts per sample. Parallelism is the number of independent browser contexts attempted concurrently, not verified overlapping SQL operations. Use the server records for overlap and retain environment, load and time-window provenance with the receipt. Candidate measurements on local data do not fill the production-shape p95 and 30-second-expiry gates in #443 and #448. Apply the existing protected qualification workflow for those gates.

## Evidence at implementation

The HTTP observer regression exercised sanitized request records, public correlation and commit headers, and one record each for 503 unavailability, 409 rejection, database contention, 500 internal error and client abort. The Accounting contracts route regression preserved the Partner integrity conflict and the Persian technical-error tracking response. The architecture check passed. The browser runner passed JavaScript syntax validation and rejected missing arguments. The local backend and frontend were unavailable for an authenticated browser comparison. A native Nginx configuration and live edge test, matched browser baseline and candidate measurements, and production-scale acceptance evidence remain outstanding.
