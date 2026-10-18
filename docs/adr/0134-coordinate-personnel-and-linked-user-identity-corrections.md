---
status: accepted
---

# Coordinate Personnel and linked User identity corrections

Human Resources remains the canonical Personnel writer under ADR-0021. Corrections to a Personnel record's first and last names must also update the names of its linked User, when present, so account-linked and accountless workers have consistent current identities across HR and Guard. The existing effective Personnel EDIT permission is the agreed entry permission; this correction must not change login identifiers, credentials, roles, account status, or employment relationships.

The user also confirmed editing National Code and Employee Number without requiring a correction reason. An existing National Code or Employee Number cannot be cleared. Historical operational identity snapshots and submitted recruitment identity claims remain unchanged, consistent with ADR-0049; current identity corrections must not rewrite historical evidence.

Name coordination is bidirectional: an authorized name correction originating from User management must also update the linked Personnel. Each entry point retains its existing permissions. Save both names atomically, record the actual before/after values, actor and time automatically, and expose correction history only to authorized users without requesting a reason. Reject a stale edit rather than silently overwriting a newer correction, and allow the editor to review the latest values.

This chooses coordinated current names over independently editable, potentially divergent Personnel and User names, while retaining distinct account access and employment identities. The user confirmed the completed design for local implementation and validation on 2026-10-18; production changes require separate authorization.
