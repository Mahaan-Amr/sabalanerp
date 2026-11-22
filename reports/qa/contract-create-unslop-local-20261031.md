# Contract creation polish — local verification, 2026-10-31

Implemented the approved first-step/customer previews and shared wizard presentation in the existing `sabalanerp-local` project. No commit, push, production operation or business-rule change was performed for this task. Existing unrelated source changes were preserved.

## Latest layout adjustment

At the user's request, the first date step is now centered and single-column at all widths. Date, creator and probable number are stacked; original Yekan Bakh assets, static-metadata semantics, navigation and business rules are preserved. Full frontend build, design-system checks (25 foundation / 14 adoption tests) and the focused real-browser scenario passed. The scenario asserts actual centering and vertical order, font readiness, themes, customer round-trip, 390px and 200% zoom. Browser output was isolated under `/tmp/sabalan-centered-contract-e2e` after an earlier shared-output/runtime interruption. Actual screenshots are in `/Users/ferferi/.codex/visualizations/2026/10/31/01a191e3-3f69-7f33-8258-6522e4fc241b/contract-create-centered-result/`. Local only; no commit, push or production action.

## Follow-up resolution

The two failures recorded below were investigated and resolved locally on 2026-10-31. The original browser pair now passes, payment regressions pass, and the full frontend build passes. See [the follow-up report](contract-create-two-failures-local-20261031.md) for the demonstrated causes and exact changes. The earlier failure section remains as historical evidence.

## Changes

- The ordinary workflow header shows the current visible step and title. The shared frame does the same for its consumers; collaboration uses its actual reduced visible-step list.
- Next actions name their destination through the existing canonical navigation component. Explicit caller labels, submit/edit behavior, validation and navigation callbacks remain intact.
- Date input is separated from static registration metadata. Creator and number preview use a description list rather than an input-looking display. Caller-specific number labels and final-number notices are preserved.
- Customer selection retains its existing search, selection, creation and recovery behavior. Search loses its redundant inner card; metadata is less decorative, known customer types/statuses have Persian display labels, and phone runs are isolated LTR.
- Shared platform layout accepts optional header context; other consumers keep their default presentation.
- Existing browser scenarios were updated to recognize the new navigation wording in ordinary/shared partner workflows. The partner number-preview assertion now checks its static display.

## Passed

- `npm run design-system:check` — no new violations, baseline/exception changes or token changes.
- `npm run test:design-system-foundation` — 25 tests.
- `npm run test:design-system-adoption` — 14 tests.
- Shared `ContractWizardFrame` / `ContractWizardStepViews` unit tests — 3 tests.
- `npm --prefix frontend run test:contract-step5` — catalog/cart/performance/standalone-service suites.
- `npm run build:frontend` — final full build and type checking passed; existing repository hook warnings remain.
- New `contract-create-polish.spec.ts` browser scenario — actual local first-step date picker, registration metadata, seven-step navigation, search empty/reset, customer selection, project navigation, retained selection on return, light/dark serious-accessibility checks, 390px mobile and 200% zoom overflow checks. No final contract submission was performed.
- Existing `Partner creation consumes the shared eight-step date, customer, and project presentation` browser scenario passed.
- Yekan Bakh readiness at weights 400/600/700 checked in the actual app before screenshots.
- `git diff --check`.

## Remaining verification failures

The full browser acceptance set is not green:

1. `Sales landing and the first contract step use the minimal shared workflow language` passed its initial ordinary-wizard checks but repeatedly stopped at navigation to `/dashboard/sales/contracts/collaboration/create` with `net::ERR_ABORTED`. This remains unresolved; do not treat it as accepted collaboration coverage.
2. The broader `Contract Creation keeps early and consequential steps accessible and responsive` scenario expected the payment-step «افزودن پرداخت» button to be disabled, but it was enabled. The payment component and its business rules were not changed in this work. That expectation remains unresolved; it was not weakened or removed.

An initial customer-counter contrast failure in light mode was fixed with the existing secondary text token; final targeted ordinary and partner checks passed. Earlier browser attempts were also interrupted by concurrent local image/service rebuilding and frontend startup resets. The final focused command completed with 2 passed / 1 failed (the collaboration navigation case above).

## Actual screenshots

`/Users/ferferi/.codex/visualizations/2026/10/31/01a191e3-3f69-7f33-8258-6522e4fc241b/contract-create-result/`

- `create-date-dark.png`, `create-date-light.png`
- `create-customer-dark.png`, `create-customer-light.png`
- `create-customer-mobile.png`

These are images of the running local app with its original Yekan Bakh files, not static previews or a fallback font.

Design audit workflow: [Unslop by Damir Sokolovsky](https://github.com/heydamir/unslop), adapted for Sabalan's canonical design system and Persian RTL.
