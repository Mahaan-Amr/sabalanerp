---
status: accepted
---

# Authorize HR work through workspace and action permissions

Human Resources authorization uses the existing workspace and feature-permission controls rather than separately assigned HR Processor, HR Manager, Company Manager, payroll, finance, or named-responsibility roles. A grouped Persian action catalog automatically previews and includes prerequisite read permissions; workflow approvals are single shared work items for all permitted users and the first valid decision completes the item for everyone.

A base feature permission admits the user to its surface and minimum read prerequisites. An explicit action permission is the complete write authorization for that named operation and is not combined with a duplicate edit-level base-feature requirement; operations without a named action permission continue to use their feature level. The frontend renders operations from backend-effective action permissions and does not reproduce grant precedence.

Personnel and Recruitment Cases may consume a server-projected operational reference containing only the position identifier, title, active state, and—when an authorized assignment or creation action requires it—available capacity. This projection does not grant Organizational Structure, excludes organizational history, detailed occupancy, cost centers, unrelated users, and lifecycle data, and its failure does not erase an otherwise authorized primary Personnel or Recruitment Cases result.

An active internal ADMIN or MANAGER receives the broad-manager override only with complete Human Resources workspace access. That override permits every HR action and self-approval without a manual explanation, while audit history records the actual actor, internal role, override use, self-approval state, and time; managers from unrelated workspaces receive no HR access from their internal role alone.

This supersedes ADR-0031 because simpler permission administration and operational availability were chosen over assigned-authority ownership and enforced separation of duties.
