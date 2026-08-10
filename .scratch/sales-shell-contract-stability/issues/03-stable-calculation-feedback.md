## Parent

#177

## What to build

Keep the latest valid Product Selection calculation summary visible while the existing worker recalculates, then update values in place without a skeleton flash or structural movement.

## Acceptance criteria

- [ ] An established calculation summary remains mounted while a newer calculation is pending.
- [ ] The summary exposes an accessible busy state during recalculation.
- [ ] Skeleton rows appear only while an initial result is unavailable.
- [ ] The latest successful worker result replaces the displayed values in place.
- [ ] Existing error meaning and recovery remain visible when the latest calculation fails.
- [ ] Worker inputs, formulas, sequencing, validation, product graph identity, persisted values, and submission behavior remain unchanged.
- [ ] Browser-level acceptance exercises input and switch changes and observes stable summary presentation.
- [ ] Existing contract-product behavioral tests remain green.

## Blocked by

None — can start immediately.
