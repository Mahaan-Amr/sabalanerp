# Customer transfer management acceptance — 2026-10-03

Scope: ADR-0112; local source and the existing `sabalanerp-local` runtime. No production deployment or remote Git delivery.

## Workflow

Sales → مدیریت همکاران → درخواست‌های انتقال مشتری. Pending is the initial filter; approved, rejected and cancelled requests remain searchable. Seller configuration is in seller detail; inactive accounts are retained in history.

ADMIN can decide transfers. Delegates need the explicit CRM feature `بررسی و تصمیم انتقال مشتری به همکار`, with edit authority, in HR central access. Generic workspace access and the Manager role do not imply this authority. The customer detail card also exposes a reasoned direct transfer to authorized internal users.

A pending request does not change ownership. Approval updates current ownership while preserving historical contracts, project responsibility and prior sales credit. Unfinished Partner Cases block approval and direct transfer; rejection remains available. The requesting seller can track outcomes from the customer workspace, and notifications link to a resource-authorized status page.

## Evidence

- Shared Partner contract suite: 85 tests passed.
- Targeted frontend management views, fixtures and HTTP port: 11 tests passed.
- Existing CRM integration, explicit access and transfer-management checks: 17 tests passed against local PostgreSQL with isolated rollback data.
- Latest transfer-management regression passed, including implicit ADMIN authority, explicit HR grant and revocation, route admission, notice visibility, idempotent direct approval, fresh direct transfer without a phone number, and unfinished-Case rejection without a leaked transfer record.
- Design-system adoption check and database-client ownership check passed. Foundation (25) and adoption (14) tests passed.
- Focused browser test passed for Sales navigation, seller detail, retained deleted-account history, blocking/rejection behavior and reason modal; overflow and accessibility checks covered light/dark at 1440px, 390px and 780px with 2x zoom. The browser test uses a mocked management query; authorization and persistence are covered separately by real database integration.
- Existing local Compose verification passed. Backend and frontend local images rebuilt for this change.

## Verification limits

The complete production frontend build is blocked by an existing TypeScript error in `frontend/src/features/contract-creation/partner/partnerTechnicalDraftAdapter.ts:396` (Map iteration under the configured compiler target), outside this transfer change. The broader workspace-route test also reports the existing HR `SUBMIT_PERFORMANCE_EVALUATION` admission mismatch. These checks are not claimed green. Production notifications and deployment have not been exercised.

At the final runtime check the existing ClamAV service reported an unhealthy daemon socket; this service was not changed by the transfer work. Backend/frontend readiness is checked independently, and the full stack is not claimed healthy at that point.

## Separate seller request page revision

The seller customer list no longer mounts request tracking. The Sales sidebar has a `مشتریان` group with `مشتریان من` and `درخواست‌های انتقال مشتری من`. The latter opens `/dashboard/sales/partner-customers/transfers`, covered by the existing customer route authorization. Each request displays customer heading, status, request reason/time, decision reason and applicable approved-transfer guidance inline; there is no `پیگیری درخواست` link.

The focused sidebar browser regression passed after explicitly expanding the collapsed sidebar. It verifies no request API call or tracking heading on the customer list, navigation to the separate page, inline information and absence of the tracking link, plus mobile overflow and accessibility in both themes. The prior management browser test also passed in this revision. Local database integration confirms the nested route admits the Partner and denies an ungranted ordinary user. Foundation (25), adoption (14), design-system and architecture checks passed. The local frontend image was rebuilt and started successfully.

The production frontend build remains blocked by the documented unrelated adapter Map iteration error. An attempted full local backend rebuild encountered an unrelated concurrent file `backend/src/services/partnerSales/fulfillment/commercialSettlement.ts:22` passing a nullable record to a non-null parameter. This UI revision needs no backend runtime change; the nested page intentionally reuses the existing customer route contract. Neither error was suppressed or altered in this change.

## Per-request disclosure revision

Each request now uses the canonical `ErpDisclosure`, initially collapsed and independently expandable. All tracking fields remain below its title. The focused browser test passed for initially hidden details, independent expansion/collapse of two requests, Enter-key toggling, inline tracking, sidebar navigation and mobile accessibility/overflow in both themes. Design-system check, foundation (25), adoption (14) and diff whitespace check passed. Local frontend rebuilt and started successfully. The full production frontend build still fails at the existing unrelated adapter Map iteration error described above.
