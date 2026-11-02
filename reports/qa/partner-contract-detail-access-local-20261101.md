# Partner Sales contract detail access — local 2026-11-01

Reported case: Sales contract 100347 (`3499ea1c-09f0-4bd8-9b9d-c687700e92ac`). The original correlation `f66f115d-da13-4435-bf71-76ae00e5dcd7` recorded `CASE_READ`, purpose `PARTNER`, internal ADMIN, denied `FORBIDDEN`. The HTTP adapter replaced that cause with English; the existing safe frontend error formatter therefore displayed its generic Persian fallback.

## Change

Inside the existing bounded read transaction, resolve the current persisted Partner profile. Partner identities retain purpose PARTNER and ownership checks; internal identities use MANAGEMENT, which is already the canonical internal CASE_READ capability. No role bypass, new grant, permission rewrite, schema change or migration. Central authorization, current Case identity/revision/hash verification, audit, feature restrictions and customer-output authorization remain authoritative.

The Sales detail and related cancellation-notice authority now reuse one current-persona read binding. This fixes the identical false denial discovered in the page's secondary read during browser acceptance; no SMS was sent or retried. Customer-output permission remains a separate decision.

The same adapter now returns actionable Persian for permission denial, hidden not-found, evidence conflict and temporary failure, with a safe trackingId matching its authorization audit. Foreign existence remains hidden. No frontend component or design-system token changes.

## Verification

- Backend build passed.
- 15 focused tests passed, including local contract 100347 with the actual internal admin and owning Partner; unrelated internal identity, foreign Partner, Partner identity bearing an ADMIN role, and stale integrity evidence remain denied. Test-owned rows and audits rolled back; existing business data and grants were not edited.
- 14 existing persisted Partner authorization integration tests passed against sabalanerp-local.
- Sales operational error tests passed: 22 error/pending tests, 21 placement tests and five Partner error tests. New permission text survives the safe formatter with its server tracking reference and permission semantics.
- Architecture, design-system adoption and diff checks passed.
- Initial direct frontend test invocation lacked the frontend path aliases; the canonical `npm --prefix frontend run test:sales-operational-errors` command passed without source/configuration changes to hide the invocation error.

Runtime/browser verification follows below. Work is local only; no push or production changes. Existing unrelated working-tree changes, duplicate frontend container and unrelated unhealthy inquiry/antivirus services were left outside this fix.

## Browser acceptance, first runtime refresh

In the actual Arc session, `/api/auth/me` confirmed username admin, role ADMIN. The reported contract endpoint returned HTTP 200, success true, contractNumber 100347 and a verified partnerCaseView. The rendered page h1 was `شماره قرارداد ۱۰۰۳۴۷`. The secondary cancellation-notice GET still exposed the same wrong-purpose denial, leading to the shared read-binding correction above. Final runtime acceptance is recorded below after the second backend image refresh.

## Final runtime acceptance

The final backend image built successfully and only the backend service was recreated with `docker compose -f docker-compose.local.yml up -d --no-deps --wait backend`. It passed health readiness. No pending migrations existed. No frontend image, existing unrelated container, production service or Git remote was changed.

A fresh real login through the local frontend proxy confirmed username `admin`, role `ADMIN`. Authenticated GET `/api/sales/contracts/3499ea1c-09f0-4bd8-9b9d-c687700e92ac` returned HTTP 200, success true, contractNumber 100347, and verified partnerCaseView. Authenticated GET of the same contract's `cancellation-notice` returned HTTP 200, success true. No cancellation, SMS retry, contract save or financial operation was submitted. The dedicated API QA session was logged out in finally. The existing browser session and business records were preserved.

Final authenticated correlation: `local-admin-100347-final-20261101`. The prior browser opening had already verified the rendered heading `شماره قرارداد ۱۰۰۳۴۷`; the final shared read binding was then rechecked through both authenticated live HTTP paths and the 15 focused tests.
