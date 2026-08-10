## Problem Statement

The shared Sales navigation shell and Contract Creation presentation still contain visible inconsistencies after the neumorphic redesign. Wizard connector lines can paint over step controls, collapsed sidebar icons are not consistently centered, footer controls differ in size, the expanded sidebar is split into visually different surface bands, and dark-mode hover states can reduce text contrast. In Product Selection, every calculation request clears the visible summary and replaces it with skeleton rows, making ordinary input and switch changes look like a modal reload.

These defects make the interface feel unstable and weaken visual unity even though the underlying Sales and Contract Creation behavior remains correct and sensitive. The corrections must not alter calculations, validation, permissions, recovery, persisted product-graph meaning, navigation, or submission behavior.

## Solution

Polish the shared Sabalan Design System presentation components used by the Sales shell and all Contract Creation modes.

The wizard progress connector will always render beneath opaque step controls. The sidebar will retain its curved neumorphic rail while removing the surrounding rectangular layer, use one continuous surface from its top control through its footer, sit eight pixels below the full-width header, center collapsed navigation icons, and give theme and logout controls identical dimensions. Expanded navigation hover states will preserve readable semantic text contrast in dark and light themes.

Product calculation summaries will preserve the last valid result while the existing calculation worker recomputes, expose an accessible busy state, and replace values in place when the new result arrives. Skeleton rows will remain appropriate only before an initial result exists. The worker, formulas, validation, sequencing, error handling, and committed contract values remain unchanged.

The existing edit-session recovery alert will also present “ادامه ویرایش در اینجا” as the clearly filled primary action and “ایجاد قرارداد جدید” as the secondary outlined action, without changing takeover, recovery, or routing behavior.

## User Stories

1. As a Sales user creating a contract, I want connector lines to remain behind every wizard step control, so that completed and active steps remain visually distinct.
2. As a Sales user moving between contract steps, I want the progress indicator to preserve the same layering after state changes, so that the interface does not visually regress once a step is completed.
3. As a user of the collapsed dashboard sidebar, I want every navigation icon centered within its control, so that the rail looks balanced and intentional.
4. As a user of the collapsed dashboard sidebar, I want theme and logout controls to have identical height and width, so that the footer has a consistent rhythm.
5. As a user of the expanded dashboard sidebar, I want one continuous curved surface from the top control through the footer, so that the menu reads as one component.
6. As a user of either sidebar state, I want a small gap below the site header, so that the header and menu do not visually collide.
7. As a user of the Sales workspace, I want the full-width header to remain independent from the sidebar, so that workspace identity is not obscured by navigation.
8. As a dark-mode user, I want inactive and hover navigation text to remain light and readable, so that exploring nearby destinations never hides their labels.
9. As a light-mode user, I want the same sidebar hierarchy and interaction clarity, so that theme changes do not alter meaning or usability.
10. As a user configuring a contract product, I want the current calculation summary to remain visible while a new calculation runs, so that typing does not resemble a page reload.
11. As a user toggling product options, I want summary values to update in place without skeleton flashes or layout movement, so that the effect of my choice is easy to follow.
12. As a keyboard or assistive-technology user, I want recalculation to retain an accessible busy indication, so that asynchronous work is communicated without destroying current context.
13. As a user opening a product calculation for the first time, I want an appropriate loading state until the first result exists, so that an empty summary is not mistaken for a completed calculation.
14. As a user encountering a calculation error, I want the existing error meaning and recovery behavior preserved, so that visual smoothing does not conceal invalid data.
15. As a user creating a standard contract, I want these shared corrections throughout the workflow without any change to my contract data.
16. As a user creating a collaboration contract, I want the same shared corrections without changing collaboration-specific steps or rules.
17. As a user editing a contract, I want the same shared corrections without changing restored values, permissions, or save behavior.
18. As a company stakeholder, I want visual corrections verified in the existing local Docker environment before any push, so that sensitive contract behavior is protected.
19. As a user whose contract is being edited elsewhere, I want “ادامه ویرایش در اینجا” to look unmistakably like the primary button, so that I can identify the intended recovery action immediately.
20. As the same user, I want “ایجاد قرارداد جدید” to remain visibly secondary, so that starting over is not confused with continuing the current contract.

