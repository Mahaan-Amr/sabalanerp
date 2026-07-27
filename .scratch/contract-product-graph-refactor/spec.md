## Problem Statement

Contract creation is the most important sales workflow in Sabalan ERP, but Step 5 (`انتخاب محصولات`) and the central product configuration experience are difficult to use quickly and contain structural risks. Sellers think in paper-contract language: they identify a stone, express demand through whichever combination of length, width, area, quantity, stair parts, slab sources, tools, finishing, and remaining material is natural for that sale, and expect the system to behave as a professional calculator. The current experience instead exposes large nested cards, duplicated settings, separate dialogs, explanatory chrome, and product-type navigation that slow experienced sellers and confuse sellers with little software experience.

The implementation is also dangerously coupled. Product state, physical cutting, pricing, remaining-stone inventory, stair layers, add-ons, and downstream snapshots are distributed across UI state and utilities. Some relationships still depend on array position or copied metadata. Calculations can be repeated by different consumers. A source edit or row deletion can therefore change another row, misallocate material, lose data, or create a disagreement between Step 5, persisted contract data, accounting, customer documents, workshop instructions, delivery, and logistics.

This refactor must simplify the experience without removing real sales capabilities. It must preserve all real historical data, keep prepared products behaviorally identical, support every approved way sellers express an order, make physical material allocation exact and deterministic, and establish one canonical owner for geometry, pricing, relationships, and downstream facts. No partially implemented version may reach production.

## Solution

Replace the current type wizard, large product cards, nested operation dialogs, and duplicated calculators with one unified product search, one central configuration modal, flat contract rows, and a canonical versioned product graph.

The seller searches one unified catalog list, selects a product, and immediately receives a compact modal populated from cached core facts. Product-specific sections expose only real decisions. Calculated values remain ordinary editable values. Tools, stone finishing, remaining material, stair layers, and source selection operate inline within the same modal. Compact shared controls, stable section order, local skeletons, subtle transitions, exact inline validation, and crash recovery make the flow fast without adding recommendation panels, help cards, alerts, nested modals, or hidden details.

A pure deterministic product-graph command engine receives the current graph, seller intent, catalog snapshots, calculation-policy version, and base revision. It returns either the complete next canonical graph or structured local conflicts. The frontend uses this engine for immediate preview, while the backend reruns the same engine inside an atomic transaction before persisting. Stable identities replace array indexes. Exact decimal arithmetic, deterministic two-dimensional packing, explicit source allocation, operation groups, immutable price/rate snapshots, audit events, migration adapters, recovery journals, and edit leases protect correctness.

The entire implementation—including all product families and downstream consumers—is completed and accepted before one coordinated production cutover.

## User Stories

