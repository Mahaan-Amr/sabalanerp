# Sabalan Design System foundation

The shared interface lives at two seams:

- `frontend/src/styles/design-system-tokens.css` maps raw light and dark palettes to stable `--sds-*` meanings.
- `frontend/src/components/erp` hides interaction, RTL, focus, responsive, motion, and common-state behavior from feature callers.

The interface is platform-owned. Guard and Contract Product Selection prove it, but their domain terms and workflows do not belong in shared modules.

## Semantic meanings

Feature code chooses meaning rather than color:

- Surfaces: canvas, panel, subtle, raised, and overlay.
- Text: primary, secondary, muted, and inverse.
- Borders: subtle, default, and strong.
- Actions: accent, hover, soft, on-soft, and focus.
- Status: success, warning, danger, information, and purple extension.
- Layout: shared spacing and control height.
- Shape and elevation: control, card, dialog, pill, card shadow, raised shadow, and focus shadow.
- Motion: fast, standard, slow, and the shared easing curve.

Light and dark adapters expose the same color meanings. Structural tokens cascade unchanged because spacing, shape, and timing do not acquire a different meaning when the theme changes.

## Caller rules

- Import shared interactive modules from `@/components/erp`.
- Use `sds-*` classes or `var(--sds-*)` only when composing layout that is not already represented by a shared module.
- Never select a raw palette value in a route or feature to communicate status, emphasis, or hierarchy.
- Keep domain calculations, permissions, persistence, recovery, and audit behavior outside presentation modules.
- Guidance text is justified only when it prevents a likely mistake, explains an unusual state, communicates permission or audit consequences, or supports recovery.
- Maintain a minimum 44px interactive target. Preserve keyboard order, visible focus, RTL direction, reduced motion, and narrow-screen operation.

## Verification

Run:

```text
npm run test:design-system-foundation
npm run test:design-system:e2e
npm run design-system:check
npm run build:frontend
```

The browser suite starts an isolated embedded PostgreSQL database, applies production migrations, seeds ordinary application data, authenticates through the real login flow, and verifies Guard and Product Selection in the real frontend/backend seam. It does not read or modify a developer or production database.
