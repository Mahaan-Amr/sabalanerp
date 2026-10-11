# Independent managerial dispatch approval — 2026-10-11

Implementation base: `24426ebf2d8bcb2ed8ab604ee3f94175a6af9b8b`.

## Verified behavior

- Every managerial request remains pending with no payment promise date, including requests submitted by an Admin.
- Only a different, active Manager/Admin with Accounting contract review access may approve or decline.
- Approval requires the decision maker to select today or a future date; rejection requires a reason.
- Eligible reviewers receive a contract link and shared duty. Concurrent decisions yield one committed result.
- The requester receives the result; the contract displays the decision maker, decision time and approved date or rejection reason.
- A view-only Accounting Manager receives the payment reminder with an Accounting contract link, once per due date.

## Validation

- Backend and frontend builds and TypeScript checks passed. Frontend build reports existing unrelated lint warnings.
- Database client ownership check passed.
- Design system check, foundation tests (25), adoption tests (14) passed.
- Browser suite: 7 passed, including 1280px/390px and light/dark managerial request/decision paths, required fields and failed-save retry.
- Final local database/HTTP suite: 19 passed across dispatch credit, generic duty module/inbox, sales contract correction, notification concurrency and managerial approval HTTP.
- Additional affected policy, authorization and destination unit tests passed.
- Independent Standards and Spec reviews have no remaining findings after the reminder link and variable naming fixes.

All runtime, migration and integration validation used the existing `sabalanerp-local` Compose project. The migration was applied locally. No production deployment or push was performed.

## Broader-suite limitation

The standalone existing `hrDutyEngine.integration.test.ts` reaches its final replay-revalidation assertion and fails: it expects `DUTY_REPLAY_REVALIDATION_FAILED` after revoking a grant, but the call resolves. This test is not included in the successful 19-test count. The HR replay authorization implementation was not modified; the HR lifecycle changes here only handle nullable duty deadlines. No test assertion or authorization policy was weakened to hide this failure.

The initial broader run also exposed omitted dispatch envelope synchronization. Both dispatch definitions now participate in the existing generic synchronization function; the shared upsert helper is reused by duty creation. The envelope-count assertion then passed.