1. As a seller, I want one product search instead of a separate type step, so that I can begin with the stone or product I know.
2. As a seller, I want my recent and frequent products ranked inside the normal list, so that common selections are faster without adding another suggestions panel.
3. As a seller, I want Persian, Arabic, and Latin variants of names and digits to match, so that keyboard layout does not slow me down.
4. As a keyboard user, I want arrow navigation and explicit highlighted-row Enter selection, so that I can work quickly without accidental selection.
5. As a seller, I want cancelling product configuration to restore my search, filter, and list position, so that I can continue where I was.
6. As a seller, I want the product modal to open immediately from cached facts, so that network calls do not interrupt selection.
7. As a seller, I want one compact catalog-fact line and one editable contractual title, so that catalog identity and the customer-facing row name remain separate and clear.
8. As a seller, I want a compact new-row product-type selector while editing preserves the saved type as plain text, so that flexibility does not corrupt existing row structure.
9. As a seller, I want contractual descriptions to remain visible in a compact auto-growing field, so that I can record row-specific instructions without expanding the form unnecessarily.
10. As a seller, I want only editable decisions rendered as controls, so that disabled inputs do not make the form look more complicated than it is.
11. As a seller, I want length and width unit switches beside their labels, so that I can enter the units used in the conversation without mental conversion.
12. As a seller, I want changing a unit to convert the value exactly, so that `1.5m` becomes `150cm` instead of changing meaning.
13. As a seller, I want calculated length or area written into the normal editable field, so that I can override it naturally.
14. As a seller, I want the last manually edited compatible dimension to be authoritative, so that later calculations follow my actual intent.
15. As a seller, I want blank optional quantity to remain blank and meaningful, so that the system does not manufacture a quantity.
16. As a seller, I want quantity plus length to mean piece count plus length per piece for longitudinal stone, so that traditional piece-based orders are supported.
17. As a seller, I want length without quantity to mean total linear meters, so that meter-based orders remain fast.
18. As a seller, I want square meters plus width to derive length, so that area-first orders are supported.
19. As a seller, I want square meters plus quantity to derive length per piece, so that piece orders can still begin from requested area.
20. As a seller, I want width to default to the real mother width while other empty numeric fields stay blank, so that the common case is fast without false zeroes.
21. As a seller, I want invalid width or length preserved with one local maximum message, so that the system never silently changes my entry.
22. As a seller, I want price fields to start blank and accept only positive values where material price is required, so that an incomplete price cannot accidentally enter the contract.
23. As a seller, I want zero inventory rates to remain valid for operations explicitly made free by inventory management, so that free work remains visible to the workshop.
24. As a seller, I want missing inventory rates to block only the affected operation locally, so that the rest of the form remains usable.
25. As a seller, I want `حکمی` to activate with piece quantity while remaining manually switchable, so that the current commercial capability is preserved.
26. As a seller, I want clearing quantity to return length to total-linear-meter meaning and turn `حکمی` off without forgetting its percentage, so that changing order expression is reversible.
27. As a seller, I want saw kerf to remain a manual switch using its fixed snapshotted technical value, so that physical cutting stays under seller control.
28. As a seller, I want calibration to receive an accurate default from real width packing but remain manually overridable, so that the common decision is fast without overwriting my choice.
29. As a workshop user, I want longitudinal and cross cuts calculated from actual cut lines, so that instructions and costs reflect the selected layout.
30. As a seller, I want no extra finished piece produced merely to fill a mother stone, so that the contract matches exact customer demand.
31. As an inventory user, I want every positive unused rectangle from consumed material retained, so that no remaining stone disappears because of an arbitrary threshold.
32. As a seller, I want source pieces minimized before cut length and fragmentation are optimized, so that the system chooses an economically sensible deterministic layout.
33. As a seller, I want product rotation prohibited, so that physical grain/direction meaning is preserved.
34. As a seller, I want a compact always-visible calculation summary, so that I can verify layout, material, operations, cuts, and remainders without opening hidden panels.
35. As a seller, I want absent modal-summary values shown as em dashes, so that the summary layout remains stable while inputs change.
36. As a seller, I want available contract remainders displayed as compact rows before dimensions, so that paid material can be reused deliberately.
37. As a seller, I want remainder consumption to require explicit selection, so that the system never takes material intended for another row.
38. As a seller, I want building from a remainder to stay inside the same modal, so that I do not lose context in nested overlays.
39. As a seller, I want a remainder-derived product to have independent title, geometry, operations, and description with zero base material price, so that paid material is not charged twice.
40. As a seller, I want only the minimum required remainder source pieces consumed, so that unused complete pieces stay available.
41. As a seller, I want child allocations replayed deterministically after source edits, so that later changes do not produce unpredictable inventory.
42. As a seller, I want an incompatible source edit rejected atomically with exact child shortages, so that no related row changes partially.
43. As a seller, I want source deletion blocked while independent remainder children exist, so that commercial child products are never silently deleted.
44. As a seller, I want dependent remaining products visible and removable inline from the source conflict area, so that resolution is fast without another dialog.
45. As a seller, I want changing a remainder child’s source to be explicit and atomic, so that its commercial settings survive while material allocation is rebuilt safely.
46. As a seller, I want duplicating a remainder child to require a new explicit source selection, so that duplication cannot consume material twice.
47. As a seller, I want tools inside product configuration instead of a separate management modal, so that all row decisions are committed together.
48. As a seller, I want tool selection itself to mean the tool is active, so that there is no redundant enable switch.
49. As a seller, I want repeated selections of the same tool allowed, so that different edges, groups, quantities, overrides, or snapshots remain independent.
50. As a seller, I want linear tools to require explicit edges and square-meter tools to use area without edges, so that physical meaning follows inventory units.
51. As a seller, I want compact edge shortcuts plus individual edge control, so that common selections are fast and still editable.
52. As a seller, I want operation groups to apply different tools and finishing to different piece counts or lengths, so that mixed workshop instructions remain one commercial product.
53. As a workshop user, I want every piece or meter assigned to exactly one operation group, including an automatic no-operation group, so that production meaning is unambiguous.
54. As a seller, I want a new operation to default to the whole product and expose grouping only when I change its scope, so that the common path stays minimal.
55. As a seller, I want exact group conversion when quantity is added or removed, and explicit resolution when exact conversion is impossible, so that the system never rounds my intent.
56. As a seller, I want calculated operation quantity shown as text with an inline override action, so that manual exceptions do not clutter normal rows.
57. As a seller, I want stale manual overrides preserved until I explicitly keep them or adopt the new calculation, so that geometry changes never overwrite an agreement.
58. As a seller, I want tool and finishing rates loaded from inventory and rendered as text, so that I cannot accidentally alter managed rates.
59. As a seller, I want selected operation rates snapshotted, so that later catalog changes do not rewrite existing contracts.
60. As a seller, I want multiple and repeated stone-finishing operations inline, so that cumulative operations remain possible without a second grouping system.
61. As a seller, I want explicit catalog incompatibilities enforced only within the same operation group, so that no restriction is guessed from a finishing name.
62. As a seller, I want tread, riser, and landing configured as independent flat stair subsections, so that each owns its actual commercial and physical facts.
63. As a seller, I want optional one-time copying from tread, so that repeated input is fast without creating a hidden live dependency.
64. As a seller, I want total steps or complete-staircase entry preserved in a compact selector, so that both traditional selling methods remain available.
65. As a seller, I want tread depth initialized once to `30cm` and riser height once to `17cm`, so that the common case is fast but clearing remains respected.
66. As a seller, I want independent positive prices for tread, riser, and landing, so that a shared stone does not force shared commercial terms.
67. As a seller, I want legacy stair nosing represented through the common tool model, so that hard-coded duplicate charges disappear without losing history.
68. As a seller, I want each stair part packed against snapshotted mother length and width, so that cuts and remainders use real inventory dimensions.
69. As a seller, I want multiple independent layer configurations inside the exact stair parent, so that structural children are not lost as unrelated products.
70. As a seller, I want commercial layer sets separated from physical strips by side, so that customer quantity and workshop material demand are both correct.
71. As a seller, I want all physical strips of one layer configuration optimized together without merging side identity, so that source use is minimized while production remains explicit.
72. As a seller, I want every layer source chosen explicitly from parent material, a specific contract remainder, or new stone, so that no hidden material consumption occurs.
73. As a seller, I want new layer stone priced manually and charged by consumed mother material, so that paid remainders can later be reused without a second material charge.
74. As a seller, I want layer-type units managed by inventory but layer rates entered manually and positively for the contract, so that commercial freedom does not alter quantity meaning.
75. As a seller, I want deleting a stair parent with structural layers to require one inline atomic cascade confirmation, so that this structural relationship differs clearly from independent remainder children.
76. As a seller, I want duplication to default to the stair parent only and require explicit fresh sources when layers are included, so that allocations are never copied.
77. As a slab seller, I want both line-cut and square-meter cutting charge methods retained in one compact selector, so that both real sales methods remain available.
78. As a slab seller, I want square-meter cutting rate entered manually and positively only when that method is selected, so that line pricing remains uncluttered.
79. As a slab seller, I want manual source batches retained as compact stable rows, so that current quotation flexibility remains until real piece inventory exists.
80. As a slab seller, I want source quantities treated as available candidates rather than forced to equal output quantity, so that the optimizer consumes only what is required.
81. As a slab seller, I want finished rectangle and positive quantity resolved through dimensions or area-assisted entry, so that area alone cannot create ambiguous geometry.
82. As a slab seller, I want CAD removed from the slab flow for now, so that one deterministic layout authority remains.
83. As a prepared-product seller, I want all existing subtype, unit, validation, calculation, payload, and downstream behavior preserved, so that this working product family is not redesigned accidentally.
84. As a prepared-product seller, I want only its presentation simplified through shared controls and summary rows, so that it matches the new design without domain changes.
85. As a seller, I want saved contract products shown as flat creation-ordered rows with visible relevant details, so that I can scan the contract without cards or accordions.
86. As a seller, I want stair layers and remainder children visibly nested under or linked to their exact parent/source, so that no dependent row appears unrelated.
87. As a seller, I want edit, duplicate, and delete actions to target stable row identity and affect only that row’s pending state, so that another row cannot change because positions shifted.
88. As a seller, I want saving one row to reconcile and briefly emphasize only that row, so that the full contract list does not reload or reorder.
89. As a seller, I want my entire contract and nested modal draft recovered after refresh or crash, so that I can silently continue without re-entering data.
90. As a seller, I want intentional cancel to discard the relevant recovery scope, so that abandoned changes do not return.
91. As a seller, I want only one active editor per contract with explicit takeover, so that two tabs or devices cannot overwrite allocations or prices.
92. As a seller, I want an unsaved recovered product draft preserved when navigating steps but excluded from saved product counts, so that recovery does not become an accidental contract item.
93. As a seller, I want Persian, Arabic, and Latin numeric input normalized after editing rather than during typing, so that input remains natural.
94. As an accountant, I want exact decimal calculations and one rounding policy, so that every screen and document agrees to the toman.
95. As a system administrator, I want every committed graph mutation audited with before/after financial and allocation facts, so that changes are explainable.
96. As a system administrator, I want failed saves and recovery activity separated from commercial audit history, so that the audit log contains only committed truth.
97. As a maintainer, I want legacy contracts read without write-on-read migration, so that opening historical data cannot change it.
98. As a maintainer, I want ambiguous legacy relationships reported rather than guessed, so that migration cannot silently corrupt parent or source identity.
99. As a maintainer, I want frontend preview and backend persistence to use the same versioned engine, so that client/server disagreement blocks rather than mutates a draft.
100. As a business owner, I want the complete system accepted before one production cutover, so that sellers never encounter a partially implemented contract flow.

