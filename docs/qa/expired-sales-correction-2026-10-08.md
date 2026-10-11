# Expired Sales correction verification — 2026-10-08

Scope: local implementation of ADR-0119. No production mutation, migration, deployment, or Git push was performed. Existing unrelated QA artifacts remain local and untouched by this change.

## Verified

- `npm --prefix backend run test:sales-contract-correction-duty`: seven database tests plus route checks passed. Legacy and current ordinary flows cover immediate removal from active Sales work, repeatable expiry with one Accounting successor, authorized history/search, manager-only renewal, rejection returning to Accounting, three Tehran working days, mandatory closure reason, incomplete financial-work blocking, and unchanged Contract contents. Existing save/request concurrency tests passed. The new fixtures roll back in the existing local database.
- Targeted `partnerCaseDraft.integration.test.ts` test `one Accounting permission permits repeated Partner edits, resets both approvals, expires and can be renewed`: passed against the existing local database. Expiry enters Accounting review and renewal traverses the manager decision in the same chain with a distinct Sales duty.
- `npm --prefix backend run test:sales-operational-errors`: eight passed, including an expected expiry response instead of HTTP 500.
- `crossWorkspaceDutyInbox.integration.test.ts`: two passed, including per-User history acknowledgement.
- `contractEditMutationFailure.test.tsx` and the targeted `wizardRecovery.test.tsx` test `correction deadline`: passed. The new business rejection does not offer edit-lease takeover; the expired Partner editor retains mounted form content with saving disabled.
- `npm run test:design-system:e2e -- expired-sales-correction.spec.ts expired-correction-editor.spec.ts --retries=0`: three passed. Real local shell/login with mocked duty/contract APIs verifies desktop and 390px mobile history search, reason-required Accounting close, financial rejection preserving the reason, successful completion, and an open ordinary editor crossing its deadline while retaining unsaved local recovery. It also verifies accessibility and horizontal overflow on the changed Accounting surfaces. This browser evidence does not replace the database workflow tests.
- Partner package, backend and frontend builds passed. `design-system:check`, foundation (25), adoption (14), `architecture:check`, and `git diff --check` passed.
- `npm run docker:verify`: passed for the existing `sabalanerp-local` project, including backend/database, frontend proxy, frontend page and inquiry page health.

Browser screenshots are local under `test-results/design-system/`, namespaced by the two specs. The editor and mobile Accounting review screenshots were visually inspected.

## Existing test limitations

The complete Partner wizard suite is not claimed green: the unchanged `numbered Case integrity failures identify the Case for support while transport failures remain retryable` assertion expects `همکار-۰۰۳۱۳`, while its unchanged helper returns `۰۰۳۱۳`. The targeted new deadline test passes.

`partnerPricingDutyAdapter.test.ts` has two existing fixture failures: mocked `partnerInquiry.findFirst` and `findMany` are absent. Both calls also exist in HEAD before this change. These unrelated test fixtures were preserved; no full Partner suite pass is claimed.

An intermediate browser run overlapped local service rebuilding and received `ERR_EMPTY_RESPONSE`. After Docker verification completed, the final combined three-test browser run passed without retries.

Production reconciliation of already expired duties is not verified or executed. The updated background worker is idempotent and includes legacy ordinary corrections; deploying or executing it in production requires separate authorization.
