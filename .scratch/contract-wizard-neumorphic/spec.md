## Problem Statement

The Sales Contract wizard is one of Sabalan ERP's most sensitive workflows, but its current presentation does not consistently match the minimal neumorphic language established by the Human Resources workspace and the Sales landing page. The shared wizard is used for normal contract creation, collaboration contract creation, and editing existing contracts, so styling only one route would create a visual fork and reduce future reuse. Wizard icons and connector lines are not consistently centered, navigation-button labels and arrows can stack or appear in the wrong visual order, dense legacy surfaces compete for attention, and redundant explanatory copy makes the workflow harder to scan. The Sales landing page also retains action descriptions and a section heading that repeat what its action titles already communicate. Both light and dark themes must remain readable without changing any contract behavior.

## Solution

Redesign the shared Sales Contract wizard presentation with reusable Sabalan Design System compositions and the same neutral neumorphic tokens used by Human Resources and the Sales landing page. Apply the shared presentation to normal creation, collaboration creation, and contract editing. Cover the wizard frame, all seven steps, progress navigation, action navigation, validation and recovery states, and wizard-owned modals. Keep contract-specific compositions inside the contract-creation feature while adding or extending domain-neutral ERP components only when they benefit future workflows.

Preserve every business rule, calculation, validation, permission, route, API call, stored value, recovery path, edit-session behavior, modal sequence, submission outcome, step order, skip condition, responsive reading order, and button position. Remove only copy that restates visible controls or state. Preserve guidance that prevents a likely mistake or communicates validation, recovery, pricing, calculation, permission, audit, submission, or contract-number consequences. Remove redundant action descriptions and the visible quick-access heading from the Sales landing page while retaining accessible naming.

## User Stories

