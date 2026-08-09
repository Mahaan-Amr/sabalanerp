# HR redesign Cutover evidence

Date: 2026-08-09
Ticket: [#245](https://github.com/Mahaan-Amr/sabalanerp/issues/245)

## Current decision

**BLOCKED — do not activate the HR redesign in production.**

The supported production backend now runs the database-backed HR redesign dry-run before opening its listening port. Startup fails closed while safe backfills, actionable reconciliation conflicts, or blocking configuration/ownership failures remain. `HR_SHAKILA_USER_ID` is also a required production setting.

## Local rehearsal

The rehearsal used the existing `sabalanerp-local` Compose project. No second database or Compose project was created.

### Additive backfill counts

| Category | Before apply | Immediate retry 1 | Immediate retry 2 |
| --- | ---: | ---: | ---: |
| Safe backfills | 580 | 0 | 0 |
| Actionable conflicts | 109 | 109 | 109 |
| Neutral legacy outcomes | 10 | 10 | 10 |
| Blocking failures | 3 | 3 | 3 |

Both post-apply dry-runs returned identical results. This proves the additive write set reached an idempotent fixed point without clearing unresolved business blockers.

### Active blockers

Configuration and ownership:

- `MISSING_SHAKILA_STABLE_USER_ID`: 1. The local database has no Shakila Marzban User, so a stable identity cannot be inferred safely.
- `HIRING_MANAGER_OPERATIONAL_WORKSPACE_UNRESOLVED`: 1.
- `HIRING_MANAGER_POSITION_ASSIGNMENT_UNRESOLVED`: 1.

Record reconciliation:

| Flag | Active rows |
| --- | ---: |
| Unresolved Personnel linkage | 9 |
| Possible duplicate identity | 6 |
| Incomplete organizational mapping | 88 |
| Missing primary assignment | 88 |
| Employment-state inconsistency | 2 |
| Open start-date review | 90 |
| Assessment-plan reconciliation | 7 |

There are 128 classified records: 109 remain Cutover blockers and 19 are clear. Classification errors are zero. Flags are independent, so their counts intentionally exceed the blocked-record count.

## Compatibility and activation boundary

- Temporary `/redesign/compatibility/*` projections remain available because the integrated gates have not passed.
- Legacy `/migration/preview`, `/migration/records/:category`, and `/migration/apply` contracts remain available for rollback-safe compatibility until a later green Cutover rehearsal proves their retirement gate.
- Added `hr-redesign:cutover:verify`, which validates a release attestation, repeats the dry-run, and rejects nondeterministic output or any remaining blocker.
- Added a production startup gate that runs the same attestation and database verifier before `server.listen`.

The release attestation is bound to `HR_REDESIGN_CUTOVER_REVISION` and must mark every registered build, Design System, E2E, migration, Docker, focused behavior, authorization/privacy, visual, backlog-disposition, and recovery gate as `PASSED`. Production also requires `HR_REDESIGN_CUTOVER_ACCEPTANCE_PATH` and rejects a missing, malformed, incomplete, failed, or different-revision attestation. No passing attestation exists for this rehearsal.

## Backlog disposition

- #226 is closed as the approved governing resolution.
- #236–#244 are closed with focused implementation evidence.
- #245 remains open with `needs-info` and is blocked by this evidence; its progress/disposition comment records the live counts.
- #246 is the umbrella specification and is not independently runnable; its contradictory `ready-for-agent` label was removed and a disposition comment points remaining work to #245.
- #130 and #136 remain open and independent. This Cutover does not absorb, weaken, or close their Applicant/Personnel archival and irreversible-erasure acceptance scope.

## Acceptance command results

Passed:

- backend TypeScript build;
- HR redesign data-contract, authorization, route, Cutover-gate, Personnel collection, hiring lifecycle, Applicant access/correction/assessment, duty, organization-capacity, retention, erasure, decision-version, and schedule-governance suites;
- `npm run design-system:check`;
- `npm run test:design-system-foundation` (21/21).

Not passed or not proven:

- `npm run test:design-system-adoption`: repository-wide baseline mismatch (134 hardcoded semantic colors, 11 raw-control risks, 2 duplicate-primitive risks). The changed-file gate reports no new violations.
- frontend production build: exceeded the five-minute command limit without returning a result.
- Docker verification and migration-deploy commands: exceeded their command limits without returning a result; service health remained reported as healthy by Compose.
- 200% zoom: browser control did not provide a reliable zoom measurement.
- production identity/ownership verification and full visual/E2E matrix: blocked by the active Cutover data above.

Visual inspection of the live reconciliation screen passed Persian RTL light/dark rendering at 1280px and 390px. The document width stayed within the viewport at both sizes, and the blocked counts/drilldowns were visible and consistent with the database.

## Recovery and rollback

1. Do not set or deploy a guessed `HR_SHAKILA_USER_ID`; obtain the authoritative stable User ID.
2. Resolve the Hiring Manager operational workspace and Position assignment through the governed responsibility interfaces.
3. Reconcile each active flag through its registered review/action path. Do not edit classification rows directly or fabricate identity, dates, organization mappings, assignments, or assessment decisions.
4. After the release pipeline produces a passing revision-bound attestation, re-run the additive backfill and `npm --prefix backend run hr-redesign:cutover:verify -- --acceptance=<path> --source-revision=<revision>` against the target database. Safe backfills, actionable conflicts, and blocking failures must all be zero.
5. Re-run every mandatory build, Design System, E2E, migration, Docker, and visual gate before production activation.
6. If a deployment attempt fails, keep the prior application release active. The additive records remain compatible and audit-preserving; do not delete reconciliation, grant, assessment, duty, assignment, schedule, closure, or audit history to force readiness.
7. If production startup rejects the Cutover, restore the prior application release/configuration while retaining the database evidence, correct the blocker through its governed path, and rehearse again.
