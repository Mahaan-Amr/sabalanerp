# Contract creation: two acceptance failures — local follow-up

Date: 2026-10-31. Scope: existing `sabalanerp-local` only. No production operation, commit or push. The approved two-column date presentation was not changed in this follow-up.

## Collaboration navigation

A minimal real-browser reproduction opened the ordinary wizard, then navigated directly to the collaboration wizard. On a cold development entry, the browser logged `[Fast Refresh] rebuilding` followed by `[Fast Refresh] performing full reload`; the document navigation was canceled with `net::ERR_ABORTED`. The same path succeeded after compilation, with the destination workflow present. This identified Next development compilation/refresh rather than a need to change draft ownership or permissions.

The existing acceptance scenario now compiles each cold sibling destination with an HTTP GET, verifies that response, waits for the current page to settle, and then performs and asserts the intended document navigation. Collaboration and edit workflow assertions remain intact. No catch-all error suppression, retries in the helper, draft-guard bypass, navigation permission change or product runtime navigation change was added.

## Payment entry

`Step7PaymentMethod` did not supply the shared payment section's `disabled` state. Both entry points therefore appeared enabled for a new contract with no positive total. A direct component regression reproduced that failure before the fix (`افزودن پرداخت: false !== true`).

The caller now disables both entry points and guards their callback when `!existingContract && totalContractAmount <= 0`. Positive-total new contracts retain entry. Existing-contract entry, including the existing extra-payment workflow and its reason requirement, remains available. Calculations, discount rules, sum validation, persisted payment meaning and backend validation were not changed.

Three regression cases cover zero-total new contracts, positive-total new contracts and existing-contract extra-payment entry. The payment acceptance fixture's corrupted currency text was corrected to `تومان`.

## Verification

Passed:

- Payment presentation unit tests: 4/4, including the initially failing case.
- The two original browser scenarios together: 2/2.
- `npm run design-system:check`: no new violations; no baseline or exception changes.
- `npm run test:design-system-foundation`: 25/25.
- `npm run test:design-system-adoption`: 14/14.
- `npm run build:frontend`: full build and type checking passed, with existing hook warnings.
- `git diff --check`.

Original browser command:

```sh
npm run test:design-system:e2e -- reference-surfaces.spec.ts --grep 'minimal shared workflow language$|early and consequential steps accessible and responsive$' --retries=0
```

The same pair also passed with `--repeat-each=2`: 4/4 browser runs, with retries disabled. No final contract or payment mutation was submitted during these browser scenarios. Temporary navigation instrumentation was removed.
