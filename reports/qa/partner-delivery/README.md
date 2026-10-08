# Partner delivery presentation — 2026-10-08

The Partner delivery step now follows the ordinary Sales delivery presentation: list header with an outlined add action, icon deletion, shared details fields, compact product names and requested width, quantity arrows, and the contract/other-delivery/remaining summary with a fill action. Independent services use the same allocation list presentation as ordinary Sales.

`ContractDeliveryQuantityControl` is consumed by both flows. Ordinary Sales retains its existing number-based allocation controller. Partner retains its stable row IDs, exact decimal strings, validation, recovery intent, date storage, and defaults. Partner arrow operations use decimal arithmetic and clamp to the maximum left by other deliveries.

## Evidence

- `npm run design-system:check`: passed without new violations or baseline changes.
- `npm run test:design-system-foundation` and `npm run test:design-system-adoption`: passed.
- `npm run build:frontend`: passed (existing repository lint warnings).
- `npx tsx src/features/contract-creation/partner/partnerDeliveryAmount.test.ts`: 2 passed, including precision, allocation ceiling, zero floor, invalid inputs.
- `deliveryProductIdentity.test.ts`: passed.
- `wizardRecovery.test.tsx`: 49 passed.
- `node reports/qa/partner-delivery/verify.mjs`: passed. This mounts the exact delivery JSX extracted from the current Runtime with controlled state, and mounts the actual ordinary Sales step for comparison. It exercises add/remove, increase/decrease, decimal entry, fill, and the exhausted allocation in a second delivery. API, pricing, persistence and recovery are outside this mounted presentation check.
- `comparison.json`: actual add-button and quantity-control dimensions/font sizes match between the two mounted flows (14px text; 44px add action; 176×46px quantity group).
- `observations.json` and PNGs: 390/800px, light/dark, 100%/200% zoom; no horizontal overflow. Ordinary Sales reference images are included.
- Local runtime: existing healthy `sabalanerp-local` Compose project only.

The broader command `npm run test:design-system:e2e -- partner-contract-wizard.spec.ts` completed with **6 passed, 2 failed**. The toolbar fixture expected an Edit button that was absent; the resumed-inquiry fixture expected Previous to show a selected project, but remained on pricing with an autosave error. These scenarios do not exercise the delivery controls. Their traces and screenshots remain under `test-results/design-system`; this report does not claim the broader suite is fully green.

Changes remain local; this increment does not deploy to production.
