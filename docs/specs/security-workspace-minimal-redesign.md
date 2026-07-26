# Minimal redesign of the Security workspace

## Problem Statement

The Security workspace has grown into a collection of dense, inconsistent pages that mix operational awareness, creation forms, administrative configuration, descriptive guidance, metrics, tables, and exports. The redesigned Security dashboard has established a clearer mobile-first visual and interaction language, but the remaining Security routes still use the older presentation. Managers and guards must process too much duplicated or weakly prioritized information, mobile users encounter crowded forms and tables, report generation requires confusing date-range and output choices, and reusable behavior is not yet expressed through a coherent component layer.

The Security workspace needs one internally consistent, minimal experience that preserves its existing operational truth, permissions, audit history, and workflow logic. The change must remain scoped to Security, except for a backward-compatible redesign of the shared Persian calendar, so other workspaces do not receive an uncontrolled visual rollout.

## Solution

Redesign every route under the Security workspace and its workspace-specific navigation around a view-first, mobile-first hierarchy. Use compact Persian headings, truthful operational state, semantic status presentation, focused forms, responsive structured lists, URL-owned navigation state, independent loading and failure states, and purposeful motion. Remove descriptions by default and retain contextual text only when it prevents a risky mistake, explains an unusual state or ambiguous rule, or communicates loading, empty, error, permission, or audit context.

Build additive shared ERP primitives for reusable behavior and presentation, then compose Security-specific components that express Security domain meaning. Adopt the new primitives only within Security during this pilot. Redesign the shared Persian calendar globally without changing its existing value formats, validation, rules, or public component behavior.

Replace the existing broad reporting interface with two manager-focused report products: گزارش شیفت‌ها and گزارش حضور و غیاب. Managers can find completed shifts directly without first constructing a date range, inspect one shift or select several, scope attendance output to one or several shifts and one or several people, preview the exact result, and generate concise PDFs containing only decision-relevant information and required audit context.

## User Stories

