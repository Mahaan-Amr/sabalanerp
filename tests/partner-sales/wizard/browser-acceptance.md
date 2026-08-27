# Browser checkpoint — 2026-08-27

## Wizard module fixture

Command: `node tests/partner-sales/wizard/run-browser.mjs` — **PASS**, four scenarios:
390px and 1440px, each in light and dark mode, RTL. Installed Chrome is used,
matching the repository's Design System browser channel. The standalone fixture
defines the otherwise Next-provided environment constants during its test build.

Verified in every scenario: partial row outcomes, one Dock progression CTA,
retail override and confirmable loss, expiry without input loss, takeover without
input loss, focus transfer, modal focus containment and Escape, uncertain
successor retry inside its protected dialog, no horizontal overflow, actual
Continue click at 200% CSS zoom, fixture Case submit and opening the committed
Case view. No browser page errors were reported. This is component composition
evidence; customer/delivery/payment editors and server commands are explicit
fixtures, not live integration.

The runner records timestamp, compiled fixture/CSS SHA-256 and existing Compose
container/image identities. Success evidence and selected reviewed screenshots
are in `evidence/`. Full screenshots remain under
`test-results/partner-sales/wizard/`.

Visual inspection covered mobile inquiry, dark mobile retail, 200% mobile retail,
and desktop dark inquiry. The sticky progression controls remain clickable at
200%; full-page screenshots can show them at the current viewport position.

## Existing Design System regressions

The npm wrapper initially dropped the grep argument; that broader run was stopped.
The same repository safety runner was then called directly:

```text
node scripts/run-design-system-e2e.mjs reference-surfaces.spec.ts --grep "Sales landing|Contract recovery|Product Selection|Stair layer|Contract Creation|Contract submission"
```

**6 passed (1.3m)**: Sales landing/first contract step; recovery/takeover and blank
independent contract; Product Selection persisted meaning; stair-layer values
during recalculation; responsive early/consequential contract steps; invalid
submission response, retry and exit without resubmitting. These checks exercised
the rebuilt existing `sabalanerp-local` runtime. No baseline was regenerated,
parallel service started, or production activation performed.

Post-run read-only Compose inspection found all five existing services healthy.
Frontend container `756734f9c563` retained image
`sha256:4f002a90c829c21683bd0f848ecde600fabae9326fd2849640e39057f9b0f34d`;
the backend and inquiry image identities were unchanged from runtime handoff.

## Remaining gate

This closes the component-browser checkpoint only. Full rate-free technical
product parity still awaits the public graph/catalog input, validation,
projection and recovery-save contracts from owners 320/317 and integration 334.
Module completion, live Partner E2E and publication are not claimed.
