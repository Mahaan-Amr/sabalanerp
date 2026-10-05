# Personnel organizational-unit tabs — 2026-10-05

Approved placement: the seven-badge banner sits above the list section. Beneath it, desktop shows the labeled search field on the right and unit tabs on the left with aligned control bottoms; mobile stacks search above tabs. The canonical segmented control scrolls horizontally at every viewport width. The layout follows the user reference while preserving the previously approved left-to-right badge order and Roman numerals.

Units come from actual current employment assignments, not legacy account departments or a fixed list. A person with simultaneous assignments appears in each matching unit; the all-units collection contains each person once, including unassigned people. Only units with matching personnel in the authorized active/archive population appear. Search does not hide the other unit choices.

Current means both assignment and employment relationship have started, neither has ended, and the relationship is ACTIVE or SUSPENDED. All assignment types participate. Future, ended, cancelled and planned relationships remain accessible in personnel records but do not determine current-unit tabs. A unit with a still-current assignment remains visible even if its definition has since been disabled.

The UI requests `unitAssignmentScope=current`; older structural-filter callers retain their existing dependency-date semantics. Unit filtering precedes search, focus resolution and pagination. Unit selection uses the existing URL state, resets pagination and closes the focused record while preserving vertical scroll. Desktop tabs take their natural content width, with search yielding available space before horizontal scrolling becomes necessary. The endpoint exposes only unit IDs and names, not personnel membership sets. Existing permissions and records are unchanged.

## Verification

Current-unit grouping/collection tests, database-client ownership, design-system check, foundation (25), adoption (14), frontend and backend builds passed. Two focused browser tests passed on the existing local stack: 24-unit horizontal overflow containment at desktop/mobile widths, URL persistence and page reset, and read-only actual-local assignment membership. No personnel records were changed.

The 1218px regression verifies four long unit labels fit without scrolling, and tab switching preserves vertical position without a document navigation. The 24-unit desktop/mobile overflow and actual-local membership checks also passed.
