# Purchasing inquiry browser-history fix — local QA

## Reproduction

A new real-browser regression visited Purchasing Finance, directly opened an isolated inquiry case, entered its item, and called browser Back. The original implementation returned to Finance instead of the inquiry case. The failing DOM explicitly contained «پیگیری حسابداری». Command:

`npm run test:design-system:e2e -- purchasing-quotation-ux.spec.ts --grep 'browser back returns' --output=tmp/qa/purchasing-history-red --retries=0`

It failed at the expected case heading after `page.goBack()` (15-second expectation). Red evidence and trace remain in `tmp/qa/purchasing-history-red`; log `/tmp/purchasing-history-red.log`.

## Cause and fix

Case/item transitions were local React state changes rather than history entries. New-case completion also replaced the current route. URL-driven document opening was deduplicated with a ref that did not reset when Back cleared the document query.

- List/dashboard inquiry actions and case-item actions now open document URLs. Same-route query navigation uses Next-supported native history integration so the URL/history entry exists before the item view becomes interactive.
- Document changes and browser Back/Forward synchronize the rendered view; stale async responses are cancelled and document-query removal clears inquiry views.
- Direct case/item links receive their missing list/case ancestors in the current entry's history. Existing older visits remain intact; Next history state and shared workspace tracking are preserved. There is no global Back interception or redirect loop.
- Visible Back controls traverse the same immediate parent. New-case completion pushes its destination rather than replacing the previous entry.
- No API permissions, records, financial gates or previous commercial evidence changed.

An initial green attempt exposed a fast-navigation timing issue; the final same-route synchronous history update addresses it. Intermediate failed evidence remains in `tmp/qa/purchasing-history-green` and probes, separate from final evidence.

## Acceptance

- `npm run design-system:check`: no new violations.
- Foundation and adoption suites: passed.
- Frontend production build: passed; only task-generated Next configuration drift removed.
- Final quotation UX browser suite: all four scenarios passed, including browser Back/Forward, direct case/item entry, refresh at item level, visible Back controls, mobile 390px and previous quotation/catalog checks. Evidence: `tmp/qa/purchasing-history-final`, log `/tmp/purchasing-history-final.log`.
- Existing workspace browser suite: run against the final local frontend, covering stat links, contracts, centered overlays, keyboard/accessibility, 200% zoom and sidebar navigation. Evidence: `tmp/qa/purchasing-history-workspace`, log `/tmp/purchasing-history-workspace.log`.
- `git diff --check`: passed.

Only the existing `sabalanerp-local` frontend service was rebuilt/refreshed. No production changes or Git delivery.
