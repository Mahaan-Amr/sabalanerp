# Partner creation loading and pricing transition — 2026-10-08

## Requested behavior

The full product editor remains step 4. Its continuation enters price inquiry (step 5 of 8) and creates/submits the initial inquiry once. The separate retail price entry page is removed. Financial totals and below-cost acknowledgement remain on pricing; Previous returns to the full editor. Service-only contracts preserve their seven-step sequence and enter delivery without a material inquiry.

## Comparison with ordinary Sales

| Area | Ordinary Sales | Partner finding and change |
| --- | --- | --- |
| Initial data | `useDataLoading.ts` publishes individual resources through their own setters and starts independent tasks after profile authorization. | Products previously stayed hidden until PRODUCT, TOOL, FINISHING, LAYER and three SERVICE catalogs all completed. Products now publish first; secondary readiness/error/retry is separate. Profile-locking reads remain sequential. |
| Date, customer, project | Shared views; ordinary customer search initially reads a small page. | These Partner steps share the initial creation-context transaction. Removed an unused nested commercial-terms selection and gave that transaction the explicit ordinary creation budget. Partner scoped customer/project populations and authorization remain unchanged. |
| Product configuration | One editor collects product prices and operations. | Repeated retail form removed; canonical full editor remains the price-editing surface. Saving/advancing waits for operation dependencies, preventing incomplete catalog use. |
| Requests during navigation | Ordinary loader has latest-request checks per resource. | Creator-scoped concurrent catalog reads coalesce; inactive consumers stop requesting subsequent catalogs. No cross-actor or settled-response cache. |
| Pricing | Ordinary creation has no Partner responder inquiry stage. | Background quote refresh waits for an existing case and avoids competing with technical save/initial quote. Five-second price polling is limited to pricing/confirmation and never overlaps itself. This interval is separate from Prisma's five-second transaction deadline. |
| Delivery, payment, confirmation | Shared editors with their own validations. | Existing editor/validation/recovery behavior preserved. Edited products return to pricing first; delivery/payment repairs are validated when entered/accepted, without rewriting the preserved plans. Autosave continues across all wizard steps. |
| Backend transaction | `contractService.ts` creation uses `maxWait:5000`, `timeout:15000`. | Creation-context, catalog, lease and recovery read/checkpoint now explicitly use the same bounded budget. Existing technical save20s and case submit30s budgets are unchanged. Expiry is not retried. |
| Failure meaning | Operational failures should remain retryable. | Recognized creation-context database expiry/contention now returns TEMPORARY_FAILURE503 rather than a misleading integrity409. Diagnostics retain only an allowlisted database code and support reference; no raw exception text. |

Authorization locks, lease/CAS checks, audited access, graph identity, business calculations and the shared Prisma client are unchanged. The wider authorization lock scope and unbounded Partner CRM population remain potential scaling costs; no production latency measurement or SQL execution-plan analysis was performed in this task.

## Reproduction and validation

- Loader regression was RED on the original all-or-nothing publication, GREEN after products publish independently. Tests cover secondary failure, concurrent request reuse, retry after failure and inactive consumers.
- `node reports/qa/partner-loading-flow/slow-services.mjs`: injects 6 seconds of delay into each of three SERVICE requests. Before the fix, the product search was absent within the 1.5-second assertion. After the fix, search is visible while services are pending, then operation rates/edge-dependent totals and 390/800px light/dark layouts pass. This is controlled latency evidence, not a production benchmark.
- `node reports/qa/partner-loading-flow/wizard-mounted.mjs --baseline`: bundles the HEAD wizard without modifying source; fails because no initial inquiry is sent automatically.
- `node reports/qa/partner-loading-flow/wizard-mounted.mjs`: mounts the real wizard and submission controller in React.StrictMode. Success sends/prepares exactly once; uncertain response does not resend automatically and explicit checking reuses the command ID; service-only creates no pricingRequest. No duplicate retail inputs appear and Previous invokes the main editor.
- Focused frontend behavioral tests, backend transaction/error composition tests, architecture enforcement, design-system adoption/foundation checks, frontend/backend builds and local Docker health verification were run. Browser scripts use fixture command ports or scoped Partner API mocks; production is not exercised or deployed.
- Final focused frontend suite: 55 tests passed; backend focused suite: 7 passed. Three selected design-system browser paths passed (shared date/customer/project, customer return, lease expiry). The lease-expiry test initially used the previous price-field label and timed out; its locator now uses the actual unit-bearing label, and the fresh run passed in 12.6 seconds.
- Additional `test:partner-sales:inventory` reports pre-existing global route/action inventory drift. Its discovery inputs (app routes, permission catalogs and schema) are unchanged by this patch; the global inventory was not regenerated to hide it.

Existing broader comparison: `reports/analysis/2026-10-07-contract-comparison/`.
