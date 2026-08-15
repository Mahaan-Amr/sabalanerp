# Sabalan Design System catalog

This is the required discovery page for interactive Sabalan ERP work by humans and coding agents. The system is platform-owned. Guard and Contract Product Selection demonstrate it; shared modules must not contain Guard, contract, security, or other workspace-specific concepts.

## Choose the deepest existing interface

Import from `@/components/erp`. Prefer a workflow-sized composition over rebuilding it from smaller pieces:

| Need | Canonical interface |
| --- | --- |
| Workspace frame and hierarchy | `ErpWorkspacePage`, `ErpPage`, `ErpSection`, `ErpTwoColumn` |
| Actions | `ErpButton`, `ErpPressable`, `ErpIconButton`, `ErpActionMenu`, `ErpActionGrid` |
| Fields | `ErpField`, `ErpInput`, `ErpSelect`, `ErpTextarea`, `ErpCheckbox`, `ErpCheckboxControl` |
| Choice | `ErpSegmentedControl`; focused product compositions may use `CompactSegmentedControl`, `CompactSwitch`, and `CompactUnitSwitch` |
| Data and summaries | `ErpListPage`, `ErpCard`, `ErpMetricGrid`, `ErpSummaryGrid`, `ErpFieldView`, `ErpStatusSummary` |
| Feedback | `ErpInlineState`, `ErpEmptyState`, `ErpLoading`, `ErpSkeleton`, `ErpStatus`, `ErpBadge` |
| Focused work | `ErpSheet` with `presentation="modal"` for dialogs and `pending` for protected actions; product configuration uses `CentralProductModalShell` |

If a canonical interface owns behavior, do not reproduce that behavior locally. Add a generic capability to the canonical module when it benefits multiple domains. Keep domain compositions close to their feature.

## Semantic presentation

Use `sds-*` classes or `var(--sds-*)` only for composition that no canonical module already owns.

- Surfaces: canvas, panel, subtle, raised, overlay.
- Text: primary, secondary, muted, inverse.
- Borders: subtle, default, strong.
- Actions: accent, accent-hover, accent-soft, accent-on-soft, focus-ring.
- Status: success, warning, danger, info, and purple, with matching surface and border meanings.
- Structure: shared spacing, control height, radii, shadows, motion durations, and easing.

Light and dark themes expose the same meanings. A feature must never choose a Tailwind palette color to communicate status or hierarchy.

## Variants and responsive behavior

Use action `variant` (`solid`, `soft`, `outline`, `ghost`) for emphasis and `tone` (`neutral`, `primary`, `success`, `warning`, `danger`, `info`, `purple`) for meaning. Destructive actions use the danger tone and explicit confirmation when consequences are not easily reversible.

Start with a single narrow-screen column. Add columns only at the breakpoint where the content needs them. Keep primary actions reachable, allow toolbars and segmented controls to wrap or scroll, avoid viewport-wide fixed dimensions, and verify RTL order rather than mirroring by assumption.

## Accessibility contract

- Use semantic controls; never put `onClick` on `div`, `span`, or `li`.
- Every control has an accessible name and at least a 44px target.
- Preserve logical tab order, visible focus, Escape behavior, focus containment and restoration for overlays, and pending-action protection.
- Associate errors and hints with their fields and do not communicate status by color alone.
- Respect reduced motion and keep the workflow usable at 390px width and 200% zoom.

## Content and workflow rules

Lead with the decision or state. Use short Persian labels and direct action verbs. Remove headings, helper paragraphs, and guides that merely restate visible UI. Guidance is justified only when it prevents a likely mistake, explains an unusual state, communicates permission or audit consequences, or enables recovery.

UX may combine redundant steps, improve defaults, and focus a workflow. It must not change business rules, permissions, calculations, row or graph identity, persisted meaning, recovery, or audit history without a separate domain decision.

## Domain composition examples

- Guard composes generic workspace, status, list, field, and sheet interfaces around attendance and security domain behavior.
- Product Selection composes catalog, cart, product-row, service-row, and focused configuration modules while stable row identity and pricing remain in its controller and domain package.
- A future logistics workflow should compose the same generic interfaces around loading-specific state; it must not add logistics concepts to `@/components/erp`.

Generated PDFs, Excel exports, emails, and print templates are outside this interactive system and require a separate document-design effort.

## Required acceptance

Run the smallest relevant behavioral suite plus:

```text
npm run design-system:check
npm run test:design-system-foundation
npm run test:design-system-adoption
npm run build:frontend
```

Run `npm run test:design-system:e2e` when a reference surface, shell, shared interaction, responsive behavior, or focused overlay changes. Update `migration-manifest.json` and regenerate the baseline only after an accepted migration removes debt or an approved exception changes evidence.

The browser command requires the existing `sabalanerp-local` Compose project to be healthy. It never starts services or creates another database. Start the approved project with `npm run docker:local:up`, verify it with `npm run docker:verify`, and then run the suite. Domain lanes add isolated specs and namespaced snapshots under `tests/design-system-e2e`; CI retains traces and failure images and does not accept missing or changed baselines automatically.

The exception schema and evidence requirements are in `docs/design-system/README.md`.