## Implementation Decisions

- Introduce a canonical versioned product graph with stable identities for contract rows, structural children, independent remainder children, layer configurations, source batches, remaining rectangles, allocations, operation groups, tool selections, finishing selections, and audit mutations. Array index, catalog identity, names, and display order are compatibility or presentation facts, never relationship identity.
- Establish a pure deterministic product-graph command boundary. A command contains current graph, seller intent, catalog/rate snapshots, policy versions, and base revision and returns either the complete next graph or structured field/section/row conflicts.
- Use the same domain engine in frontend preview and backend validation. Expensive packing runs in a worker on the frontend. Backend output is authoritative only after rerunning the engine inside the transaction.
- Use product-family policies to map longitudinal, stair, slab, prepared, remaining-derived, and layer inputs into shared canonical geometry, pricing, packing, and operation semantics. React components contain no business formulas.
- Use decimal arithmetic for all canonical dimensions and prices. Accept Persian, Arabic, and Latin digits and decimal marks, ignore supported grouping separators, normalize after edit, retain full intermediate precision, round each final billable line once to the nearest toman, and sum saved rounded facts.
- Snapshot calculation, packing, and rounding policy versions plus canonical input/result hashes. Finalized historical facts are never recomputed by a newer policy without explicit authorized edit.
- Upgrade packing to deterministic non-rotating two-dimensional rectangular allocation. Optimization priority is exact demand, minimum consumed source pieces, minimum real cut meters, minimum remainder fragmentation, largest retained rectangle, then stable corner/width/length ordering. No extra requested product is produced. Every positive unused rectangle from a consumed source is persisted.
- Treat customer-requested finished geometry, consumed mother geometry, physical cut truth, and billable pricing as separate canonical concepts.
- Apply kerf only to real cut lines when its manual switch is enabled. Snapshot the technical kerf value. Disabling kerf changes geometry thickness allowance, not existence or billing of real cuts.
- Determine calibration default from real width consumption and positive width remainders, not nominal divisibility. Preserve explicit seller intervention and saved edit state.
- Preserve current mandatory-product policy and accepted ADR behavior. `حکمی` affects its owned price modifier while physical cutting truth remains available to downstream production.
- Replace the separate product-type step with unified search. Ranking is exact code, exact normalized name, prefix, token/fuzzy, then seller history; recent/frequent ranking remains within the same list. Keep compact type filtering and stable catalog order.
- Use one central modal with sticky header/footer and stable section order: type, catalog facts, title, applicable contract remainders, type-specific core inputs, description, direct settings, tools, stone finishing, dependent structures, calculation summary, actions.
- Omit non-applicable sections instead of disabling them. Render immutable but necessary facts as compact text. Do not use nested modal flows.
- Build shared compact segmented controls, exact converting unit switches, inline collection editors, one-to-four-line text area, local skeletons, pending buttons, focus/scroll validation, subtle transitions, and reduced-motion behavior as reusable design-system primitives.
- Keep calculated values in normal editable fields. Track authoritative edit intent separately from displayed numbers. Never use a visual “calculated” state, lock, or special color.
- Keep tools and stone finishing as inline selection collections. Selection existence is activation; no redundant enable switch or boolean is canonical.
- Use one shared operation-group model for tools and finishing. With product quantity, group scope is piece count; without quantity, scope is total linear meters. Maintain an automatic no-operation group for uncovered demand. Support exact splitting and conversion without guessed rounding.
- Linear tools own explicit edge sets; square-meter tools and all finishing own no edges. Repeated selections are legitimate and independent. Inventory supplies immutable unit and rate snapshots for tools and finishing, including valid explicit zero rates.
- Store manual quantity overrides as explicit snapshots. Geometry changes preserve the override and create a required keep/adopt resolution when the automatic value changes.
- Treat contract remainder inventory as stable rectangular pieces owned by the exact source row. Consumption is always explicit, minimum, deterministic, and ordered. Source mutation replays child allocations in stable order atomically.
- Model products built from paid remainders as independent commercial rows linked to exact source/allocation identities. Base material is zero with a saved explanation; new operations remain billable. Independent children block source deletion.
- Model stair layers as structural children of one exact stair part. A parent may own any number of independent configurations. Parent deletion may atomically cascade only after inline explicit confirmation.
- Separate stair-system identity from independently owned tread, riser, and landing commercial state. Copy actions are one-time draft initialization and never create live dependencies.
- Treat each stair part as its own finished rectangle and requested piece count. Use catalog mother dimensions or exact remainder source dimensions; never use a guessed mother length fallback.
- Pack all physical strips of one layer configuration together while preserving side-specific demand identity. Separate commercial layer-set quantity from workshop physical-strip breakdown.
- Require explicit layer source policy: parent paid material, exact contract remainder, or newly selected catalog stone. Never fall back automatically. New material charges consumed mother area and persists paid remainders.
- Preserve both slab cutting-charge methods. Switching pricing policy changes only charge calculation, never physical sources, packing, cuts, or remainders.
- Preserve manual slab source batches as explicit stable available capacity. Unconsumed complete sources are neither charged nor converted into contract remainders.
- Remove slab CAD UI/state and keep the deterministic engine as sole authority. Do not delete unrelated reusable CAD infrastructure.
- Preserve prepared-product behavior, payload, defaults, units, subtype transitions, validation, and downstream meaning exactly. Apply only the approved compact UI refactor.
- Render saved Step 5 products as flat creation-ordered rows. Nest structural layers and visibly link remainder children. Use stable row actions, inline delete confirmation, row-local pending state, targeted reconciliation, and focus-safe optional virtualization.
- Store recovery separately from canonical commercial state. Journal every semantic interaction locally and checkpoint durably without blocking UI. Scope by authenticated user, stable contract draft, schema, base revision, modal view, and nested draft identities.
- Restore valid recovery silently after refresh/crash/restart. Explicit cancel clears only its scope. Recovery never commits products or consumes material.
- Allow only one active editing lease per contract. Refresh/reconnection preserves it. Another location is view-only until explicit takeover fetches latest recovery and atomically transfers ownership. Every save validates base revision.
- Implement legacy dual-read and canonical-only-write. Never migrate on read. Explicit authorized save migrates the entire graph atomically after financial reconciliation. Ambiguous relationships block and are reported.
- Add dry-run migration reporting for migratable contracts, ambiguities, financial differences, broken relationships, and missing rate/snapshot data. Require a recoverable backup.
- Emit one immutable commercial audit event per successful atomic graph mutation with actor, contract/revision, action, affected stable identities, financial and allocation deltas, policy versions, hashes, and migration provenance.
- Persist canonical facts once and make Step 5, PDF, accounting, workshop, delivery, logistics, and confirmation projections consume them. Downstream consumers do not maintain independent calculators.
- Meet the approved performance budgets: cached Step 5 200ms, search 50ms, modal shell 150ms, editable core 250ms, simple calculations 16ms, typical packing 150ms in worker, large packing target 500ms with responsive UI, normal internal save target two seconds, and smooth nested lists of at least 200 rows.
- Complete the whole implementation behind controlled non-production integration. Production receives one coordinated cutover for every user after full acceptance. No production cohorting or old alternate writer remains. Canonical data is never downgraded.

