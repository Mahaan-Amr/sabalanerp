# Purchasing workspace — local implementation evidence

Issue: [#425](https://github.com/Mahaan-Amr/sabalanerp/issues/425)
Branch: `codex/purchasing-workspace`
Accepted prototype: `codex/purchasing-prototype-accepted` / `7768a87a`
Runtime: existing `sabalanerp-local`; no production connection or deployment.

## Implemented operational slice

- Database-backed Requests, Orders, partial Receipts, quality acceptance/rejection, physical Returns and independent replacement Receipts.
- Canonical ordinary/Partner demand and financial-source gates; explicit quantity conversion and multi-need allocations.
- Supplier identity reuse, historical factual dates/exceptions, duplicate-proof previous-source links, advance requests and change outcomes.
- Manager/Admin Purchasing authority, warehouse quality authority, scoped seller reads and server-side commercial redaction.
- Version conflicts, command replay/outcome recovery, immutable actor-aware event history and in-app-only scoped notifications.
- Real workspace routes, shared HR presentation, canonical ERP controls/metric cards, compact centered dialogs, Persian actionable errors and accounting-style purchase-order print output.

## Verification

The transaction integration suite uses the existing local PostgreSQL database and rolls back every fixture, operational document, notification and outbox effect. It covers exact 30-decimal quantities; financial gating; idempotent retries and conflicting keys; cross-request and same-command overbuy protection; the 40 received / 15 accepted / 25 pending scenario; rejection, actual return, replacement and independent quality acceptance; return after acceptance; contact scope; version errors; partial supplier closure without erasing customer shortage; and price/history redaction.

The browser test uses an ephemeral authoritative local session and actual HTTP reads and invalid-form validation. It writes no business documents and cleans its identity/session fixtures. Service-level lifecycle testing is separate from this browser check; this report does not claim a fully committed browser end-to-end purchasing acceptance.

Browser artifacts are under `test-results/purchasing-*.png`, including desktop, 390px and 200% zoom. These are generated evidence, not replacement reference baselines.

Verified results so far:

- `npm run build:backend` and `npm run build:frontend`: passed. Final label-only UI adjustments are included in the final build check below.
- `npm run design-system:check`: passed with no new adoption violations; no baseline regeneration.
- `npm run architecture:check`: passed; runtime Prisma ownership unchanged.
- `npm run test:design-system-foundation`: 25 passed.
- `npm run test:design-system-adoption`: 14 passed.
- Local transaction suite: **35 checks passed**, all fixtures/effects rolled back. This includes a unit conversion with a nonzero deficit smaller than the displayed scale; fulfillment rounds conservatively and cannot become falsely complete.
- `npm run test:design-system:e2e -- purchasing-workspace.spec.ts hr-dashboard-visual.spec.ts --retries=0`: **4 passed** (1.4 minutes).
- Additional light/dark Purchasing screenshots and assertions passed. A separate run's browser teardown stalled during concurrent container compilation; it was stopped and is not represented as a clean suite exit.
- Full reference-surface run: Sales landing, draft recovery and Guard theme/mobile scenarios passed. The next Product Selection restoration scenario stalled and the broader run was stopped. Full reference-suite acceptance remains **incomplete**, not green.
- Shared accounting-style purchase output was generated with a synthetic QA-only document, rendered from PDF to PNG and visually inspected for Persian layout, table boundaries and direct destination text. Artifact: `tmp/pdfs/purchasing/purchase-order-qa.pdf`; this is not a business Order.
- `docker:verify` was stopped after discovering that it rebuilds all services, including the unrelated dirty inquiry source. No inquiry service recreation occurred; runtime checks use the existing project and service-scoped builds. No second Compose project or database was created.
- Generated HR comparison screenshots were restored; unrelated `apps/sabalan-inquiry` work was preserved.

Final local verification:

- Latest backend source built successfully on the host and in the service-specific Docker image; latest frontend source passed its production build and was included in the refreshed frontend image.
- Both application services, PostgreSQL, Redis, ClamAV and the unchanged inquiry runtime were healthy in the final Compose inspection.
- Latest Purchasing browser assertions passed in 19.4 seconds, including both themes, compact centering, Persian validation, mobile width, 200% zoom, accessibility and all section routes. The worker then stalled during browser teardown despite completed fixture cleanup; it was stopped. This latest run is **not** claimed as a clean process exit. The earlier combined Purchasing/HR run exited successfully with four tests passed.
- A database check confirmed **zero** remaining `qa-purchase-*` users after cleanup.
- Final `architecture:check`, `design-system:check` and `git diff --check` passed.
- Broad reference acceptance and browser-runner teardown remain open verification items before production promotion.
- No source push, production deployment, ledger posting, inventory revaluation, or real Purchasing business document was created by QA. The implementation remains a local working-tree delivery on the named branch; prototype originals remain separately archived and should not be staged into the production implementation.

## Material remaining work before production

This is the first real operational implementation, not full closure of #425. Accepted operational quantities do not yet create or consume authoritative valued warehouse stock. Full inventory reservation/reallocation/consumption and surplus transfers must be integrated with their owning modules. Accounting invoice/three-way matching/payment execution remains owned by Accounting; the current slice supports requests and existing-source links, not a completed new financial handoff. Secure image/file attachments, fully applied post-commit source-change resolution and broader Partner/historical-source/concurrency/scale acceptance also remain open. Large lists are explicitly bounded at 500 matching documents and summary cards describe the displayed list rather than claiming global totals.

Five pre-existing pending migrations were inspected and applied locally through the normal migration deploy before the additive Purchasing migration. No migration was marked resolved, bypassed, or applied to production.
