---
status: accepted
---

# Authorize HR work through workspace and action permissions

Human Resources authorization uses the existing workspace and feature-permission controls rather than separately assigned HR Processor, HR Manager, Company Manager, payroll, finance, or named-responsibility roles. A grouped Persian action catalog automatically previews and includes prerequisite read permissions; workflow approvals are single shared work items for all permitted users and the first valid decision completes the item for everyone.

An active internal ADMIN or MANAGER receives the broad-manager override only with complete Human Resources workspace access. That override permits every HR action and self-approval without a manual explanation, while audit history records the actual actor, internal role, override use, self-approval state, and time; managers from unrelated workspaces receive no HR access from their internal role alone.

This supersedes ADR-0031 because simpler permission administration and operational availability were chosen over assigned-authority ownership and enforced separation of duties.