## Implementation Decisions

- Use the platform-owned Sabalan Design System and deepen shared shell, workflow-progress, and product-summary presentation components rather than introducing feature-local visual forks.
- Keep the sidebar's curved rail and remove only the surrounding rectangular background layer.
- Use one semantic surface across the complete curved sidebar rail, including navigation and footer regions.
- Place the desktop and mobile sidebar eight pixels below the full-width header while preserving its existing responsive placement and navigation behavior.
- Give every collapsed navigation and footer action a common centered control geometry; theme and logout actions use identical dimensions.
- Preserve expanded footer layout and existing action semantics while normalizing its surface and sizing.
- Use semantic foreground and hover tokens so dark-mode hover never changes navigation text to an unreadable dark value.
- Render workflow connectors in a lower visual layer than every step control for completed, active, and future states. Step position, order, clickability, and state meaning remain unchanged.
- During recalculation, retain the last valid calculation in presentation state and mark the summary busy. Replace displayed values only when the latest worker result arrives.
- Show reserved skeleton rows only when no prior calculation result exists. Preserve current error presentation when the latest calculation fails.
- Do not change worker inputs, calculation formulas, request sequencing, validation, product graph identity, persisted data, permissions, recovery, navigation destinations, or submission behavior.
- Apply corrections through shared components so standard creation, collaboration creation, and contract editing remain visually unified.
- Give the edit-session takeover action a filled primary semantic treatment and retain the fresh-contract action as an outlined secondary treatment; preserve their callbacks, pending state, and recovery policy.
- Do not push or publish code changes before local Docker tests and visual QA are complete and the user approves the result.

## Testing Decisions

- Use the existing browser-level Sabalan Design System acceptance suite as the primary and highest test seam. Tests assert externally visible geometry, layering, contrast, continuity, stability, and accessibility rather than internal class names or state implementation.
- Extend the shared Sales shell acceptance coverage for the eight-pixel header gap, transparent outer sidebar layer, continuous curved rail surface, centered collapsed icons, equal footer-control dimensions, expanded layout, and dark/light hover contrast.
- Extend Contract Creation acceptance coverage so connector lines are visually behind completed, active, and future step controls after navigation.
- Exercise the Product Selection calculation summary through real input and switch interactions, asserting that an established summary remains mounted without skeleton replacement while recalculation is busy and updates when the latest result arrives.
- Verify that the edit-session recovery alert exposes a visibly filled primary takeover action and a secondary outlined fresh-contract action while retaining their accessible labels and existing behavior.
- Exercise the shared presentation through standard creation, collaboration creation, and contract edit entry points where existing acceptance fixtures already provide coverage.
- Run the existing contract-product graph behavioral suite unchanged to prove that formulas, identity, and persisted meaning remain stable.
- Run the required Design System checks, foundation tests, adoption tests, frontend build, and browser acceptance suite.
- Perform local Docker visual QA at desktop and mobile widths in both dark and light themes before requesting user approval.

## Out of Scope

- Any change to Sales metrics, APIs, database schema, contract calculations, pricing, validation, permissions, recovery, audit history, product graph identity, submission, or navigation destinations.
- Redesigning Sales contract list, product catalog, reports, customer records, or unrelated workspaces.
- Changing wizard step order, availability, completion rules, or navigation position.
- Replacing or restructuring the calculation worker.
- Changing edit-session ownership, takeover, recovery, pending-state, or fresh-contract routing behavior.
- Adding new statistics, explanatory copy, guidance, or API calls.
- Pushing a branch, opening a pull request, or deploying beyond the existing local Docker environment.

## Further Notes

- The accepted visual direction is minimal, neutral neumorphism consistent with the HR workspace and the redesigned Sales landing page.
- Both themes must remain legible, and responsive behavior must remain usable at the Design System's required narrow width and zoom targets.
- No domain glossary or ADR update is needed: these are reversible presentation corrections and do not redefine a business concept or durable architectural trade-off.
