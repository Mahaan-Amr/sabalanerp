# Preserve business history during user account erasure

Status: Accepted

## Context

Sabalan ERP users may leave the organization and require permanent account removal. The User record is also referenced as creator, operator, seller, approver, and audit actor throughout operational data. Several existing relations cascade on User deletion, so physically deleting a User without redesign could erase contracts, missions, CRM activity, reports, or other business evidence. Simple deactivation preserves too much authentication and personal account state to satisfy permanent removal.

## Decision

Implement User Account Erasure as an ADMIN-only irreversible workflow. Erasure permanently removes credentials, sessions, personal profile data, and permissions and unlinks the preserved Personnel identity. Business and audit records remain intact and retain attribution through an inert snapshot containing the former user ID, display name, and deletion timestamp, rendered as `Deleted user — [name]`.

An erased account cannot be reactivated. A returning person receives a new User identity. The workflow requires administrator password confirmation, an impact preview, a mandatory reason, and an audit event. An administrator cannot erase their own account or the final active administrator.

## Consequences

- Operational and statutory history survives account erasure.
- Authentication secrets and live access state do not survive erasure.
- User-referencing relations that currently cascade business deletion must be migrated to safe historical attribution behavior.
- Historical snapshots intentionally retain a minimal name and former identifier for accountability.
- Rejoining users do not regain the erased account's identity or sessions.

## Alternatives considered

- Directly delete the User row under current foreign keys: rejected because it can cascade-delete business records or fail on restrictive audit relations.
- Deactivate the User only: rejected because it is reversible and retains credentials and account data.
- Remove all attribution: rejected because it damages auditability and makes historical records misleading.