## Testing Decisions

- The primary seam is the canonical product-graph command interface. Tests submit current graph, seller intent, catalog snapshots, policy version, and revision and assert the complete next graph or structured conflicts. These tests cover the majority of domain behavior without testing internal helper structure.
- The atomic persistence seam runs canonical commands through the backend transaction boundary and verifies revision checks, edit leases, migration, audit history, deterministic allocation replay, failure rollback, and reload equality.
- The rendered workflow/projection seam drives unified search, central modal, Step 5 row actions, save/reload, and downstream projections. A small number of high-value tests verify focus, keyboard behavior, recovery, reduced motion, prepared parity, and exact persisted/output reconciliation.
- Prefer the repository’s existing pure production-function scenario style and print-template integration tests as prior art, but replace legacy expectations when they conflict with accepted domain rules.
- Use golden tests built from anonymized real contracts across every product family and dependency shape.
- Use property-based tests for optimizer invariants: exact demand, no overproduction, no rotation, source capacity, minimum consumption, all positive remainders, deterministic identity/order, and no allocation overlap.
- Use failure injection at every atomic mutation boundary, including source edit, child delete, source change, parent/layer cascade, migration, audit write, and recovery/lease interactions.
- Verify exact decimal parsing, conversion, intermediate precision, line rounding, and total reconciliation.
- Verify local validation preserves seller input, focuses the exact control, and never emits alerts or global errors.
- Verify crash recovery after every meaningful semantic interaction and from every nested internal modal view.
- Verify multi-tab/device takeover, old-session save rejection, reconnect behavior, and base-revision conflicts.
- Verify legacy finalized contracts are unchanged on view/print and only migrate on explicit authorized save.
- Verify all ambiguous migration states are reported rather than guessed.
- Verify prepared products with regression fixtures comparing all calculations, state transitions, and saved payloads before and after the UI refactor.
- Verify downstream PDF, accounting, workshop, delivery, logistics, confirmation, and contract totals render the same canonical saved facts.
- Run visual regression at representative desktop resolutions in the application’s Persian RTL layout.
- Run accessibility tests for labels, focus trapping, keyboard list navigation, inline actions, validation scrolling, and reduced motion.
- Enforce the approved timing budgets with representative sales hardware and complex contracts containing at least 200 visible/nested rows.
- Require manual QA by experienced sellers using real paper-contract scenarios and compare completion speed with the current production flow.
- Block release for any critical correctness, data-loss, pricing, allocation, migration, recovery, or downstream-output defect.

