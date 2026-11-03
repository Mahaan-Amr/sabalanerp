# Purchasing dashboard metric navigation — local acceptance

The three dashboard metrics now use canonical Sabalan metric `href` links to Requests, Orders and Receipts. Each URL carries `view=attention`; the destination opens the same authorized, loaded population counted by that dashboard card. The visible status selector identifies the active filter and can return to all records. Order and receipt links retain existing section permission requirements. No business records, financial gates or API permissions were changed.

Validated locally with the existing `sabalanerp-local` stack. Only the frontend image was rebuilt/refreshed. No production actions or Git delivery.

- `npm run design-system:check`: no new violations.
- `npm run test:design-system-foundation`: passed.
- `npm run test:design-system-adoption`: passed.
- `NEXT_DIST_DIR=.next-purchasing-metric-links npm run build:frontend`: passed.
- `npm run test:design-system:e2e -- purchasing-workspace.spec.ts --output=tmp/qa/purchasing-metric-links --retries=0`: passed. All three semantic links were focused and activated with Enter, exact destination URLs and active Persian filters checked. Existing modal, RTL/responsive, 200% zoom, accessibility and sidebar checks also passed.
- Browser runner shutdown stalled after the successful test and cleanup; its remaining local test worker was stopped explicitly. The runner then exited 0 with one passed test. No application service was stopped.
- `git diff --check`: passed.

Evidence: `tmp/qa/purchasing-metric-links`, with logs `/tmp/purchase-metric-{ds,foundation,adoption,build,docker,browser}.log`.
