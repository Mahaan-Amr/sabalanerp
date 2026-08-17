# HR duty engine Phase 0 baseline

Status: Verified  
Captured: 2026-08-16T10:54:25.730Z  
Issue: https://github.com/Mahaan-Amr/sabalanerp/issues/286

## Scope

This is the read-only baseline captured before any project-wide Cross-Workspace Duty schema migration, generic source Adapter, new writer, frontend rename, or navigation badge implementation.

Approved test seams:

1. existing backend duty creation, response, assignment reconciliation, and deadline-maintenance interface;
2. authenticated destination summary, list, detail, and response HTTP routes;
3. the read-only machine-readable baseline command.

## Command

The local command targets the existing `sabalanerp-local` PostgreSQL service through its published loopback port and creates no additional Compose project or database service:

```text
npm run --silent duty:baseline
```

The Backend command for an environment that already supplies `DATABASE_URL` is:

```text
npm --prefix backend run --silent duty:baseline
```

Exit codes:

- `0`: report completed and found no integrity violations;
- `1`: report completed and found one or more integrity violations;
- `2`: report could not be produced.

## Captured result

```json
{
  "generatedAt": "2026-08-16T10:54:25.730Z",
  "ok": true,
  "counts": {
    "envelopes": 6,
    "sourceWorkItems": 28,
    "duties": 1,
    "openDuties": 0,
    "assignmentHistory": 1,
    "activeAssignments": 0,
    "auditVersions": 2,
    "notificationIdentities": 7
  },
  "findings": []
}
```

Interpretation:

- the one current Duty is terminal; no open or actively assigned Duty exists;
- all current Duty rows resolve to an existing `HR_WORK_ITEM` source;
- no open Duty has stale source version, inactive Envelope, missing/mismatched active Assignment, or missing Audit;
- Audit versions are contiguous;
- no current Duty uses an unregistered non-HR source Adapter.

## Database-enforced duplicate and orphan guards

The existing Prisma schema prevents duplicate or relationally orphaned rows through:

- unique Duty `stableKey`;
- unique `(sourceType, sourceId, sourceActionCode, sourceVersion)`;
- unique Envelope `(code, version)`;
- unique Assignment `(dutyId, sequence)`;
- unique Audit `(dutyId, version)`;
- unique notification `stableKey` and `(dutyId, dutyAuditVersion, recipientUserId, channelCode)`;
- restrictive Duty-to-Envelope, Assignment-to-Duty, Audit-to-Duty, and Notification-to-Duty/Audit foreign keys.

The report supplements these database guards with source-existence, open-source-version, open-Envelope, active-Assignment, Audit-presence, Audit-contiguity, and registered-source-type checks that foreign keys cannot express.

## Verification evidence

- `npm --prefix backend run test:hr-duty-baseline`: 8/8 passed.
- `npm --prefix backend run test:hr-duty-engine`: policy, notification authorization, route, integration, and competing-transaction checks passed.
- `npm run build:backend`: passed.
- `npm run architecture:check`: passed.
- `git diff --check`: passed.

## Phase 1 boundary

This baseline does not authorize implementation of the generic engine. Phase 1 must preserve these counts and identities, keep the physical `hr_duty_*` tables during logical model promotion, introduce the HR Work Item Adapter first, and prove exact reconciliation before enabling any non-HR source writer.
