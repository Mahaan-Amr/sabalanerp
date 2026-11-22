# Personal passenger-car pickup — local acceptance, 2026-11-18

The confirmed policy is ADR-0142. Only contracts referenced by positive saved allocation rows are extracted; other contracts of the customer/project are excluded. Ordinary and Partner source branches freeze the personal pickup context on the finalized allocation. No production rollout is part of this work.

## Implemented behavior

- Logistics driver selection offers only the additional «راننده شخصی» button; the existing ordinary-driver list stays visible. Selecting an ordinary driver leaves personal mode, and clicking the selected personal button deselects it. The separate «رانندگان دیگر» button and the extra Guard exit guidance paragraph were removed at the owner's request. Personal pickup needs no manually entered driver identity, mobile, plate, registry enrollment or Guard entry. A loading-owned transport slot preserves existing allocation, pricing, document and exit relationships without inventing a physical admission event.
- One active personal slot represents one exit occurrence. Personal pickup cannot be combined with other carriers. Draft mode switching releases existing drivers, clears allocation drafts and saved quantity inputs, and requires quantity entry again. Discarded personal drafts retain their selection history as cancelled records.
- Accounting financial-record creation/approval, waybill acceptance and whole-loading sales invoice issuance remain separate. «صدور مجوز خروج» grants authority only after existing eligibility and invoice checks, without biometric connector or OTP use. Internal/external/متفرقه rules are retained.
- Guard authorized exits display frozen customer, selected contract numbers and Partner names when applicable. Physical exit consumes the existing expiring/revocable authorization and records quantity evidence once. Personal selections are excluded from Guard entry queues; their history identifies Logistics as owner.
- Buyer exit notification remains independent of OTP. Physical evidence contains no invented plate; the existing SMS template receives «سواری شخصی» as its vehicle descriptor. Printed sales invoices use «—» for the intentionally absent plate; ordinary plate validation remains required.

## Validation

- `npm --prefix backend run test:personal-loading-pickup`: real PostgreSQL service and schema, two scenarios (personal pickup and existing متفرقه OTP regression). The harness checks the existing `sabalanerp-local` service, clones schema plus independent product/department reference data into a uniquely named temporary database in that same service, applies migrations, runs rolled-back fixtures, disconnects clients and drops that exact test database. No second stack/container is created.
- Personal scenario covers draft retry/switch/reset, no Guard admission event, Logistics history ownership, selected-versus-unselected contract scope, immutable finalization, pre-exit cancellation after a previous personal selection, invoice prerequisite, lost financial eligibility at both authorization and physical exit, no new financial record, no driver OTP/biometric attempt, repeat authorization, one physical exit, buyer notification with a stub gateway, and draft discard/history retention.
- `npm run architecture:check` and `npm run design-system:check` pass without baseline/allowlist changes.
- Design System foundation: 25 passing tests; adoption: 14 passing tests.
- Focused existing projection/enrollment/draft workflow tests pass; timeline and Persian event-label tests pass, including personal history wording.
- Backend and frontend production builds pass; frontend retains existing unrelated React hook warnings.
- Browser acceptance: `playwright test --config=playwright.design-system.config.ts personal-loading-pickup.spec.ts --retries=0`: 2 passed. API-mocked identity, workspace permissions and feature scenarios: personal selection/switch without manual identity and Guard selected customer/Partner/contract display plus exit confirmation. Both were checked at 390px without horizontal overflow; screenshots were visually inspected.

## Runtime and limits

The existing local backend initially restarted with exit 75. It became healthy during concurrent local recovery work and is exposed on loopback port 5001. This task did not restart or replace the backend, alter its ownership evidence, change its port, or run production commands. This task rebuilt/refreshed only the frontend service in the same `sabalanerp-local` project; other services and volumes were preserved.

The canonical browser launcher still hardcodes host port 5000, which is not the active backend endpoint on this Mac. Browser tests were therefore invoked directly after checking the existing Compose project and successful readiness on 5001 plus frontend availability on 3000. No health condition was bypassed and no substitute runtime was started.

During the final UI refinement another local task temporarily switched the existing backend to its own QA database. Final browser fixtures therefore mock identity and permissions as well as feature API responses, avoiding any change to that task's database or credentials. The PostgreSQL integration tests remain separate real-service checks.

No real SMS was sent. Database integration uses actual services with a stub PDF renderer/SMS gateway; browser feature API responses are mocked. A separate complete live Partner loading screen does not exist in the repository; the Partner canonical backend branch supports the new source and frozen display context, but a full Partner-case end-to-end run is not asserted here.

Existing unrelated and concurrent working-tree edits were preserved, including changes sharing dispatch allocation and invoice-source files. No commit, push or production deployment was performed by this task.

## Real HTTP acceptance follow-up

Both ordinary and Partner sales passed from Logistics transport selection through Accounting authorization and Guard exit. The test mounted the actual HTTP routers on loopback, used separate authenticated Logistics, Accounting and Guard users, and used disposable databases in the existing `sabalanerp-local` PostgreSQL service. Accounting generated the dispatch documents and sales invoice using Chromium. The Partner scenario also approved the financial record and created the receivable through their respective HTTP actions before loading finalization.

| Scenario | Test loading | Recorded exit | Quantity |
| --- | --- | --- | --- |
| Ordinary contract | `cmwlvc94e000g26vwyghico6y` | `6ff01f3e-2928-4622-9ec0-426db356b407` | 1 |
| Partner contract | `cmwlvc9sp000t67aug3qli2s7` | `ab1b31cc-5302-4d8a-8b9f-162de3c9dc56` | 0.25 |

Both runs checked that approval before the separate sales invoice is refused, valid approval creates no extra financial record, no driver OTP or biometric attempt exists, and a repeated Guard submission returns the original exit. Both showed only the loaded contract in Accounting and Guard. The Partner run checked both party names and the original Partner quantity lineage. The exit SMS intent reached `PENDING` for each case. Temporary records were removed with their test databases.

The Partner HTTP run exposed a missing required reason on the audited Logistics selection. The selection now supplies a reason automatically for selecting and leaving personal mode. The Partner browser wizard remains unavailable. The browser test covers Logistics and Guard interactions with fixture API responses, independently of the real HTTP checks.

## Unified loading browser acceptance

Chromium passed the Partner workflow through the running local frontend and the real application routers backed by an isolated database in the existing local PostgreSQL service. The Logistics, Accounting, and Guard steps used separate authenticated users. The flow started at «بارگیری جدید», checked that the Partner seller name did not return the final customer, and matched the final customer by name. After choosing the second delivery, it reserved an existing متفرقه turn, saved a quantity, switched to «راننده شخصی», verified that the old selection and quantity cleared, and reloaded the saved personal draft.

Accounting issued the required documents and invoice independently from exit authorization. The browser then completed the Guard exit. The selected contract and both party names were visible in Accounting and Guard. After exit, only the first delivery still had a loadable balance. The test verified a consumed authorization, one physical exit for 0.75, no additional financial record, no OTP or biometric attempt, and an exit SMS intent in PENDING. The temporary records were cleaned up.

Browser evidence: loading `cmwlwzv140022womh525fqwtt`, exit `9df9bf57-27c0-47b9-8a7c-d3a8e63138d4`. The shared recovery-pinned backend was left running, and the browser forwarded requests to the current application source in the acceptance process.
