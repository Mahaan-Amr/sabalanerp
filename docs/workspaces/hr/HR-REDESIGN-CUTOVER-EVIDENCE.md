# HR redesign Cutover evidence

Date: 2026-08-10
Ticket: [#245](https://github.com/Mahaan-Amr/sabalanerp/issues/245)

## Current decision

**TICKET CLOSURE APPROVED WITH WAIVER — production activation remains fail-closed.**

On 2026-08-10 the product owner explicitly removed the 108 legacy reconciliation reviews, the unrelated System Recovery Design System adoption debt, and the incomplete browser E2E matrix from #245's closure requirements. This waiver closes the implementation ticket without recording those checks as passes and without weakening the revision-bound production activation gate.

The supported production backend now runs the database-backed HR redesign dry-run before opening its listening port. Startup fails closed while safe backfills, actionable reconciliation conflicts, or blocking configuration/ownership failures remain. Full-access baseline authorization is limited to active `ADMIN` users; there is no named-user exception.

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

A governed follow-up retired the unsupported Hiring Manager capability, assigned the single global Company Manager compensation-proposal responsibility to active user `behpour` in `HUMAN_RESOURCES`, and permanently deleted the exact `qa_hiring_manager` test account plus its permitted QA-only sessions, browser/auth events, notifications, completed QA work item/audit, grants, and reconciliation graph. The follow-up reported 11 safe changes before apply and 0 on immediate retry. It has 0 blocking configuration failures. Current database checks report 0 matching QA users and 0 active Hiring Manager grants.

### Active blockers

Configuration and ownership blockers: none.

Record reconciliation:

| Flag | Active rows |
| --- | ---: |
| Unresolved Personnel linkage | 8 |
| Possible duplicate identity | 6 |
| Incomplete organizational mapping | 88 |
| Missing primary assignment | 88 |
| Employment-state inconsistency | 2 |
| Open start-date review | 90 |
| Assessment-plan reconciliation | 7 |

There are 127 current classified records: 108 remain Cutover blockers and 19 are clear. The blockers comprise 46 Personnel, 46 Employment Relationship, 8 User, and 8 Application records. None has a durable human review. Classification errors are zero. Flags are independent, so their counts intentionally exceed the blocked-record count.

## Compatibility and activation boundary

- Temporary `/redesign/compatibility/*` projections remain available because the integrated gates have not passed.
- Legacy `/migration/preview`, `/migration/records/:category`, and `/migration/apply` contracts remain available for rollback-safe compatibility until a later green Cutover rehearsal proves their retirement gate.
- Added `hr-redesign:cutover:verify`, which validates a release attestation, repeats the dry-run, and rejects nondeterministic output or any remaining blocker.
- Added a production startup gate that runs the same attestation and database verifier before `server.listen`.

The release attestation is bound to `HR_REDESIGN_CUTOVER_REVISION` and must mark every registered build, Design System, E2E, migration, Docker, focused behavior, authorization/privacy, visual, backlog-disposition, and recovery gate as `PASSED`. Production keeps `HR_REDESIGN_CUTOVER_ENABLED=false` while compatibility mode is required. When Cutover is deliberately enabled, it requires `HR_REDESIGN_CUTOVER_ACCEPTANCE_PATH` and `HR_REDESIGN_CUTOVER_REVISION` and rejects a missing, malformed, incomplete, failed, or different-revision attestation. No passing attestation exists for this rehearsal, so this release must remain in compatibility mode.

## Backlog disposition

- #226 is closed as the approved governing resolution.
- #236–#244 are closed with focused implementation evidence.
- #245 is closed by explicit product-owner waiver after delivery of the Company Manager workflow, permanent QA-account purge, fail-closed activation gate, and current evidence. The waived reconciliation, unrelated adoption debt, and incomplete browser E2E remain documented as non-passing evidence rather than silently rewritten as successful.
- #246 is the umbrella specification and is not independently runnable; its contradictory `ready-for-agent` label was removed and a disposition comment points remaining work to #245.
- #130 and #136 remain open and independent. This Cutover does not absorb, weaken, or close their Applicant/Personnel archival and irreversible-erasure acceptance scope.

## Acceptance command results

Passed:

- backend TypeScript build;
- frontend production build inside the verified Docker image;
- Prisma migration deploy against `sabalanerp-local`;
- `npm run docker:verify` (all images built and backend/database, frontend proxy/page, and inquiry health checks passed in 637.7 seconds);
- HR redesign data-contract, authorization, route, Cutover-gate, Personnel collection, hiring lifecycle, Applicant access/correction/assessment, duty, organization-capacity, retention, erasure, decision-version, and schedule-governance suites;
- `npm run design-system:check`;
- `npm run test:design-system-foundation` (21/21).

Not passed or not proven:

- `npm run test:design-system-adoption`: repository-wide baseline mismatch (134 hardcoded semantic colors, 11 raw-control risks, 2 duplicate-primitive risks). The changed-file gate reports no new violations.
- standalone host frontend build: blocked before compilation by a Windows `EPERM` lock on `frontend/.next-build/trace`; the Docker production build passed.
- HR hiring browser E2E: clean-database setup applies 105 migrations and seeds successfully, but the configured web-server readiness window expires before browser assertions; no E2E pass is claimed.
- 200% zoom: browser control did not provide a reliable zoom measurement.
- the authenticated eight-persona authorization/privacy/recovery matrix and full visual/E2E matrix: not proven; production data activation remains blocked by the 108 reconciliation records above.

Visual inspection of the live reconciliation screen passed Persian RTL light/dark rendering at 1280px and 390px. The document width stayed within the viewport at both sizes, and the blocked counts/drilldowns were visible and consistent with the database.

## Recovery and rollback

1. Reconcile each active flag through its registered review/action path. Do not edit classification rows directly or fabricate identity, dates, organization mappings, assignments, or assessment decisions.
2. After the release pipeline produces a passing revision-bound attestation, re-run the additive backfill and `npm --prefix backend run hr-redesign:cutover:verify -- --acceptance=<path> --source-revision=<revision>` against the target database. Safe backfills, actionable conflicts, and blocking failures must all be zero.
3. Re-run every mandatory build, Design System, E2E, migration, Docker, and visual gate before production activation.
4. If a deployment attempt fails, keep the prior application release active. The additive records remain compatible and audit-preserving; do not delete reconciliation, grant, assessment, duty, assignment, schedule, closure, or audit history to force readiness.
5. If production startup rejects the Cutover, restore the prior application release/configuration while retaining the database evidence, correct the blocker through its governed path, and rehearse again.
