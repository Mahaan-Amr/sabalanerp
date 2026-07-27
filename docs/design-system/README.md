# Sabalan Design System migration control

The Sabalan Design System is the platform-wide visual, interaction, accessibility, content, and user-experience language for every interactive Sabalan ERP web surface. Guard and Contract Product Selection are reference implementations; neither workspace contributes domain assumptions to the shared system.

This directory records migration state and freezes existing UI debt while the additive rollout proceeds.

The semantic token and shared-module interface is documented in
[`foundation.md`](foundation.md).

## Route states

`migration-manifest.json` classifies every interactive route through ordered rules:

- `reference`: an accepted implementation used to discover and prove the shared system.
- `migrated`: a route whose vertical migration and acceptance evidence are complete.
- `legacy`: a supported route waiting for its migration ticket.
- `exempt`: a route deliberately outside ordinary migration, with accountable justification.

Every rule also records its acceptance status. The first matching rule wins. Keep narrow rules before the final legacy fallback. A new route is not complete until its intended state is explicit and `npm run design-system:report` reports zero unclassified routes.

Reference behavior that occupies only part of a legacy route belongs in `surfaces`, not in a route rule. Contract Product Selection is recorded this way because the surrounding Contract Creation workflow has not migrated.

The report also inventories:

- shared consumers that import the current canonical ERP interface;
- legacy consumers of known glass, HR, and Accounting interfaces;
- reference surfaces and their acceptance status;
- risk findings and approved exceptions.

## Debt baseline

`adoption-baseline.json` is a multiset of existing findings by file, category, and signature. It currently tracks:

- `hardcoded-semantic-color`
- `legacy-glass-style`
- `duplicate-primitive-risk`
- `raw-control-risk`

Hard-coded semantic colors include hex, RGB/HSL functions, and Tailwind palette utilities used for semantic presentation. These findings are intentionally conservative risks, not claims that every finding is a confirmed accessibility or design defect. Existing counts may remain while their migration ticket is open. A changed file fails when it adds a signature beyond its baselined count.

Run:

```text
npm run design-system:report
npm run test:design-system-adoption
npm run design-system:check
```

Use `npm run design-system:baseline` only after an approved migration or an approved exception changes the evidence. Never regenerate the baseline merely to silence a new violation. Baseline changes must be reviewed with the implementation that removes debt or documents the exception.

Pull-request checks compare changed files against the baseline committed on the target branch. Regenerating the baseline inside a pull request therefore cannot hide newly introduced debt.

## Implementation boundaries

Canonical modules sometimes have to use the lower-level mechanisms they hide from feature code. `implementationBoundaries` declare those narrow seams by real file pattern and category:

- `frontend/src/components/erp/**` may implement semantic components with native controls and internal palette choices.

These allowances belong to the implementation boundary, not its callers. Feature and route code must consume semantic interfaces and tokens. Boundaries are restricted to canonical component roots or the dedicated `frontend/src/styles/design-system-tokens.css` adapter; mixed-purpose global styles, routes, and feature directories cannot be exempted. Each boundary needs a unique identifier, an accountable owner, a reason, at least one existing matching file, and only the categories required to implement that interface. A future canonical location or token adapter is added with its implementation, not reserved through a broad or non-existent pattern.

## Exceptions

Exceptions live in `migration-manifest.json`. Keep them narrow and use this shape:

```json
{
  "file": "frontend/src/path/to/surface.tsx",
  "category": "raw-control-risk",
  "signature": "<button",
  "allowance": 1,
  "reason": "The canonical interface cannot yet express the required behavior.",
  "owner": "accountable team or person",
  "accessibilityEvidence": "Evidence that the temporary behavior remains operable.",
  "themeEvidence": "Evidence for light and dark presentation.",
  "resolution": "Issue or condition that removes the exception or adds canonical support."
}
```

An exception is not a parallel design system. It applies to one exact file, category, signature, and bounded total allowance. The permitted total is the larger of the target-branch baseline count and the exception allowance, so rebaselining cannot silently add the two together. It must identify the unmet need, accountable owner, accessibility and theme evidence, and removal or canonical-system addition path. Invalid or wildcard exceptions make the report and checks fail.

## Updating migration state

When a vertical migration completes:

1. Add or narrow a manifest rule so the route becomes `migrated`.
2. Remove local legacy presentation and duplicated primitives only after their final consumer migrates.
3. Run the focused workflow acceptance seam and relevant domain regression tests.
4. Regenerate the baseline; the affected debt must stay level or decrease unless an approved exception explains it.
5. Run the adoption test and changed-file check.

Generated PDFs, Excel exports, emails, print templates, and other non-interactive documents are not classified by this migration.