## Out of Scope

- Reintroducing or redesigning slab CAD.
- Building a real piece-level slab inventory system; manual slab source batches remain.
- Changing prepared-product business behavior, payload, subtype logic, unit rules, defaults, or calculations.
- Allowing sellers to edit inventory-owned tool or stone-finishing rates.
- Introducing automatic 90-degree product rotation.
- Adding minimum usable remainder dimensions.
- Automatically selecting or consuming a contract remainder or layer source.
- Guessing legacy parent, source, operation-group, nosing-tool, or rate relationships.
- Repricing or rewriting finalized historical contracts merely because they are opened, printed, or read.
- Supporting multiple simultaneous contract writers or field-level cross-session merge.
- Keeping the old product editor as a production fallback after cutover.
- Partially releasing individual product families, modules, or seller cohorts.
- Redesigning unrelated workspaces or shared CAD capabilities.

## Further Notes

- Existing accepted ADRs remain authoritative, including the user-facing ابزار vocabulary with compatibility storage, mandatory cutting policy, and stable delivery product-row identity.
- The implementation should use expand–migrate–contract internally: introduce canonical structures and adapters, migrate consumers in reviewable batches, then remove obsolete components and calculators only after all callers and acceptance tests pass.
- The worktree already contains unrelated modified generated/report files; implementation must preserve them.
- The root domain glossary records the approved vocabulary and invariants and must remain synchronized with implementation decisions.
- This is one complete production release, but it must be built through small testable commits and dependency-ordered tickets rather than one monolithic component or commit.
