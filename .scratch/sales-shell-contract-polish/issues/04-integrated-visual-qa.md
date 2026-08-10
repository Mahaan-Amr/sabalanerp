## Parent

#172

## What to build

Verify the integrated shared shell and all three Sales Contract flows through production-equivalent local Docker, responsive browser checks, theme checks, design-system acceptance, and sensitive behavioral regressions. Produce final evidence without pushing.

## Acceptance criteria

- [ ] Desktop and 390px mobile shell geometry passes in light and dark themes.
- [ ] Collapsed and expanded navigation control geometry passes automated browser measurements.
- [ ] Standard creation, collaboration creation, and editing retain their existing behavior and readable presentation.
- [ ] Design-system foundation, adoption, changed-file, and full reference-surface browser checks pass.
- [ ] Contract product-graph behavioral tests pass without changed persisted meaning.
- [ ] The production frontend build succeeds.
- [ ] The existing `sabalanerp-local` Compose project is rebuilt and every service is healthy.
- [ ] Final desktop/mobile light/dark visual evidence is inspected before handoff.
- [ ] No branch is pushed or pull request opened before requester approval.

## Blocked by

#173 — Reframe the shared dashboard shell; #174 — Normalize shared sidebar controls and workspace navigation; #175 — Normalize Sales Contract actions, collection rows, and theme contrast.
