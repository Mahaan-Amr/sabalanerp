# Use governed deletion and versioned reusable HR foundation codes

Authorized Human Resources administrators may permanently delete an Organizational Unit, Job, or Position after a complete impact preview and explicit resolution of every live dependency, without any implicit graph cascade. The live definition is removed, while operational and legal evidence keeps version-specific snapshots and a non-content deletion receipt; business codes are reusable through a per-entity-type monotonically increasing occurrence ledger so a later `Position 22 · Version 2` cannot be confused with the deleted `Position 22 · Version 1`.

## Consequences

Current children, Positions, assignments, supervisory relationships, Applications, Recruitment Requests, and committed future capacity must be moved, withdrawn, detached, or separately deleted before the target is eligible. Code changes use the same version ledger in the existing edit form, preserve the definition's internal identity and earlier snapshots, reject current collisions, release the prior code for its next occurrence, and require a reason plus inline impact without a separate confirmation step.

This decision supersedes only the immutable-code and no-reference hard-delete conclusions in ADR-0026 and Issue #208 for Organizational Units, Jobs, and Positions. ADR-0026's evidence-retention boundary remains authoritative: operational and legal history is detached into immutable snapshots before the live definition is removed. Workplace and Cost Center deletion and code reuse keep their previous reservation rules.
