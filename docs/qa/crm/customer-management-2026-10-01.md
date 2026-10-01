# CRM Customer management verification — 2026-10-01

Scope: ADR-0108 and ADR-0109, shared Partner customer creation routing, own-duplicate selection, and masked transfer recovery. Source changes and the existing `sabalanerp-local` runtime only. No production release, production data rewrite, customer merge or remote push was performed. The explicitly authorized operational card of محمد دهقانیان was permanently removed in local only, with all historical identity and commercial records retained.

## Result

- Creation uses authenticated Partner creation context, with no ordinary fallback on an unavailable context. The ordinary backend route rechecks persona under the User lock, including stale open forms.
- Admin sees ordinary and Partner Customer identities in the same searchable directory. Current Company Manager authority plus the active direct `crm_customers_view_all` grant enables management visibility. Workspace administration or a manager title alone does not confer this new permission.
- Management responses strip operational history, private metadata, and contact communication history. The Admin can edit the Partner customer card and toggle blacklist/lock without changing ownership. Manager view-all remains read-only. Private Partner pricing/collections remain excluded.
- An already-owned Partner Customer is returned for explicit selection without another customer or project being created. A foreign/legacy match remains masked and requires approved transfer; identical names alone never justify a merge.
- Individual permanent deletion requires an impact preview, reason and final confirmation. No password or typed-name challenge. Admin or current Company Manager with an active direct `crm_customers_delete` edit/admin grant can execute it.
- For a referenced Customer, Contracts (including numbered draft Partner Cases), CRM activity, transfer evidence, contact history, loading and vehicle movements are retained, including project-only movement links. The physical operational membership is deleted; an immutable historical snapshot and frozen identity/children preserve existing references. New independent work and card restoration are rejected. For an unused Customer, identity and unused card children are removed.
- Execution freezes current authority sources, locks the Customer, rechecks impact and preview fingerprint, and writes an immutable receipt in the same serializable transaction. Partner identity removal additionally requires that transaction's receipt in the database guard. Concurrent history attachment cannot disappear through cascade or SetNull.

## Evidence

- 29 real-database behavioral tests passed: 15 Partner CRM and 14 Customer management tests. Four additional management regressions cover Admin card/child updates and status toggles, immutable audit, ownership/private-evidence preservation, unauthorized/revoked actors, stale root/child edits, foreign child IDs, forbidden owner payloads and duplicate phone rejection. Rollback fixtures plus one narrowly isolated committed concurrency fixture, cleaned in `finally`, use the existing local database. The concurrency test verifies actual PostgreSQL lock waiting and retention of both Customer and project-only movement.
- CRM ownership scope tests passed.
- Ten browser scenarios passed in one final run, covering authenticated creation routing without URL flags, unavailable-context recovery, explicit owned-duplicate selection, desktop/mobile management details and reason-only deletion confirmation, Admin list actions, detail blacklist/lock changes, and atomic editor submission at 1280px and 390px, plus retained-contract/case confirmation at both widths. API responses are mocked at the browser boundary; mutation/authority behavior is independently covered against the real local database.
- Frontend production build, backend build, architecture ownership check, design-system check, 25 foundation tests and 14 adoption tests passed. Existing frontend build warnings remain.
- A supplementary unfiltered frontend TypeScript check encountered errors in unrelated accounting, Partner test fixtures and Sales test files. It is not claimed as a repository-wide passing check; the required frontend production build passed.
- Migration `20261001110000_guarded_customer_permanent_deletion` applied to the existing local database. The operational membership/history retention and subsequent existing-Case and frozen-child safeguards migrations also applied locally. Production migration/deployment remains pending its normal zero-data-loss release procedure.

Reproduce behavioral checks from `backend`, with `CONTRACT_RECOVERY_TEST_DATABASE_URL` pointing to the existing local database:

```text
node --import tsx --test src/services/__tests__/crmCustomerManagement.integration.test.ts src/services/__tests__/partnerCrm.integration.test.ts
node --import tsx src/routes/__tests__/crmCustomerScope.test.ts
```

Browser acceptance from the repository root:

```text
npm run test:design-system:e2e -- tests/design-system-e2e/partner-customer-creation-routing.spec.ts tests/design-system-e2e/crm-managed-customers.spec.ts --workers=1
```

## Admin card correction

The original read-only projection also hid Admin edit/blacklist/lock actions for Partner cards. A browser regression reproduced the missing Edit link before the correction. Admin card editing now uses one protected, freshly authorized transaction for identity and all card children; owner/profile locks precede Customer locks, ownership cannot enter the strict payload, revision plus card fingerprint reject stale saves, and each successful action appends an immutable audit decision. Ordinary owner-scoped routes and Partner command guards remain in place. The existing local backend/frontend services were rebuilt and restarted successfully; production was not changed.

## Authorized local customer card removal

The unique local Customer `58ed6809-4519-42bc-9051-ea9642a7a906` (محمد دهقانیان, owned by فریبا پورشهید) matched the screenshot: two Contracts and four Partner Sale Cases. After the ten browser scenarios and database tests passed, an authenticated Admin requested fresh retention preview and executed the standard DELETE endpoint with explicit confirmation and a reason reflecting the human request. Receipt: `f7aa14df-4db9-4ed1-aa19-ad9a62ebd58b`.

Postconditions verified: operational membership absent, Customer missing from CRM search, direct CRM card endpoint returns 404, immutable history linked to receipt, two Contracts and four Cases retained. Complete Contract rows and Cases including revisions, commercial numbers, payment plans, events and outputs were compared before/after and remained identical. Only the local operational card was deleted; historical personal details intentionally remain. No production mutation occurred.