1. As a Security workspace user, I want every Security page to use the same visual and interaction language, so that moving between workflows feels predictable.
2. As a mobile Security user, I want every primary workflow designed for my screen first, so that I can work without horizontal scrolling or cramped controls.
3. As a desktop manager, I want compact comparison-friendly tables where row comparison matters, so that I can scan operational records quickly.
4. As a mobile user, I want table rows represented as structured list items, so that essential information remains readable and tappable.
5. As a user, I want identity, state, and the most important value visible immediately, so that I do not have to expand every record.
6. As a user, I want secondary row details expandable, so that the default list remains minimal.
7. As a keyboard user, I want visible focus and semantic controls, so that every workflow remains operable without a pointer.
8. As a touch user, I want targets at least 44–48 pixels, so that actions are reliable on mobile.
9. As a user of either theme, I want sufficient contrast and stable semantic meaning, so that status remains understandable in light and dark mode.
10. As a Security user, I want one compact Persian page title, so that headings provide orientation without decorative repetition.
11. As a user, I want a Jalali date or record identity only when it adds context, so that headings remain concise.
12. As a user, I want no repeated workspace names, English eyebrows, generic subtitles, or decorative metrics, so that the page emphasizes work.
13. As a user, I want at most one primary header action, so that the next action is obvious.
14. As a user, I want secondary actions near their relevant content or in an overflow menu, so that headers remain calm.
15. As a detail-page user, I want a clear back link and record identity, so that I can return without breadcrumb clutter.
16. As a user, I want descriptions removed unless they prevent mistakes or explain a real state, so that I read only useful text.
17. As an authorized operator, I want short forms in a responsive sheet, so that simple work does not displace the primary page.
18. As an authorized operator, I want complex or high-risk workflows on a focused page, so that I can complete them without distraction.
19. As a user performing an audited or destructive action, I want an explicit consequence-aware confirmation, so that I do not make an irreversible mistake accidentally.
20. As a user returning from a workflow, I want my filters and scroll position restored, so that I can continue where I left off.
21. As a user, I want meaningful list state stored in the URL, so that search, filters, tabs, sorting, dates, and pagination can be restored or shared.
22. As a mobile user, I want filters collapsed into a bottom sheet, so that results remain the primary content.
23. As a user, I want active filters represented as removable Persian chips with a clear-all action and result count, so that the current scope is obvious.
24. As a user, I want multi-field filters applied explicitly and search debounced, so that the interface does not refetch chaotically.
25. As a user, I want a clear difference between today, the current shift, and a manually selected scope, so that time context is never ambiguous.
26. As a user, I want filtered empty results to offer reset, so that I can recover immediately.
27. As a user, I want one consistent Persian-labelled status system, so that the same state looks and reads the same everywhere.
28. As a user with color-vision limitations, I want status communicated through text and not color alone, so that meaning remains accessible.
29. As a user, I want red reserved for urgent attention, so that neutral historical or inactive records do not look dangerous.
30. As a user, I want completed, archived, cancelled, and unavailable states neutral unless actionable, so that visual urgency remains truthful.
31. As a Security user, I want navigation ordered around daily operations before management and configuration, so that frequent destinations are easiest to reach.
32. As a user without permission for a destination, I want it hidden rather than disabled, so that navigation reflects my actual scope.
33. As a user, I want the Security navigation order to be داشبورد گارد، حضور و غیاب، گزارش شیفت، خودرویی، استثناها و مأموریت‌ها، شیفت‌ها، گزارش‌ها، کارکنان گارد، تنظیمات گارد, so that every Security surface uses one information architecture.
34. As an attendance operator, I want the selected day or shift and truthful summary first, so that I understand the list context immediately.
35. As an attendance operator, I want the complete personnel list to be the primary content, so that dashboard summaries are not duplicated.
36. As an attendance operator, I want expected and actual entry/exit context alongside attendance state, so that irregular records can be understood.
37. As an authorized attendance operator, I want correction and manual-entry workflows focused outside the list, so that the primary page remains readable.
38. As an attendance operator, I want missing checkout and conflicting records explained inline, so that unusual states are actionable.
39. As a gate operator, I want تردد جاری to open by default, so that vehicles inside or awaiting completion are immediately visible.
40. As a gate operator, I want each active vehicle row to show vehicle, driver, entry time, load/state, and one relevant next action, so that gate work is direct.
41. As a user reviewing vehicle history, I want completed movements under سوابق with search and URL-owned filters, so that active work is not mixed with history.
42. As a gate operator, I want vehicle and driver registration separated from the active queue and history, so that the page does not become one long form.
43. As a manager, I want شیفت جاری، برنامه شیفت‌ها، and سوابق as focused shift views, so that live state, planning, and history are not mixed.
44. As a manager, I want schedule gaps, overlaps, and unassigned slots exposed clearly, so that coverage decisions are immediate.
45. As a manager, I want complex schedule creation and editing focused outside the overview, so that planning remains understandable.
46. As a read-only shift viewer, I want permitted schedule information without disabled controls, so that the page remains clean.
47. As a manager, I want a searchable Security personnel roster before metrics, so that people management begins with the actual people.
48. As a manager, I want personnel identity, assignment, access state, and operational status visible in the roster, so that I can assess each person quickly.
49. As a manager, I want profile, assignments, roles, permissions, and audit context separated clearly, so that access changes are not confused with ordinary information.
50. As a manager, I want inactive personnel available through filters with neutral status, so that history is retained without false urgency.
51. As an exception or mission reviewer, I want نیازمند بررسی to open by default, so that pending decisions are visible first.
52. As another authorized user, I want همه موارد to open by default when I am not a reviewer, so that the page matches my role.
53. As a user, I want exceptions and missions in one list with explicit type labels and filtering, so that related records are together without losing their distinct meaning.
54. As a reviewer, I want requester, effective time, reason category, approval state, and operational overlap visible, so that I can make an informed decision.
55. As a creator, I want separate focused forms for exceptions and missions, so that each workflow follows its own rules.
56. As an auditor, I want approvals, rejections, cancellations, and corrections preserved as history, so that earlier decisions are never silently replaced.
57. As a dashboard user, I want approved missions counted by authorization overlap rather than primary attendance status, so that the number remains truthful.
58. As the active guard, I want the complete active-session timeline and permitted operational controls, so that I can run my shift.
59. As a Security manager or admin, I want the same active timeline in explicit read-only mode, so that I can observe without operating another guard’s shift.
60. As another read-only Security user, I want no access to another guard’s active identity or timeline, so that sensitive live activity remains private.
61. As a timeline reader, I want category, author, timestamp, description, attachments, corrections, and void history together, so that each event remains auditable.
62. As a timeline reader, I want entries presented chronologically without a heavy card around every row, so that long shifts remain easy to scan.
63. As a Security manager, I want reports reduced to گزارش شیفت‌ها and گزارش حضور و غیاب, so that I do not have to interpret competing report modes.
64. As a Security manager, I want completed shifts listed newest-first, so that recent operations are immediately available.
65. As a Security manager, I want to find a completed shift by identifier, guard, Jalali date, or operational state without first selecting a date range, so that retrieval is intuitive.
66. As a Security manager, I want date range available only as an optional advanced filter, so that common searches remain simple.
67. As a Security manager, I want to select one or several completed shifts and preview their complete read-only timelines, so that I can review the exact operational scope.
68. As a Security manager, I want an attendance report scoped by one or several shifts and one or several personnel, so that I can answer precise management questions.
69. As a Security manager, I want the export action to state the selected scope, so that I do not accidentally generate an overly broad report.
70. As a Security manager, I want to preview the exact report before download, so that the PDF matches my intent.
71. As a PDF reader, I want only the title, scope, essential timestamps and statuses, useful summary, evidence rows or timeline, generation time, and page numbers, so that the output is concise and auditable.
72. As a PDF reader, I want decorative charts, helper text, empty columns, controls, repeated metadata, and oversized branding omitted, so that the report stays straight to the point.
73. As a manager, I want report details read-only unless an existing correction workflow applies, so that reporting does not become a competing operational editor.
74. As a Security administrator, I want تنظیمات گارد to be a compact index, so that unrelated configuration is not crowded onto one page.
75. As a Security administrator, I want فهرست حضور و غیاب and ساختار گزارش شیفت on separate routes, so that each configuration task is focused.
76. As a shift planner, I want the derived current A/B/C operational population shown with shift planning rather than settings, so that source and effect appear together.
77. As a Security administrator, I want report categories and nested types in one hierarchical view, so that their relationship is obvious.
78. As a Security administrator, I want inactive categories and types filterable with neutral presentation, so that history remains available.
79. As a user, I want each independent section to load and fail independently, so that one failure does not erase successful content.
80. As a user, I want structure-matching skeletons on initial load, so that the page remains stable while data arrives.
81. As a user, I want localized button progress, so that submitting one action does not block the whole page.
82. As a user, I want previously loaded data preserved during a silent refresh failure, so that temporary network issues do not remove my context.
83. As a user, I want live operational views refreshed every 30 seconds, so that current state remains useful.
84. As a user, I want historical and settings data refreshed only deliberately or after mutation, so that stable pages do not move unnecessarily.
85. As a form user, I want entered values preserved after a failed submission and focus moved to the relevant error, so that recovery is quick.
86. As a user, I want smooth entry, sheet, tab, list, filter, and status transitions, so that state changes are understandable.
87. As a user, I want live timeline additions briefly highlighted, so that I can recognize what changed.
88. As a reduced-motion user, I want movement removed while state feedback remains clear, so that the experience is comfortable and complete.
89. As a user of the Persian calendar, I want the existing date logic and accepted values preserved, so that redesign does not change workflow results.
90. As a desktop calendar user, I want an anchored popover with direct month and year selection, so that date navigation is efficient.
91. As a mobile calendar user, I want a bottom sheet with large touch targets, so that selection is comfortable.
92. As a date-only user, I want selection committed immediately, so that simple fields stay quick.
93. As a date-time user, I want explicit confirmation before commit, so that time is not saved accidentally.
94. As a form designer, I want a reusable date-range wrapper while the single-date API remains compatible, so that future pages share behavior safely.
95. As a future workspace developer, I want generic ERP primitives free of Security labels and permissions, so that they can later be adopted elsewhere.
96. As a maintainer, I want Security components to compose generic primitives with domain meaning, so that domain behavior does not leak into the shared layer.
97. As a product owner, I want the shared shell, top bar, workspace switcher, and other workspaces unchanged, so that the pilot remains controlled.
98. As a maintainer, I want unrelated worktree changes preserved, so that the redesign does not overwrite other work.

