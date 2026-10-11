# Ordinary Contract reactivation — local validation

Decision: [ADR-0120](../adr/0120-reactivate-cancelled-ordinary-contracts-with-fresh-approvals.md), confirmed by the owner on 2026-10-11. Scope is ordinary Sales Contracts; Partner Sales and production deployment are excluded.

The implementation adds a reason dialog to the Contract detail and final wizard step, returns the same Contract to Note with a new commercial revision, preserves historical approvals and cancellation evidence, and opens its full editor. Financial history requires a fresh Accounting correction opportunity after the latest cancellation. Expired cancelled Contracts offer reviewed Customer/Item prefill into an independent creation draft.

The database harness uses the existing `sabalanerp-local` backend and PostgreSQL services. Transaction scenarios roll back all test data; the concurrency scenario creates and removes its own Contract and actor in `finally`. No replacement database or additional Compose project is used.

Validated scenarios include edit versus view authority, missing reason, concurrent revision conflicts, both approval orderings, retained and missing deadlines, expired cancellation and renewal denial, historical deleted financial records, stale Accounting opportunity closure and a fresh manager decision, preserved voided documents, and reporting suspension until renewed finality. Both historical commercial-trigger realization and financial-registration realization must restore the current amount once, then reverse when the last valid record is voided.

Static acceptance: backend and frontend builds, database client ownership, Sabalan Design System adoption, foundation (25 tests) and adoption (14 tests). Replacement unit coverage checks independent row identities with retained graph links, retained catalogue identity, immutable source data, and exclusion of prior payment, signature, delivery and discount data.

Environment limitation: `npm run docker:verify` cannot publish PostgreSQL on `127.0.0.1:55432` because Windows refuses that socket. The existing project was restored with a temporary Compose override that removes only PostgreSQL host publication; its volume, service identity and internal database connection remain the same. Database tests run inside its backend container. The override is outside the repository at `C:/Users/mahan/AppData/Local/Temp/sabalanerp-reactivation-local-network.override.yml`.

Final results:

- Reactivation database scenarios: **3/3 passed** on the final backend, including historical commercial and financial-registration reporting, actual fresh approvals, repeated cancellation/reactivation, stale correction closure and concurrent requests. The latest test source was transpiled and streamed into the existing backend container; every test client disconnected and temporary committed data was removed.
- Existing correction workflow and financial realization scenarios: **6/6 passed**; correction route and replacement workflow checks also passed.
- Browser reactivation and replacement scenarios: **4/4 passed** through `node scripts/run-design-system-e2e.mjs tests/design-system-e2e/ordinary-contract-reactivation.spec.ts --workers=1 --retries=0` against the existing project. The earlier cancellation and ordinary lifecycle browser regression run passed its **7 scenarios**.
- Replacement unit scenario: **1/1 passed**. Backend/frontend builds, architecture check, Design System check, foundation and adoption passed. Frontend build retains pre-existing lint warnings.

The browser coverage uses a real local login with isolated mocked Contract responses; database behavior is covered separately by the real-schema scenarios. It checks mandatory reason, retained reason after a failed request, pending Escape protection, navigation into editing, expired replacement availability, Accounting explanation and a fresh recovery draft with no prior financial/approval data. The edit navigation assertion permits the local development server's first route compilation.

Desktop/mobile light/dark screenshots were visually inspected and no horizontal overflow was detected. Evidence: [desktop light](../../reports/qa/ordinary-contract-reactivation/desktop-light.png), [desktop dark](../../reports/qa/ordinary-contract-reactivation/desktop-dark.png), [mobile light](../../reports/qa/ordinary-contract-reactivation/mobile-light.png), [mobile dark](../../reports/qa/ordinary-contract-reactivation/mobile-dark.png).

All six existing local services are healthy after restoration. This validation covers local implementation; no production deployment was performed.
