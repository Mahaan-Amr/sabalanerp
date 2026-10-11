---
status: accepted
---

# Make unchecked operation permissions authoritative without changing role

A permission administrator must be able to stop a specific operation for any user, including ADMIN, a company manager, or a workspace administrator, through its existing checkbox. Removing the direct grant alone restores inherited authority and therefore does not satisfy revocation.

An unchecked managed operation persists an active direct FeaturePermission with `permissionLevel: none` and no expiry. This internal off decision takes precedence over role defaults, workspace administration, system ADMIN and equivalent Partner scoped grants. Enabling the same checkbox removes the off decision and restores inheritance; a direct grant is added only if the inherited access does not supply the selected level, under existing scope and eligibility rules. No additional prohibition permission or UI control is introduced. User role and direct workspace levels are preserved when changing operation checkboxes, including selecting or deselecting all operations.

The canonical editor starts from server-effective operation permissions, permits inherited and ADMIN defaults to be unchecked, and persists only changed checkboxes in one audited transaction, preserving untouched inherited permissions and role defaults. Unchecking a prerequisite also unchecks dependent operations. History and canonical HR grant revocations remain auditable. Backend feature, narrow-operation, HR and Partner decision paths read current decisions; client role names and cached permission snapshots cannot grant a revoked operation.

This supersedes ADR-0044's unconditional administrator operation allowance. Existing business eligibility, resource scope, private Partner retail boundaries, separation and integrity gates remain in place. Operations without a matching permission are not arbitrarily linked to unrelated checkboxes. No cross-workspace duty implementation or production data is changed.

Validation covers off/on decisions for three user roles across eight workspaces, durable database decisions with transaction rollback, HR baseline and prerequisite selection, ADMIN/scoped Partner response revocation, live Accounting request denial and visual local QA. Production rollout is separate from local implementation and validation.