## Implementation Decisions

- The redesign covers the Security dashboard, attendance, vehicles, shifts, Security personnel, exceptions and missions, active shift report, reports, report details, settings, settings subpages, and Security-specific navigation presentation.
- The shared application shell, top bar, workspace switcher, and other workspaces remain visually unchanged.
- Security navigation uses this canonical order: داشبورد گارد، حضور و غیاب، گزارش شیفت، خودرویی، استثناها و مأموریت‌ها، شیفت‌ها، گزارش‌ها، کارکنان گارد، تنظیمات گارد. Daily operations and management/configuration are separated subtly. Inaccessible destinations are hidden.
- Page headers use one compact Persian title, optional quiet Jalali date or record identifier, at most one primary action, and contextual secondary actions. Detail pages use a back link and record identity instead of breadcrumb clutter.
- Descriptions are absent by default and retained only for risk prevention, unusual states, genuine ambiguity, loading, empty, error, permission, or audit context.
- Pages are view-first. Inline actions are limited to immediate low-risk single-outcome changes. Short forms use responsive sheets; complex or high-risk workflows use focused pages. Destructive, corrective, approval, and audit-sensitive actions require explicit confirmation.
- Meaningful search, filter, selected view, date scope, sorting, and pagination state is URL-owned. Back navigation restores list state and scroll position. Saved filters and presets are not introduced.
- Desktop uses compact semantic tables where comparison matters. Mobile uses structured list items with essential fields, expandable secondary detail, one visible primary action, and secondary overflow. Ordinary lists do not horizontally scroll. Existing genuine bulk operations use explicit mobile selection mode.
- One data-driven status contract provides Persian label, semantic tone, and optional restrained icon. Color is never the sole carrier of meaning. Red is reserved for urgent actionable states; inactive and historical terminal states are neutral unless actionable.
- Attendance leads with selected day or shift, a truthful compact summary, and the complete personnel list. Existing attendance rules, corrections, expected-work logic, and permissions remain authoritative.
- Vehicles separates تردد جاری from سوابق. Registration and complex movement workflows are focused outside the active list. Existing gate, loading, sale-exit, registry, evidence, and permission rules remain authoritative.
- Shifts separates شیفت جاری، برنامه شیفت‌ها، and سوابق. The current A/B/C population appears with planning. Gaps, overlaps, and unassigned slots are explicit. Existing baseline, substitution, coverage, publication, closure, and audit rules remain authoritative.
- Security personnel leads with a searchable roster. Identity/profile, assignments, account/access, roles, permissions, and audit context are separated. Inaccessible actions are hidden.
- Exceptions and missions uses نیازمند بررسی and همه موارد. Type remains explicit. Forms and rules remain separate, and approved missions remain authorization facts distinct from primary attendance state.
- The active shift report reuses one timeline in operational and manager/admin read-only modes. The active guard retains existing permitted controls. Managers/admins receive complete read-only visibility. Other read-only Security users cannot access the full session or see live identity/timeline data.
- Reports are reduced to گزارش شیفت‌ها and گزارش حضور و غیاب. Completed shifts are searchable directly and newest-first; date range is optional advanced filtering. Shift reports support one or several selected completed shifts. Attendance reports support one or several selected shifts and one or several personnel. Every export is preceded by an exact preview and scope-labelled action.
- Report PDFs use a minimal identity and contain only required scope, essential facts, evidence, concise useful summary, generation time, and page numbers. Empty sections, decorative charts, helper copy, controls, repeated metadata, empty columns, and oversized branding are omitted.
- Existing performance-report and Excel interfaces are removed from this Security reports page, but backend behavior or historical data is not deleted merely because it is no longer exposed there.
- تنظیمات گارد becomes an index with separate pages for فهرست حضور و غیاب and ساختار گزارش شیفت. Category/type configuration is hierarchical and focused. Current A/B/C population moves to shifts.
- Independent sections own initial loading, empty, error, retry, refresh, and stale-data states. Live operational views silently refresh every 30 seconds and preserve last successful data on refresh failure. Stable history/settings views refresh explicitly or after mutation.
- Motion explains entry and state change: stable shell, subtle section entrance, consistent sheets/dialogs/expansion/tabs/chips/menus, restrained interactive feedback, animated list/status change, gentle numeric transitions, and brief live-entry highlight. Most interaction motion is 160–280 ms. Continuous decorative motion is excluded. Reduced motion retains non-spatial feedback.
- Shared ERP primitives provide compact page header, responsive data view, filters and mobile sheet, status, menus, sheets/dialogs/confirmation, Persian date/date-range fields, data states, expandable detail, timeline foundation, and report-scope selection.
- Security-specific components compose those primitives into shift, attendance, vehicle, exception/mission, timeline, personnel, and report concepts.
- Components are data-driven and do not fetch route data internally unless live behavior genuinely belongs to the component. Shared primitives contain no Security labels or permission assumptions.
- Semantic tokens define surfaces, text, borders, focus, statuses, and motion for both themes. New shared primitives are adopted only by Security during this pilot.
- The shared Persian calendar is the only intentional global visual change. Its accepted values, public API, validation, minimum/maximum years, disabled-date behavior, future/past rules, time behavior, and current consumers remain backward compatible. Desktop uses a popover; mobile uses a bottom sheet. Date-only commits immediately; date-time requires confirmation. Today, clear, direct month/year selection, keyboard navigation, focus restoration, and reduced motion are supported where allowed. A reusable range composition is additive.
- Backend additions are permitted only where completed-shift search, multi-shift selection, multi-person selection, report preview, or scoped PDF generation requires them. Changes should be additive and must preserve domain rules, authorization, immutable evidence, and audit history.

