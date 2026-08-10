## Problem Statement

The shared dashboard shell and Sales Contract creation presentation still contain visible alignment, hierarchy, and contrast defects after the initial neumorphic redesign. On desktop, the sidebar competes with the header instead of sitting below a full-width site header, its outer rectangular surface adds an unnecessary visual layer, collapsed icons are not consistently centered, and the theme and logout controls do not form a coherent pair. In the expanded workspace navigation, dashboard icons, titles, and disclosure chevrons do not remain on one horizontal axis. Within all three Sales Contract flows, equivalent creation and compact collection actions have inconsistent presentation, collection results lack comfortable padding, and some text can resolve to black in dark mode.

These defects must be corrected through shared presentation components without changing navigation destinations, contract calculations, validation, permissions, recovery, persistence, submission, or any other business behavior.

## Solution

Refine the platform-owned dashboard shell and shared Sales Contract presentation so the full-width 64px header owns the top edge on every viewport. Position the desktop sidebar and mobile drawer below it. Remove the square desktop sidebar layer's background, border, and shadow while retaining the curved, lighter navigation rail inside it, the mobile drawer panel, and the overlay. Center collapsed navigation controls, equalize the collapsed theme and logout controls, and place those controls in one horizontal row when expanded. Keep workspace icons and Persian titles on one line and place the disclosure chevron at the opposite edge.

Normalize equivalent contract actions across standard creation, collaboration creation, and contract editing through shared Sabalan Design System presentation. Make “ایجاد پروژه” visually identical to “ایجاد مشتری”; give compact collection actions and their result rows clear padding, minimum 44px targets, and readable neumorphic states. Audit semantic text usage throughout the shared navigation and all three contract flows so light and dark themes remain readable.

## User Stories

1. As a desktop user, I want the site header to span the full viewport, so that the application has a clear top-level frame.
2. As a desktop user, I want the sidebar to begin below the header, so that it does not cover or divide the site header.
3. As a mobile user, I want the drawer to begin below the header, so that the brand and menu control remain visible.
4. As a mobile user, I want the drawer overlay to begin below the header, so that the header remains visually and interactively distinct.
5. As a desktop user, I want the sidebar outer rectangle removed, so that navigation sits cleanly on the page canvas.
6. As a mobile user, I want the drawer panel retained, so that navigation remains separated and readable over page content.
7. As a collapsed-sidebar user, I want every navigation icon centered geometrically, so that the rail looks balanced.
8. As a collapsed-sidebar user, I want the theme and logout controls to have identical dimensions, so that the footer controls form a consistent pair.
9. As an expanded-sidebar user, I want theme and logout controls on one horizontal row, so that they use space efficiently.
10. As an expanded-sidebar user, I want dashboard icons and titles on one horizontal line, so that workspace choices are easy to scan.
11. As an expanded-sidebar user, I want long dashboard titles to remain readable without falling below their icons, so that navigation hierarchy remains clear.
12. As an expanded-sidebar user, I want disclosure chevrons placed at the opposite edge of their labels, so that expandable navigation behaves like a recognizable dropdown.
13. As an RTL user, I want icon, title, and chevron order to follow the approved Persian layout, so that navigation reads naturally.
14. As a keyboard user, I want sidebar and dropdown controls to retain semantic buttons and links, so that navigation remains accessible.
15. As a keyboard user, I want all adjusted controls to retain visible focus, so that I can identify the active element.
16. As a seller, I want “ایجاد پروژه” to match “ایجاد مشتری”, so that equivalent creation actions have one visual meaning.
17. As a seller, I want compact actions such as “افزودن ابزار” and “افزودن پرداخت” to look unmistakably clickable, so that I can discover them quickly.
18. As a touch user, I want compact actions to have at least a 44px target, so that they are comfortable to activate.
19. As a seller, I want equivalent compact actions normalized across all three contract flows, so that create, collaboration, and edit modes remain unified.
20. As a seller, I want tool and finishing result rows to have consistent internal padding, so that their labels and metadata are readable.
21. As a seller, I want result-row selection, hover, focus, and disabled states to remain clear, so that interaction state is understandable.
22. As a dark-theme user, I want customer, product, catalog, modal, selected-card, action, and navigation text to use readable semantic colors, so that no label disappears into the background.
23. As a light-theme user, I want the same semantic hierarchy to remain readable, so that dark-mode fixes do not harm the light theme.
24. As a motion-sensitive user, I want existing reduced-motion behavior preserved, so that presentation changes do not introduce discomfort.
25. As a seller, I want every existing route and return-to-step link preserved, so that linked CRM and product work continues correctly.
26. As a seller, I want every calculation, validation, permission, recovery, persistence, product-graph, and submission behavior preserved, so that this sensitive workflow remains safe.
27. As a maintainer, I want equivalent actions and navigation structures expressed through shared components, so that future work does not create another visual fork.
28. As a reviewer, I want the shared shell and contract flows verified through the existing high-level browser seam, so that correctness is measured through visible behavior.
29. As the requester, I want the existing `sabalanerp-local` Docker project rebuilt and visually inspected before any push, so that I can approve the actual local result.
30. As the requester, I want no branch pushed until I explicitly approve the final visual evidence, so that I retain the release gate.