1. As a seller, I want normal contract creation to use the same minimal neumorphic language as the Sales workspace, so that the experience feels unified.
2. As a seller, I want collaboration contract creation to share the same presentation, so that contract modes do not feel like separate products.
3. As a seller, I want contract editing to share the same presentation, so that creating and maintaining a contract remain visually consistent.
4. As a seller, I want all seven wizard steps preserved, so that the approved workflow does not change.
5. As a seller, I want every existing skip condition preserved, so that product and contract rules continue to select the correct path.
6. As a seller, I want existing validation preserved, so that invalid contracts cannot advance or submit.
7. As a seller, I want calculations and pricing behavior unchanged, so that the redesign cannot alter contract value.
8. As a seller, I want product-row and graph identity unchanged, so that configured products, cuts, services, tools, and remainders remain correct.
9. As a seller, I want recovery and edit-conflict behavior unchanged, so that interrupted work and concurrent edits remain safe.
10. As a seller, I want permissions and approval behavior unchanged, so that the redesign does not bypass controls.
11. As a seller, I want submission and pending-action protection unchanged, so that duplicate contracts are not created.
12. As a seller, I want the same routes and return-to-step deep links preserved, so that linked CRM and product workflows still return correctly.
13. As a seller, I want wizard-owned modals to use the same design, so that focused configuration does not fall back to a conflicting visual language.
14. As a seller, I want product configuration presentation updated without changing its controls or calculations, so that sensitive product behavior remains reliable.
15. As a seller, I want remaining-stone presentation updated without changing allocation or geometry behavior, so that material accounting remains reliable.
16. As a seller, I want payment-entry presentation updated without changing payment behavior, so that financial meaning remains intact.
17. As a seller, I want validation, error, loading, and recovery states readable in both themes, so that exceptional states remain actionable.
18. As a seller, I want ordinary wizard surfaces to be neutral, so that the active decision is easier to find.
19. As a seller, I want teal emphasis limited to active, selected, focused, and primary-action states, so that emphasis remains meaningful.
20. As a seller, I want semantic colors retained for real success, warning, danger, information, and destructive states, so that risk is not hidden by minimalism.
21. As a seller, I want decorative gradients, glass effects, arbitrary badges, and colored categories removed, so that the workflow stays restrained.
22. As a seller, I want shadows, borders, radii, spacing, and motion to match the HR and Sales neumorphic surfaces, so that the platform remains visually unified.
23. As a motion-sensitive user, I want reduced-motion preferences respected, so that transitions do not impair use.
24. As a keyboard user, I want semantic controls, logical tab order, visible focus, and preserved overlay focus behavior, so that the workflow remains operable without a pointer.
25. As a mobile seller, I want the workflow usable at 390px without overlap or hidden actions, so that contracts can be prepared on narrow screens.
26. As a zoomed user, I want the workflow usable at 200% zoom, so that content remains readable and reachable.
27. As a light-theme user, I want readable text, icons, fields, borders, and states, so that every step remains clear.
28. As a dark-theme user, I want readable text, icons, fields, borders, and states, so that every step remains clear.
29. As a seller, I want every wizard-step icon centered inside a consistent container, so that the progress rail is easy to scan.
30. As a seller, I want completed checks centered like ordinary step icons, so that step state does not shift the rail.
31. As a seller, I want progress connectors aligned through the center of step icons, so that the sequence reads as one coherent path.
32. As a seller, I want the active and completed step states distinguishable without relying only on color, so that progress remains accessible.
33. As a seller, I want the Next button to remain on the right, so that its established location does not change.
34. As a seller, I want the Previous button to remain on the left, so that its established location does not change.
35. As a seller, I want the step counter to remain centered, so that navigation retains its familiar structure.
36. As an RTL user, I want the Next label on the right with its left-pointing arrow on the left, so that forward motion reads correctly.
37. As an RTL user, I want the Previous right-pointing arrow on the right with its label on the left, so that backward motion reads correctly.
38. As a seller, I want button icons and labels centered on one horizontal line, so that controls do not look broken or stack unexpectedly.
39. As a seller, I want loading indicators to replace icons without changing button size or shifting labels, so that pending states remain stable.
40. As a seller, I want redundant helper copy removed, so that each step is faster to scan.
41. As a seller, I want field labels and required guidance preserved, so that minimalism does not make data entry ambiguous.
42. As a seller, I want validation and submission errors preserved, so that I can correct blocked work.
43. As a seller, I want recovery and edit-conflict messages preserved, so that I can make safe recovery decisions.
44. As a seller, I want pricing and calculation warnings preserved, so that I understand material and financial consequences.
45. As a seller, I want permission and audit consequences preserved, so that accountable actions remain clear.
46. As a seller, I want the probable-number warning preserved, so that I do not mistake a preview for the final server-issued contract number.
47. As a Sales workspace user, I want landing actions reduced to icon and title, so that the dashboard is more minimal.
48. As a Sales workspace user, I want the redundant visible quick-access heading removed while accessible naming remains, so that the landing page stays clean without losing structure for assistive technology.
49. As a maintainer, I want domain-neutral wizard and surface capabilities owned by the platform design system, so that future workflows can reuse them.
50. As a maintainer, I want contract labels, steps, handlers, and rules kept in the contract-creation feature, so that contract concepts do not leak into generic components.
51. As a maintainer, I want the Sales landing page to continue using shared ERP components, so that it does not become a local styling fork.
52. As a reviewer, I want external behavior tested at the shared wizard seam, so that implementation refactoring is not mistaken for correctness.
53. As a reviewer, I want existing calculation and recovery tests retained, so that presentation changes cannot silently weaken sensitive regression coverage.
54. As the requester, I want local Docker visual QA completed before any push, so that I can approve both themes and responsive states first.
55. As the requester, I want no branch pushed until I explicitly approve the final evidence, so that I retain the release gate.

## Implementation Decisions

