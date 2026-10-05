# Personnel organizational-unit tabs — 2026-10-05

Approved placement: beneath the seven-badge banner and above personnel cards. The canonical segmented control scrolls horizontally at every viewport width.

Units come from actual current employment assignments, not legacy account departments or a fixed list. A person with simultaneous assignments appears in each matching unit; the all-units collection contains each person once, including unassigned people. Only units with matching personnel in the authorized active/archive population appear. Search does not hide the other unit choices.

Current means both assignment and employment relationship have started, neither has ended, and the relationship is ACTIVE or SUSPENDED. All assignment types participate. Future, ended, cancelled and planned relationships remain accessible in personnel records but do not determine current-unit tabs. A unit with a still-current assignment remains visible even if its definition has since been disabled.

The UI requests `unitAssignmentScope=current`; older structural-filter callers retain their existing dependency-date semantics. Unit filtering precedes search, focus resolution and pagination. Unit selection uses the existing URL state, resets pagination and closes the focused record. The endpoint exposes only unit IDs and names, not personnel membership sets. Existing permissions and records are unchanged.
