# Operation checkbox revocation — local QA, 2026-10-11

The existing operation checkbox now controls explicit off/on overrides for USER, MANAGER and ADMIN. Role identity and workspace levels remain unchanged. Role inheritance and the role-default editor remain available, including inherited features that have no individually configured role-default row. Untouched inherited permissions are not materialized as direct grants when the user editor is saved.

The canonical user editor reads the full server-effective matrix and sends only changed operation keys. Off persists an active, non-expiring `FeaturePermission.permissionLevel = none`; on removes this override and restores inheritance before considering a direct grant. Existing role defaults and canonical HR feature grants are preserved. Prerequisite revocation also unchecks dependent operations. Existing resource scope, Partner private retail boundaries, business eligibility and status rules still apply.

## Verified locally

- Twenty focused backend policy tests passed, including ADMIN revocation, HR baseline restrictions, Partner scoped response and route/action availability.
- Existing local database transaction test passed for off/on across eight workspaces and three roles, with role and workspace levels preserved. It also verifies ROLE_FEATURE provenance after restoration and that later role-default changes reach the user. All fixture/default changes in this test roll back.
- Live canonical HTTP setup/off/on round trips passed for USER, MANAGER and ADMIN. Each user retained all eight workspace levels. Canonical HR feature grant records and direct workspace records stayed identical through checkbox changes. No direct feature grant remained after restoring inherited access. Nine changes were audited; temporary users were removed.
- Samane's local Accounting financial operation is off. Her system role remains MANAGER and Accounting workspace remains admin. Profile projection excludes the financial-operation feature; the Partner `/enqueue` command returns 403. `/prepare` is a read/preparation operation and remains available under viewing authority.
- Visual local Accounting QA identified the signed-in account as Samane and showed the disabled invoice-draft/financial-operation control. Evidence: `tmp/qa/operation-checkbox-2026-10-11/samane-revoked-financial-operation.png`.
- Access-editor behavioral test, design-system adoption check, foundation (25 tests), adoption (14 tests), database-client architecture check and frontend production build passed.

Backend and frontend are rebuilt in the existing `sabalanerp-local` project. Comprehensive `docker:verify` cannot finish because the pre-existing ClamAV container is unhealthy; backend/frontend health checks pass through targeted rebuilds. No ClamAV changes were made.

This is bounded local evidence, not verification of every individual workflow endpoint or a production release. No server deployment, production data change, push, or cross-workspace-duty implementation change is included.
