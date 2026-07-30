# Global shell and HR workspace refinement

## Approved scope

- End Guard attendance-roster membership on the Personnel archive effective date. Preserve earlier attendance history. Restoration does not restore roster membership. Permanent erasure continues through the relation-aware erasure graph.
- Personnel search is Persian-normalized, token-based, debounced by 400 ms, Enter/search-button immediate, and does not replace the page while typing.
- Replace the global dashboard navigation with the approved neumorphic compact desktop rail and a matching mobile drawer. Preserve workspace/feature permissions, route ordering, workspace switching, theme control, logout, keyboard behavior, and stable overlays.
- Redesign `/dashboard/hr/hiring`, its detail/authority/collateral routes, `/dashboard/hr/personnel`, `/dashboard/hr/structure`, `/dashboard/hr/structure/positions`, and `/dashboard/hr/migration` with reusable Sabalan Design System compositions.
- Freeze the content and responsive composition of `/dashboard/hr`; only the global shell may change around it. Do not change `/apply`.

## Presentation contract

- Match the supplied reference in both themes: restrained raised/inset shadows, compact rail, rounded controls, clear active states, semantic contrast, and minimal copy.
- Use progressive disclosure: operational state and primary action first; advanced controls in sheets or expandable layers.
- Dense data remains a semantic table on desktop and becomes touch-friendly cards on mobile.
- Preserve every business rule, permission, validation, calculation, persisted meaning, audit event, recovery path, and route destination.
- Preserve the current workspace-specific rail routes and permission logic while matching the supplied compact neumorphic reference through consistent icon boxes, label alignment, spacing, active states, and footer controls.
- Keep the company logo in the persistent site header rather than the navigation rail. Closed desktop rail items are icon-only; the mobile drawer always retains full labels and workspace context. Theme and logout controls share one centered control footprint.
- Completed hiring lifecycle stages remain visibly green in light and dark themes, and every lifecycle stage card has an equal height.
- Each migration metric navigates to a dedicated, stable matching-records route rather than filtering the preview in place.
- Migration execution uses a centered responsive dialog with an internally scrolling body and blurred overlay. Escape, outside click, and close controls are disabled while execution is running.
- Hiring-authority assignment uses the same centered, blurred, internally scrolling, busy-state-protected dialog contract as migration execution.

## Acceptance

- Archived Personnel is absent from attendance on/after the effective date and remains visible in earlier historical reports.
- Full-name queries match across first/last-name fields without per-keystroke page replacement.
- Desktop rail and mobile drawer remain readable and operable in light/dark modes and at 390 px.
- All approved HR routes use the shared layered presentation; the HR landing content is unchanged.
- Migration metric totals reconcile with their dedicated record pages, and the centered execution dialog remains readable and protected on desktop and mobile.
- Behavioral tests, design-system checks, frontend/backend builds, existing `sabalanerp-local` Docker health, and visual QA pass before requesting permission to push.

## Tracker status

GitHub publication is pending because the configured `gh` token is invalid in this environment.
