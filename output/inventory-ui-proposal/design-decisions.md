# Inventory UI proposal — approved for implementation

The user approved this visual proposal and the Sales-style product steps, then authorized implementation. The gallery remains a static reference with illustrative data.

## Confirmed by the user

- Use the platform Sabalan Design System, light and dark.
- Give products, services, and master data equal priority.
- Include shared Sales product list, creation, detail, and editing surfaces; their presentation will also change in Sales.
- Use readable desktop tables with per-row action menus.
- Provide images for all desktop pages and key mobile examples before implementation.
- Every page and element must adapt to small devices, including dialogs, menus, Excel previews, product steps, and duty workflows.
- Follow-up revision: product wizard steps use the Sales contract wizard's existing `WizardProgressBar` / `ErpNeumorphicWorkflowProgress` design: connected 44px icon circles on desktop, checks for completed stages, solid active stage, outlined future stages; below 640px use the current-stage icon/name/count card and progress rail. Preserve the seven product-specific labels, icons, order, validation, and navigation rules. The read-only creation indicator does not enable arbitrary stage jumping.
- Preserve inventory logic. Implementation starts only after the user approves the images.

## Proposed layout

One stable page hierarchy: workspace navigation, breadcrumb/title, primary action, compact section chooser and search, list or focused form. Dashboard has three equal entry cards. Catalog tables become stacked records on narrow screens; all existing facts and actions remain available. Forms become one column. Dialog bodies scroll within the viewport; actions remain reachable. On small screens the navigation becomes a focused drawer, and section choices wrap instead of forcing viewport overflow.

## Behavior boundaries

Preserve API payloads, identity, permissions, validation, fields, units, calculations, seven product creation steps, status/delete consequences, image upload, Excel template/export/preview/apply, stale-data recovery, duty evidence and server-authorized actions. Catalog prices stay in their existing currency: service rates in toman, product base price in rial. Permission summaries must not be presented as stock balances.

Seven master-data categories share one existing page. Category navigation should target that page's section rather than nonexistent subpages; this is a proposed navigation correction, not a new business feature. Movements/reports remain unavailable. Services and duties get discoverable navigation only with their existing access controls.

Duty surfaces are shared with other workspaces: implementation must scope any inventory-specific composition or deliberately assess shared presentation changes. Product creation return-to-contract behavior remains intact.

## Coverage and verification

The gallery includes 74 proposed pages and states, with individual light/dark desktop images and 320px mobile images for every proposed state, plus 390px key examples. Sample rows, counts, prices, IDs, and duty text are illustrative. Static render checks passed at 320, 390 (key examples), 768, and 1024px widths in both themes. A separate 320x568 compact-device check passed for all 148 light/dark states, including dialog viewport bounds. These checks verify overflow and control dimensions; they do not prove live application behavior, permissions, accessibility, or real-device performance.

After approval, implementation must use canonical ERP components and tokens, run catalog acceptance commands and relevant behavioral checks, and verify the actual workspace responsively in the existing sabalanerp-local environment. No backend, database, or live runtime change is authorized by this proposal step.

No domain terms were changed and no new ADR is necessary for this reversible presentation decision.
