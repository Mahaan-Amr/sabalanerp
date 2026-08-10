## Parent

#172

## What to build

Reframe the shared dashboard shell so the full-width 64px header owns the top edge on desktop and mobile. Place desktop navigation, the mobile drawer, and its overlay below the header. Remove the outer desktop sidebar surface while retaining the mobile drawer panel and all existing navigation behavior.

## Acceptance criteria

- [ ] The header spans the full viewport at desktop and mobile widths.
- [ ] Desktop navigation begins immediately below the 64px header and does not cover it.
- [ ] The mobile drawer and overlay begin below the header while leaving the brand and hamburger visible.
- [ ] The desktop sidebar has no outer background, border, or shadow in collapsed or expanded states.
- [ ] The mobile drawer retains an opaque semantic surface and overlay.
- [ ] Existing widths, open/close behavior, routing, active-state behavior, and permissions remain unchanged.
- [ ] High-level browser coverage verifies desktop and mobile shell geometry.

## Blocked by

None — can start immediately.
