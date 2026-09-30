# Inventory workspace presentation

The user approved the static Inventory gallery and its follow-up Sales-style wizard revision before authorizing implementation on 2026-09-29. The approved reference is `output/inventory-ui-proposal/index.html`; its sample data is illustrative.

## Implemented scope

- Equal dashboard entry points for products, services, and master data; category shortcuts select the existing master-data page instead of nonexistent routes.
- Master-data and six service catalog lists use canonical responsive lists, focused edit/create sheets, and secondary row-action menus. Tables become records on small screens. Existing soft-delete consequences are stated in canonical confirmation dialogs.
- The four standalone catalog creation/editing families use responsive canonical fields and protected submit/cancel actions.
- Shared Sales product list/detail/edit/delete presentation follows the same controls. Product creation reuses Sales `WizardProgressBar` with its existing seven product-specific stages.
- Services are discoverable in workspace navigation. Inventory movements and reports retain their unavailable state. Existing shared duty and Excel interfaces are reused.
- `ErpListPage` gains optional section navigation and menu-style row actions; existing consumers retain the default icon actions.

The 2026-09-30 visual revision removes the duty block from the Inventory landing page, uses the HR workspace's canonical neumorphic cards for its primary and master-data links, and applies the Logistics workspace presentation scope to Inventory list action menus. The duty route remains available through workspace navigation; the catalog routes and action consequences are unchanged.

Revision verification: the frontend production build, design-system check, 25 foundation tests, 14 adoption tests, and five targeted browser cases passed. The browser cases check the removed dashboard block, HR-style card class, 320px light/dark layout, Logistics-style menu scope at 914px, menu Escape behavior, and unchanged master-data and service actions.

## Preserved behavior

No backend, database, calculations, permissions, catalog identities, API mutation payloads, units, import/export behavior, duty evidence, product prerequisites, or contract return flow were changed. Service rates retain toman and product base prices retain rial. Permission counts are no longer presented as dashboard metrics. Pending sheets protect dismissal; inline validation retains the entered draft.

## Acceptance

Executed against the existing `sabalanerp-local` Compose project:

- `npm run design-system:check`
- `npm run test:design-system-foundation` (25 tests)
- `npm run test:design-system-adoption` (14 tests)
- Focused Inventory master-data/Sales authoring behavioral tests (4 tests)
- `npm run build:frontend`
- `npm run docker:verify` (backend/database, frontend proxy/page and inquiry health)
- `inventory-workspace.spec.ts`: nine browser cases covering 320px light/dark lists, all four create/edit families, master-data section navigation and protected pending save, catalog menu/validation, all seven wizard stages and shared product detail/editing. Additional list checks cover 768px and 1440px.
- Nine relevant Inventory/Sales convergence and Catalog Excel overlay browser cases passed, covering protected creation/save/submission, status actions, loading errors, zoom and Excel actions. The final rerun of the adjusted list/error assertions and Excel overlay passed all three cases without retries. An earlier interrupted-runtime response during the shared Accounting portion of the Excel test passed on rerun.

Browser fixtures intercept mutations to avoid adding operational data. Accessibility scans assert no serious/critical violations on the tested forms and overlays. This is targeted browser verification, not an exhaustive test of every possible operational record or permission combination. Standalone repository-wide TypeScript checking still reports existing unrelated accounting/partner/sales test-fixture errors; the frontend production build passes.

The implementation is local; no remote push or production deployment was performed.