## Implementation Decisions

- Treat the site header, desktop sidebar, and mobile drawer as one shared navigation shell; do not add Sales-specific shell forks.
- Keep the header height at 64px and make it full width on desktop and mobile.
- Position desktop navigation and the mobile drawer below the header. Position the mobile overlay below the header as well.
- Remove the square desktop sidebar layer's background, border, and shadow in collapsed and expanded states. Retain the curved, lighter navigation rail inside it, as well as the mobile drawer surface and overlay.
- Keep wizard connector lines behind opaque step-icon containers so no line crosses an icon or completed check.
- Present shared contract on/off controls as familiar 51×31px switches with a clearly different semantic track and thumb position for on versus off, while preserving their existing values and handlers.
- Keep the existing collapsed and expanded widths and existing open, close, route, active-state, permission, and disclosure behavior.
- Center collapsed navigation controls and use identical square dimensions for collapsed theme and logout controls.
- Place theme and logout controls in one horizontal row when the sidebar is expanded; keep both controls inside the sidebar.
- Render each expanded dashboard choice as a single horizontal control with icon and title grouped together and its disclosure chevron at the opposite edge.
- Preserve title truncation or wrapping only where genuinely required by available width; titles must not fall beneath their icons.
- Use the same shared creation-action presentation for “ایجاد مشتری” and “ایجاد پروژه”.
- Normalize equivalent compact collection actions in all three contract flows through a shared action presentation with a minimum 44px target, clear horizontal padding, semantic neumorphic surface, and consistent interaction states.
- Apply consistent internal padding to tool and finishing collection result rows without changing selection or filtering behavior.
- Audit shared navigation, contract steps, focused product configuration, catalog rows, dropdown results, selected cards, modal titles, and action labels for semantic text tokens in light and dark themes.
- Preserve intentional muted hierarchy; remove only accidental black or inverse-text overrides that fail against their surfaces.
- Use platform-owned ERP controls and existing semantic tokens. Do not introduce raw palette classes, native feature controls, local glass effects, or domain-specific primitives in the platform layer.
- Preserve all business rules, permissions, calculations, product-graph identity, persisted meaning, recovery, audit, API calls, route destinations, step order, focus behavior, and submission behavior except the already-approved focus transfer when opening a collection search.
- Do not add glossary terms or an ADR because this work changes reversible presentation rather than domain meaning or hard-to-reverse architecture.
- Do not push, deploy, or open a pull request before requester approval.

## Testing Decisions

- Use the existing authenticated Sales reference-surface Playwright suite as the primary high-level seam.
- Verify full-width header geometry and that desktop navigation, mobile drawer, and mobile overlay begin below the 64px header.
- Verify the desktop sidebar outer surface is transparent while the mobile drawer retains an opaque semantic surface.
- Measure collapsed icon centering and equal theme/logout dimensions.
- Verify expanded theme/logout horizontal alignment and dashboard icon/title/chevron geometry.
- Verify “ایجاد پروژه” and “ایجاد مشتری” share equivalent dimensions, padding, and alignment.
- Verify representative tool and finishing actions have at least 44px targets and their result rows have consistent padding.
- Verify representative navigation, customer, product, catalog, modal, selected-card, and action text has readable computed color in light and dark themes.
- Exercise standard creation, collaboration creation, and editing through their user-visible routes while preserving existing route and focus behavior.
- Keep contract product-graph and other behavioral suites as unchanged regression protection for calculations and persisted meaning.
- Run design-system changed-file, foundation, adoption, full reference-surface end-to-end, and production frontend build acceptance.
- Rebuild only the existing `sabalanerp-local` Compose project and capture desktop/mobile light/dark visual evidence before handoff.

## Out of Scope

- Changing contract calculations, pricing, taxes, discounts, product operations, validation, permissions, approvals, persistence, schemas, APIs, recovery, audit history, or submission behavior.
- Changing navigation destinations, access rules, active-route rules, workspace availability, disclosure state meaning, or logout/theme behavior.
- Changing existing desktop sidebar widths, the 64px header height, wizard step order, button destinations, or modal sequence.
- Removing the mobile drawer surface or overlay.
- Redesigning unrelated Sales, CRM, Inventory, HR, Accounting, Guard, or Logistics feature pages.
- Adding new data, API calls, statistics, status meaning, or explanatory content.
- Pushing, deploying, opening a pull request, or publishing application changes before requester confirmation.

## Further Notes

- This is a follow-up polish specification to the shared Sales Contract wizard redesign in #166.
- The Sabalan Design System remains the source of truth for interaction primitives and semantic tokens.
- The approved local environment is the `sabalanerp-local` Compose project sourced from `docker-compose.local.yml`.
