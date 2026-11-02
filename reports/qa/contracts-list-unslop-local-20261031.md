# Contracts list polish — local acceptance, 2026-10-31

Implemented the user-approved Unslop preview on `/dashboard/sales/contracts` (also used by `/dashboard/contracts`) in the existing `sabalanerp-local` environment. No commit, push, production change, backend update, or database migration was performed for this task. Pre-existing repository changes were preserved.

## Changes

- Canonical row actions now use `rowActionMode="menu"`: a labeled view link and the existing portal action menu / mobile focused sheet. Existing action eligibility, pending guards, handlers and permissions are retained.
- Contract number is the leading identifier, with the title and creator sequence beneath it. Bidirectional isolation preserves identifier order.
- Amounts retain their existing calculation, formatting and units; presentation is neutral and does not wrap. Status and accounting badges retain their meaning without wrapping.
- Dates retain `PersianCalendar.formatForDisplay` semantics, with the weekday separated visually and the date isolated. Unrecognized display formats remain visible in full.
- Search comes first with visible filter labels and more space. Shared `ErpFilters` / `ErpListPage` expose opt-in wide-search and label settings; other consumers retain their defaults. The catalog documents these options.
- Metric labels distinguish loaded results without changing their calculations.

## Verification

Passed:

- `npm run design-system:check` — no new adoption violations; no baseline or exception changes.
- `npm run test:design-system-foundation` — 25 tests.
- `npm run test:design-system-adoption` — 14 tests.
- `npm run test:sales-operational-errors` — frontend and backend unit suites.
- `npm run build:frontend` — successful build and type checking; existing repository hook warnings remain.
- `npm run test:design-system:e2e -- contracts-list-polish.spec.ts reference-surfaces.spec.ts --grep 'contracts list keeps|Sales management routes share' --retries=0` — the new contracts test passed. The existing sales-surface test initially encountered `net::ERR_ABORTED` while navigating to `/dashboard/contract-templates`; its isolated rerun with the same grep passed.

The new browser test checks real local data search and reset, primary navigation links, PDF action availability, desktop popup Escape/focus restoration, mobile sheet Escape behavior, light/dark serious accessibility checks, 390px overflow, and 200% zoom overflow. It does not execute contract mutations. An initial contrast failure on newly introduced secondary metadata in the light workspace was corrected using the existing secondary text token; the final checks passed.

Actual browser screenshots (outside the source tree):

`/Users/ferferi/.codex/visualizations/2026/10/31/01a191e3-3f69-7f33-8258-6522e4fc241b/contracts-result/`

- `contracts-dark-desktop.png`
- `contracts-light-desktop.png`
- `contracts-dark-mobile.png`

Design audit workflow: [Unslop by Damir Sokolovsky](https://github.com/heydamir/unslop), adapted locally for Sabalan's canonical design system and Persian RTL. These final images show the running app, not the earlier static preview.
