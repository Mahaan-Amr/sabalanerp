# Partner commercial confirmation — local acceptance, 2026-10-03

Decision: ADR-0113. This run covers the customer confirmation path and the first financial registration boundary. It does not constitute acceptance of the complete historical Partner migration, renewal and correction workflows.

## User testing

Open `http://localhost:3000/dashboard/sales/partner-cases` with the Partner account and open the prepared customer contract. Choose **ارسال پیامک تأیید**. After successful local sandbox delivery, the authenticated contract page shows **کد تأیید برای تست محلی** and **مشاهده قرارداد مشتری**. Use that code on the linked customer page. The code is held only in page memory and disappears after a reload, successful acceptance, expiry checked on reload, or a commercial revision reset. A new send replaces it. The local SMS sandbox does not require a real phone delivery.

Customer confirmation can precede inquiry acceptance. Customer rejection permits editing; the edited commercial version requires seller and customer approvals again. Finality requires both approvals and accepted valid wholesale pricing. A wholesale-only price acceptance preserves unchanged customer approval.

## Evidence

- Backend TypeScript check passed.
- Frontend production build passed.
- Architecture ownership check passed; runtime uses the shared Prisma client.
- Design System adoption check passed; 25 foundation checks and 14 adoption tests passed.
- Three targeted PostgreSQL integration tests passed against the existing `sabalanerp-local` PostgreSQL, with rollback-owned isolated fixtures:
  - Customer acceptance before inquiry completion; rejection/edit resets both approvals.
  - Local preview equals the actual SMS adapter code; hashes are persisted; public reads/resends never reveal the preview; old OTP cannot approve the edited version; a new code works.
  - Last inquiry acceptance finalizes unchanged approved customer content; no automatic financial draft; first explicit saved financial draft realizes wholesale amount exactly once; last-record removal reverses the reporting effect and retains the first-record boundary.
- Browser interaction checks passed at 1280px and 390px against the existing local frontend. These use intercepted Partner fixtures to verify display, link action, correction sheet and preview removal; they are not a real SMS-provider acceptance test.
- Existing unrelated ClamAV health was unhealthy. The Partner browser lane checks PostgreSQL, Redis, backend and frontend and passed its required preflight. No second Compose project was created.

## Required removal before any push

The user explicitly requested this temporary preview and required its removal before a later push. Remove the preview UI/state in `PartnerCaseRuntime.tsx`, the opt-in preview response in `customerOutput/prismaHooks.ts`, and `PARTNER_LOCAL_CONFIRMATION_PREVIEW` from `docker-compose.local.yml`; update or remove the temporary browser assertion. Keep the OTP security and commercial-version tests. Do not push while the local preview remains.

The current response gate additionally requires development, SMS sandbox and the explicit local flag, and never applies to public resend responses. Production was not modified and nothing was pushed.

## Retail quote regression — 2026-10-03

The reported recovery reproduced `INVALID_PAYLOAD` (400) from `resolvePrismaPartnerCaseDraft` with two valid stone rows and an owned CRM customer whose optional personal address was absent. A transaction-only address probe made the same request pass and was rolled back. The corrected resolver and customer output DTO preserve an absent customer address; they retain required customer identity and SMS recipient, complete seller commercial identity, and the separate project/delivery address rules. No project address is relabeled as a personal customer address.

New stone selections, including new-material layers, start with an empty customer material price. Existing saved prices remain unchanged. Sabalan inquiry prices never become default customer prices. Interactive quote failures display one action error instead of two competing banners.

Verification: the exact reported recovery passed the shared quote/submission resolver without changing its customer data. A rollback integration fixture covers resolution and revision evidence for an address-free CRM customer; output-schema tests retain the seller-address requirement. Frontend tests cover empty defaults across product families, manual-price preservation, and independence from inquiry prices.


## Pending inquiry replacement after product editing — 2026-10-03

The reported recovery contained two stair groups but only one active stair product. Preview ignored the unused group, while private graph compilation rejected the group-count mismatch. Compilation now counts referenced groups; deleting the last product of a group removes that unused group without removing shared active groups. Existing recoveries compile without rewriting their history.

Explicit `ادامه و استعلام محصولات` on a numbered Case saves a draft revision and submits its new inquiry in the same database transaction. Only this atomic product-edit route enables cancellation of unanswered inquiries from older Case revisions. Cancelled rows and the previous Sabalan pricing duty leave active work; historical decisions and cancellation evidence remain. Ordinary approval saves strip the original request, and ordinary independent row inquiries do not cancel pending work. New inquiry failure rolls back the Case revision and leaves old pending work intact. Cancellation events retain responder assignment evidence for notification delivery.

Verification:
- 12 production graph tests, 21 frontend draft/submission tests, and two focused inquiry recovery tests passed, including unused/shared stair groups, explicit request retention, and restoration of Case-scoped replacement IDs.
- Opening a numbered Case now publishes only its owned inquiry IDs from creation context; the wizard accepts those explicit identities regardless of naming format. A late browser refresh exposed this omission after successful submission, and the same actual Case was used to verify its repair.
- The full older `wizardRecovery` suite also has six failing assertions around delivery policy, review wording, edit-entry data and completed-draft navigation. These assertions were not changed as part of this repair; targeted inquiry restoration tests passed. No claim of full-suite acceptance is made.
- Five targeted existing-Compose PostgreSQL tests passed, including replacement, retry idempotency, failed-new-inquiry rollback, independent inquiry behavior, preserved approved history, and prior commercial/OTP/finality regressions.
- Backend TypeScript and frontend production build passed. Frontend standalone TypeScript still reports unrelated existing Accounting/biometric test typing errors; this is not claimed as a clean repository-wide check.
- Architecture and Design System checks passed; 25 foundation and 14 adoption tests passed. Two intercepted browser wizard/payment regression tests passed against the existing local frontend.
- Backend/frontend were rebuilt in `sabalanerp-local`. Computer Use confirmed the actual reported draft calculated successfully and continued to pricing with two pending products. Read-only database verification found Case revision 1's four rows and previous duty CANCELLED, and revision 2's two rows PENDING with one OPEN duty. No customer approval or financial commitment was performed.

No push or production change was made. The temporary customer OTP preview remains as previously requested.