## Testing Decisions

- Tests assert externally visible behavior and stable public contracts rather than component internals, CSS class names, or implementation-specific state.
- Shared ERP primitives are tested at their public behavior seam for RTL keyboard interaction, focus, status labelling, theme semantics, responsive disclosure, sheets/dialogs, and reduced motion.
- Security pages are tested at the route/view-model seam with controlled API responses for permissions, URL state, loading, success, empty, partial failure, retry, stale refresh, responsive row priorities, and restored navigation state.
- Security service and route tests cover authorization, completed-shift search, selection validation, report preview scope, and PDF scope. Existing security dashboard-awareness and attendance-report tests are extended rather than bypassed.
- PDF tests verify included facts, omitted empty/decorative sections, selected shifts/personnel, authorization, minimal headings, generation context, and stable Persian font embedding. They do not snapshot incidental byte layout.
- Calendar tests exercise its public component behavior and representative existing consumers for single date, date-time, range composition, min/max years, disabled past/future dates, clear/today rules, focus restoration, desktop/mobile interaction, and unchanged serialized values.
- Permission tests cover active guard, Security manager/admin, other read-only Security user, and users without Security access. Hidden navigation, active timeline visibility, operational controls, report access, settings access, and backend enforcement must agree.
- Responsive verification covers mobile, wide tablet, and desktop behavior without ordinary horizontal list scrolling. Theme verification covers light and dark semantic contrast.
- Type-checking, linting, relevant single-test runs, complete frontend/backend suites, and production builds are required before delivery.
- Post-deployment visual QA is performed with a supplied checklist across mobile, tablet, desktop, both themes, permissions, calendar variants, live refresh, and PDFs.

