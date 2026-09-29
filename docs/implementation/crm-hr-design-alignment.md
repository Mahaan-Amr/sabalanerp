# CRM alignment with operational HR presentation

Status: CRM implementation and focused acceptance complete; broader-suite limitations recorded below.

## Confirmed scope

The user accepted the first interview round on 2026-09-29:

- Align the entire CRM workspace, including its dashboard, customer registry and customer creation/edit/detail/shipment views, potential projects, follow-ups, duties, forms, and overlays.
- Use the operational HR dashboard as the reference for metrics and action cards, and operational personnel pages as the reference for forms, tables, and dialogs. Experimental HR prototypes are not the reference.
- Improve visual presentation, information layout, action placement, and redundant copy. Preserve business rules, permissions, calculations, persisted data, recovery, and audit history. Significant workflow changes require an explicit subsequent decision.
- Support both light and dark themes through platform-owned Sabalan Design System components and semantic tokens.

## Confirmed presentation and interaction boundaries

The user accepted the second interview round on 2026-09-29:

- Apply the new presentation only in the CRM workspace. Shared components and CRM customer views used by Sales or Partner contract creation must retain their existing presentation outside CRM.
- Align CRM canvas, header, sidebar presentation, and mobile bottom navigation with the shared operational HR patterns, using CRM-specific destinations and retaining existing access controls.
- Keep standalone creation and editing routes, direct links, and draft recovery. Align existing dialogs and short operations with the operational HR dialog pattern rather than automatically converting long forms into dialogs.
- Make today's and overdue follow-up queues the dashboard's primary content. Retain current metrics, recent potential projects, and event information in a secondary hierarchy.

## Implementation implications

- CRM customer routes can also serve Sales through `?workspace=sales`.
- Customer project fields are shared with Partner contract creation.
- CRM duties use shared destination-duty components; shipment summaries also have shared consumers.
- The dashboard shell and navigation are shared, with existing HR-specific mobile navigation.
- Matching dialog presentation does not automatically authorize replacing standalone creation/edit routes with dialogs.

Use the platform-owned ERP primitives and semantic tokens for buttons, fields, cards, tables, statuses, dialogs, loading/error/empty states, and workspace composition. Preserve textual status meaning alongside semantic color. CRM-scoped shell and presentation changes must account for shared consumers and existing unrelated working-tree changes.

## Acceptance plan

- Verify affected CRM behavior and cross-workspace presentation boundaries with relevant focused checks.
- Run the catalog-required design-system check, foundation and adoption suites, frontend build, and design-system E2E for shell, responsive, and overlay changes.
- Verify RTL, light/dark themes, narrow-screen layout at 390px, 200% zoom, keyboard focus, Escape/focus restoration in dialogs, and protection during pending actions.
- Use only the existing `sabalanerp-local` Compose project for runtime and browser verification, inspecting Compose status before Docker actions.
- Report code changes, local runtime verification, and any production publication as separate outcomes. This design agreement does not request production deployment.

## Interview status

Both recommendation rounds were accepted, and the user explicitly confirmed the consolidated design before implementation on 2026-09-29.

Implementation choices and acceptance evidence will be recorded here as work proceeds. Domain glossary changes and ADRs will be added only when a resolved domain term or a consequential architectural trade-off warrants them.

## Implemented changes

- The CRM dashboard leads with the follow-up queue, followed by existing metrics presented through HR metric cards and canonical HR action cards. Existing project, seller, and timeline information is retained.
- CRM content uses the shared workspace workflow presentation. `ErpPresentationProvider` propagates that presentation into shared metric grids, sheets, searchable lists, and Persian calendar portals without changing the default presentation of other consumers.
- Small supporting text uses the existing secondary text token within the new presentation scope after browser testing found insufficient light-theme contrast in metric hints.
- CRM gains a five-destination mobile navigation bar and sidebar destinations for potential projects and follow-ups. Full CRM mobile navigation requires CRM workspace admission; task-only access does not expose the new navigation.
- `workspace=sales`, `partnerContract=1`, and `returnTo=contract` entry points retain their existing presentation. Shared components used outside CRM retain default presentation, including pre-existing sheets with an explicit workspace scope.
- Customer project/contact dialogs protect pending saves and show retryable failure feedback. CRM deletion confirmations compose `ErpSheet` and canonical buttons, preserving explicit cancellation and the existing last-active-project warning. Project removal in the edit form remains an unsaved form change until the user saves.
- Existing independent dirty work was preserved. No backend, database, or production deployment changes were required.

## Route inventory

The shared CRM presentation covers all 13 current route files:

- CRM dashboard.
- Customer list, creation, detail, editing, and shipment quantities.
- Potential-project list, creation, and detail.
- Follow-up list and creation.
- Destination-duty queue and detail.

## Verification

- Design-system check: no new adoption violations; the baseline was not regenerated.
- Foundation: 25 passing tests; adoption: 14 passing tests.
- Focused behavior: 9 passing checks covering CRM presentation boundaries, customer workflow, searchable selection, Persian calendar behavior/layout, and shipment presentation; destination-duty state checks passed separately.
- Frontend production build passed, with existing hook/lockfile warnings.
- Local frontend rebuilt in `sabalanerp-local`; backend and database services were retained. Preview: `http://localhost:3000/dashboard/crm`.
- New CRM browser checks cover dashboard ordering/counts, both themes, 390px layout and 200% zoom, portal presentation, Sales presentation isolation, pending save failure, and destructive-action confirmation. Final focused results and broad-suite limitations are recorded below.

### Final focused acceptance

- Eight CRM browser journeys passed on the final local frontend: a live dashboard request through the existing backend, HR metric/action presentation and ordering, theme/390px/200% zoom checks, portal presentation and Sales isolation, pending save recovery, deletion confirmation/last-active-project warning, existing customer creation/detail/edit checks, and the seven-route CRM registry/pipeline responsive journey.
- Two shared overlay browser journeys passed: Catalog Excel Sync and Accounting action fields/nested overlays. Total final focused browser result: 10 passing tests.
- Final frontend production build, design-system check, foundation/adoption checks, and whitespace check passed. No baseline regeneration was used.
- Final Compose inspection reported all existing local services healthy. No production publication, Git push, or database changes were performed by this task.

### Broader-suite limitations

A broader 99-test run was stopped after failures outside CRM and long unrelated waits: 67 passed, 8 failed, 1 was interrupted, and 23 did not run. This is not a repository-wide green result. Remaining relevant CRM and shared-overlay checks were executed separately against the final source as described above.

The failed journeys were:

- Sales product creation: expected load-error alert was absent.
- HR work schedule: page navigation returned `ERR_EMPTY_RESPONSE` during local frontend restart.
- Financial-evidence approval conflict: waited for the system invoice number input until timeout.
- Logistics dashboard: page navigation returned `ERR_EMPTY_RESPONSE` during local frontend restart.
- Performance insights: login navigation returned `ERR_EMPTY_RESPONSE`.
- Performance workflow: independent-permission visibility and suspension-action journeys failed.
- Product Selection recovery: the existing restore journey failed.

The Stair layer summary journey was interrupted when the broad run was stopped. Broad-run traces remain under `test-results/design-system`; final CRM evidence is under `test-results/crm-final`, and final shared-overlay evidence is under `test-results/crm-shared-final`. Generated runtime evidence is not a source artifact.

These failures were not silently reclassified as passing, and unrelated workflows were not changed to make the CRM acceptance green. Their root causes beyond the observed local navigation failures remain outside this redesign's verification.
