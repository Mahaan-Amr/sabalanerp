## Parent

#75

## What to build

Make create-mode stair configuration use one observable transaction for `افزودن این بخش` and `اتمام و افزودن به قرارداد`, with consistent validation, active-draft inclusion, atomic graph commit, draft preservation, focused errors, and privacy-safe diagnostics.

## Acceptance criteria

- [ ] `افزودن این بخش` validates and stages the visible active part, resets only that active editor after success, and keeps the modal open.
- [ ] `اتمام و افزودن به قرارداد` validates and includes the visible active draft without requiring a prior staging click.
- [ ] Empty, invalid, conflicting, or unexpected outcomes add nothing, keep the modal and every draft unchanged, and identify/focus the exact problem.
- [ ] A stable diagnostic code and structured privacy-safe context are available for every failed transaction phase.
- [ ] High-seam deterministic regression tests cover success, empty finish, invalid finish, staged-plus-active finish, and unexpected failure.

## Blocked by

None - can start immediately.
