## Parent

#75

## What to build

Make stair edit load and atomically save the exact stable parent-and-layer graph, with one edit action and complete visible hydration for one or many independently identified layer configurations.

## Acceptance criteria

- [ ] Edit mode exposes only `ذخیره تغییرات` and saves currently visible values without create-mode staging.
- [ ] One attached layer opens directly with its complete saved settings.
- [ ] With several layers, the first opens initially and every layer remains visibly selectable without collection removal, reorder, or identity change.
- [ ] Parent and layer discovery uses stable row identity; array position cannot override a contradictory stable relation.
- [ ] An unambiguous historical graph is adapted in memory and migrated only on explicit save; ambiguity blocks with an actionable conflict.
- [ ] Regression tests cover single-layer, multi-layer, reordered rows, duplicate catalog identity, legacy-unambiguous, and legacy-ambiguous cases.

## Blocked by

#76
