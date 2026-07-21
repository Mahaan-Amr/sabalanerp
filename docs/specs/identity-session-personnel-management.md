# Identity, session, and personnel management

Status: Accepted for implementation

## User provenance

- Disable public registration.
- Managed user creation captures the creating user automatically.
- Legacy users without evidence display `Unknown — Historical Data`.
- ADMIN may add a reasoned, audited historical creator assertion; automatic provenance is immutable.
- User lists show creator name and username; details also show creator ID, source, time, and attribution kind.

## Authentication sessions and evidence

- Replace browser-stored bearer tokens with authoritative server sessions referenced by Secure, HttpOnly, SameSite cookies.
- Sessions expire after 12 hours idle and 7 days absolute; activity writes are throttled.
- Deployment invalidates legacy JWTs and requires one fresh login.
- Users can list and revoke their own sessions. ADMIN can list authentication evidence and revoke sessions for any user.
- A random secure browser-profile cookie recognizes a browser without fingerprinting. New profiles notify the user in-app.
- Successful session history remains 180 days; failed authentication events remain 90 days; administrator erasure/revocation audit evidence is permanent.
- Failed attempts return a generic response and are logged separately. No throttling or automatic lockout is applied.
- Alert ADMIN after 10 failures for an identifier in 15 minutes or 25 for an IP in 15 minutes, deduplicated for one hour.
- Store IP and parsed client metadata. Approximate location is local-only and never GPS or third-party lookup.

## Password and account lifecycle

- ADMIN password reset sets a new password and revokes every session. Requiring the user to replace it at next login is an explicit, optional administrator choice and defaults to off.
- A forced-password session can only change password or log out.
- Own password change revokes other sessions; administrator reset and user deactivation revoke all sessions.
- ADMIN-only account erasure requires current administrator password, impact preview, and reason; it cannot target self or the last active ADMIN.
- Erasure removes credentials, sessions, profile and permissions, unlinks Personnel, and leaves an inert account/actor snapshot so business records remain intact.

## Personnel and bulk management

- ADMIN and MANAGER may create/edit/activate/deactivate Personnel. Only ADMIN may delete a completely unused Personnel record.
- Any operational or HR reference makes Personnel non-deletable; deactivation/archival preserves history.
- Deactivation offers a default-selected choice to deactivate the linked User; reactivation never reactivates the User automatically.
- Bulk Personnel actions: activate, deactivate, change department, apply work schedule. No bulk hard-delete.
- Bulk User actions: activate, deactivate, assign role, assign department, apply workspace permissions. No bulk password reset or erasure.
- Every bulk action uses a version-bound preview, rejects stale confirmation, applies all eligible records atomically, preserves skipped/conflicting rows, audits parent and per-row results, and returns downloadable result data.
- Personnel row actions use a clear action menu with distinct safe, warning, and destructive affordances.

## Role boundary

- ADMIN and MANAGER may perform routine non-admin User and Personnel maintenance.
- ADMIN alone controls passwords, account erasure, authentication evidence, other-user session revocation, historical creator correction, role changes, bulk permissions, and unused-Personnel deletion.
- MANAGER cannot affect ADMIN accounts.