- Apply one shared presentation to normal creation, collaboration creation, and contract editing rather than introducing route-specific styling forks.
- Cover the wizard frame, seven step surfaces, progress rail, navigation surface, validation, loading, error, recovery, edit-mode notices, product configuration, remaining-stone configuration, and payment-entry surfaces.
- Keep external CRM and product pages, generated contract output, PDFs, print templates, emails, and unrelated Sales pages outside the redesign.
- Preserve step order, labels, skip conditions, field grouping, responsive reading and tab order, button positions, modal sequence, and existing clickable or disabled progress behavior.
- Preserve all business rules, permissions, calculations, product-graph identity, persisted meaning, APIs, routes, recovery, edit-session coordination, submission, and audit behavior.
- Use a two-layer component model: platform-owned domain-neutral compositions in the Sabalan Design System, and contract-specific compositions close to the contract-creation feature.
- Prefer existing canonical ERP interfaces and extend them generically only where the accepted wizard needs a reusable capability.
- Keep the Sales landing page visually consistent with the already-approved neumorphic composition while removing redundant visible copy through its reusable action-grid interface.
- Use neutral neumorphic surfaces for ordinary hierarchy. Use the accent only for active, selected, focus, and primary-action states. Retain semantic status tones only for real meaning.
- Use existing semantic tokens for colors, borders, radii, shadows, spacing, focus, and motion. Do not introduce raw palette styling, glass presentation, decorative gradients, or local primitive replacements.
- Remove copy only when it repeats an obvious label, control, step, or visible state. Preserve guidance that prevents likely mistakes or communicates validation, recovery, permissions, audit, pricing, calculations, submission, or server-finalized identity.
- Center all icons geometrically within their containers. Keep progress icons, completed checks, and connector lines on the same visual axis.
- Keep Next on the right, Previous on the left, and the step counter centered. Within Next, place the label on the right and left-pointing arrow on the left. Within Previous, place the right-pointing arrow on the right and label on the left.
- Keep button contents in one centered horizontal row and preserve stable dimensions when loading indicators appear.
- Respect reduced motion and verify narrow-screen and zoom behavior.
- Do not add a glossary entry or ADR because the work changes no domain term or hard-to-reverse architecture.
- Do not push until local Docker visual QA is complete and the requester explicitly approves the result.

## Testing Decisions

- Extend the existing high-level Playwright contract-wizard reference-surface suite as the primary behavioral seam instead of adding component-implementation tests.
- Exercise normal creation, collaboration creation, and editing through user-visible routes and controls.
- Verify the seven-step structure, labels, navigation positions, existing enabled or disabled behavior, representative skip behavior, return-to-step navigation, modal entry and exit, recovery presentation, and submission protection without inspecting internal state.
- Verify representative simple and complex steps rather than duplicating every domain calculation in browser tests.
- Verify centered progress icons and checks, connector alignment, and RTL Next/Previous icon-label order at user-visible geometry.
- Verify redundant Sales landing and wizard copy is absent while required safety, validation, recovery, and probable-number guidance remains.
- Verify light and dark readability at representative desktop and 390px mobile widths, visible keyboard focus, no horizontal overflow, content clearance, and reduced-motion behavior.
- Keep existing focused contract calculation, product-graph, remaining-stone, pricing, submission, edit-recovery, and controller tests unchanged as regression protection.
- Run the smallest relevant focused suites plus design-system changed-file, foundation, adoption, end-to-end, and frontend production-build acceptance.
- Verify and update only the existing `sabalanerp-local` Docker Compose project before visual QA.
- Capture final light and dark desktop and mobile visual evidence before any push.

## Out of Scope

- Changing contract rules, calculations, pricing, taxes, discounts, products, cuts, remaining-stone allocation, services, tools, delivery, payments, signatures, permissions, approvals, persisted data, schemas, APIs, audit history, recovery meaning, or submission behavior.
- Reordering, adding, removing, merging, or conditionally changing wizard steps.
- Changing button locations, route destinations, return-to-step behavior, modal sequencing, or responsive reading and tab order.
- Redesigning external CRM pages, product-management pages, Sales lists or reports, generated contracts, PDFs, printing, exports, emails, or notification content.
- Adding a progress-percentage ring, invented statistics, new API calls, or new loading states.
- Pushing, opening a pull request, deploying, or publishing application changes before requester approval.

## Further Notes

- The Human Resources workspace and approved Sales landing are visual references. Contract Product Selection is also an existing design-system reference, but domain assumptions must remain inside the contract feature.
- The shared wizard is behaviorally sensitive and already carries broad focused regression coverage; presentation refactoring must preserve controller and handler identities wherever possible.
- The approved local environment is the `sabalanerp-local` Compose project sourced from `docker-compose.local.yml`.
