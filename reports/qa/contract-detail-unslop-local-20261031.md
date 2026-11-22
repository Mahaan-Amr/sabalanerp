# Contract detail polish — local verification, 2026-10-31

Implemented the approved preview with the existing Yekan Bakh font on the ordinary sales contract detail page and its `/dashboard/contracts/[id]` alias. Runtime verification used only the existing `sabalanerp-local` project. Only its frontend was rebuilt/recreated; there were no backend changes, migrations, production changes, commits or pushes for this task.

## Result

- Header leads with the contract number; the existing title and customer identify the record beneath it.
- Amount is first in the existing metrics; status, accounting meaning and item count retain their calculations and semantics.
- Summary output settings and the existing PDF/print actions share a compact toolbar. Other tabs retain the existing header output actions. Action eligibility, handlers and pending states are reused.
- Summary specifications retain dates, notes and the first-financial-record deadline without duplicating header metrics. Expired-contract warnings remain visible; other tabs retain their deadline banner.
- Customer type labels are Persian. Customer and responsibility fields use canonical field views in a compact grid.
- Seller changes use the canonical mounted `ErpDisclosure`; current permissions, seller options, legacy credit requirements and mutation handlers are preserved.
- Pre-existing purchasing imports and product actions in the same file were preserved. The real recovery test's two detail-heading assertions were updated for the renamed heading; that mutation-heavy scenario was not rerun for this presentation change.

## Passed

- `npm run design-system:check` — no new violations; baseline and exceptions unchanged.
- `npm run test:design-system-foundation` — 25 tests.
- `npm run test:design-system-adoption` — 14 tests.
- `npm run test:sales-operational-errors` — frontend/backend unit suites.
- `npm run test:design-system:e2e -- contract-detail-polish.spec.ts ordinary-contract-reactivation.spec.ts --grep 'local contract detail|expired cancellation offers' --retries=0` — 2 browser tests.
- `git diff --check`.

The read-only real-data browser test used local contract 100327 (`cmtzjrcoo006euxbvpwmqt8c4`, override with `CONTRACT_DETAIL_QA_ID`). It checked print-version selection, PDF/print availability on all detail tabs, seller selection retained across disclosure close/reopen without submission, contract specifications/deadline, RTL, Yekan Bakh font readiness at weights 400/600/700, light/dark accessibility checks, 390px mobile layout, and 200% zoom overflow. The separate existing route-projection test verified canceled-contract replacement and Accounting authority behavior.

## Build limitation

`npm run build:frontend` compiled application code but failed during TypeScript checking in unrelated pre-existing local purchasing work:

`frontend/src/features/purchasing/inquiryOrderDefaults.ts:2:88` — BigInt literals are not available when targeting lower than ES2020.

That file and the TypeScript target were not changed or bypassed. Full-project production-build verification therefore remains incomplete, although the local frontend and focused browser checks passed.

## Actual screenshots

`/Users/ferferi/.codex/visualizations/2026/10/31/01a191e3-3f69-7f33-8258-6522e4fc241b/contract-detail-result/`

- `contract-detail-dark.png`
- `contract-detail-light.png`
- `contract-detail-mobile.png`

These are screenshots of the running application, not static preview files. They use the application's original font assets with no substituted preview font.

Design audit workflow: [Unslop by Damir Sokolovsky](https://github.com/heydamir/unslop), locally adapted for Sabalan's design system and Persian RTL.
