# Logistics HR visual parity

Status: implemented and verified in the existing `sabalanerp-local` runtime. Production publication is outside this delivery.

## Confirmed scope

- Apply the current HR visual language using platform-owned Sabalan Design System components to the Logistics dashboard, loading register, new-loading wizard, loading detail, duties queue and duty detail, including their forms and modals.
- Layout, spacing and information presentation may improve alongside buttons, colors, metric cards and overlays.
- Cover light and dark themes.
- Preserve loading steps, business rules, calculations, permissions, persisted information, recovery and audit history. Finalization remains distinct from physical dispatch.
- Preserve the header and sidebar, including shared navigation components.

## Confirmed presentation decisions

- Use HR dashboard metric/action compositions and HR operational-page form/modal patterns as the respective references.
- Preserve print and PDF templates and export content; restyle only surrounding interactive controls.
- Cover narrow screens and preserve meaningful status colors and confirmation safeguards.

The user confirmed all presentation decisions and explicitly excluded PDF templates. Refer to `docs/design-system/catalog.md` for component selection and acceptance requirements. Shared duty components must keep other workspaces' presentation intact.

## Implementation and acceptance

- Logistics composes the existing neumorphic workspace surfaces, HR metric/action grids, canonical fields and interactive selection cards. Header, sidebar and shared component defaults were not edited for this change.
- Logistics overlays use the canonical workspace scope. Duty metrics and overlay scope are opt-in props; other destinations retain their prior defaults.
- Wizard step guards, saves, quantities and mutations remain unchanged. Search labels, selected-state semantics and touch targets were improved.
- The loading print-preview source block was compared byte-for-byte with HEAD and is unchanged. No PDF renderer or document template was edited.
- Passed: `design-system:check`, foundation (25 tests), adoption (14 tests), targeted draft/duty behavior (3 tests), and `build:frontend` (existing lint warnings remain).
- Passed: six focused browser tests through `test:design-system:e2e`, covering dashboard counts, loading creation/detail, cancellation reason and pending protection, task reassignment, themes, mobile and zoom. Screenshots are under ignored `test-results/logistics-hr-parity/`.
- `docker:verify` passed; the final frontend was rebuilt and verified against the same healthy Compose project at `http://localhost:3000/dashboard/logistics`.

## Approved simpler Logistics presentation (29 September 2026)

The user reviewed standalone page, wizard, action and mobile proposal images and explicitly approved implementation. The approved revisions put wizard connectors behind opaque icon circles, turn all four dashboard statistics into links, place recent-loading ellipsis controls at the left end of each RTL row, and center each ellipsis within its square target. The header, sidebar, operational rules and PDF templates remain excluded.

- Dashboard metrics use existing totals. Loading-status links open the register with the matching presentation filter; the active-driver link opens the existing Guard admission queue under existing access controls.
- Recent loadings and the register use compact desktop rows and wrapped mobile rows. The register retains source identity, selection, correction counts, bulk commands, required reasons and pending locks. Dashboard menu links open existing detail confirmations; navigation itself never executes a mutation.
- The six existing wizard steps use the same canonical progress and navigation components as Sales. Generic optional disabled/reason fields preserve Logistics step prerequisites on desktop and in the mobile stage picker. Opaque circle backgrounds and a higher stacking layer keep connectors behind icons.
- Selection rows, the three-column contract list, driver quantity tabs and the per-driver review table simplify presentation. Tabs never alter selected drivers, allocations or calculations. Existing save/resume/reservation/finalization functions remain byte-for-byte identical to HEAD.
- `ErpActionMenu portal` is an opt-in shared capability: desktop overlays escape scroll containers, reposition on scrolling/resizing and at 200% zoom, and support Escape, arrow keys and focus restoration. Mobile uses the canonical focused sheet. Legacy callers retain inline behavior. Ellipsis icons have explicit centered positioning in both presentations.
- Logistics carries workspace presentation through shared views and portals. Small shared metric hints and workflow labels use the readable secondary-text token after light-theme contrast verification.

Validation: design-system adoption check, 25 foundation tests, 14 adoption tests, three draft/duty behavior tests, frontend production build, focused Logistics browser acceptance, shared Sales/overlay regression acceptance and the existing local Docker health check. Browser images and traces use isolated `test-results/logistics-ux-v2-*` directories. Print-preview source was compared directly with HEAD and remains identical; no PDF template or renderer was edited. This is a local-runtime delivery, with no production publication.

Final evidence: all 13 selected browser scenarios completed successfully; two initial navigation requests encountered `ERR_EMPTY_RESPONSE` during a local frontend restart and passed on retry. Both scenarios then passed in a separate zero-retry run, together with the two-driver draft-save/review test (including mobile and both themes). The final circular shape and preserved Sales presentation also passed a separate zero-retry run. `build:frontend`, `design-system:check`, foundation/adoption checks and `docker:verify` passed. Final runtime refresh rebuilt only the frontend service with `--no-deps`; all operational and printed-document invariants above were rechecked.


### Readable identities and narrow-device correction

Dashboard recent loadings now use the existing Persian loading-reference formatter instead of raw `L-...` identifiers. Both lists emphasize the customer name in bold primary text and put the project on its own labeled line. Register rows use an explicit phone grid with a reserved identity column, a compact tablet layout, and the existing desktop table from 1024px onward. Selection, filters, bulk commands, menu actions and persisted identifiers are unchanged.

Acceptance covers 347, 453, 525, 910 and 1440px in light/dark themes, including minimum readable name width and maximum wrapping rather than only document overflow. The focused suite also checks selection, cancellation protection, menu escape/centering and dashboard navigation. Evidence is retained under `test-results/logistics-readable-rows*`. Production build, adoption check, 25 foundation tests, 14 adoption tests and three draft/duty behavior tests pass. The frontend is refreshed within the existing local Compose project; no production publication or PDF/header/sidebar changes are included.