## Out of Scope

- Redesigning the shared application shell, top bar, workspace switcher, or another workspace.
- Globally restyling existing ERP components or migrating other workspaces to the new primitives.
- Changing Security, attendance, vehicle, shift, exception, mission, leave, personnel, or audit business rules except for additive report-query behavior explicitly described here.
- Reintroducing operational entry/exit forms or creation actions on the Security dashboard.
- Exposing the active guard or live shift entries to ordinary read-only Security users.
- Saved report/filter presets.
- Treating approved mission or leave counts as mutually exclusive attendance-total partitions.
- Deleting legacy report APIs, historical report data, or Excel generation merely because those actions leave the redesigned reports interface.
- Manager backfill of active-shift log entries unless already authorized by existing behavior.
- A platform-wide design-system rollout.

## Further Notes

- The existing redesigned Security dashboard is the visual and interaction reference for this workspace expansion.
- The dashboard retains its previously accepted read-only awareness role, permission-aware active-shift visibility, four-condition status summary, quick access, and minimal Needs Attention behavior.
- Existing domain ownership remains intact: Human Resources owns leave and expected work schedules; Security consumes their operational consequences. Security owns its guard rota, gate operations, active shift evidence, and attendance recording within existing boundaries.
- A mixed old/new Security release should be avoided. Implementation may proceed in internal slices, but release should present one coherent workspace.
