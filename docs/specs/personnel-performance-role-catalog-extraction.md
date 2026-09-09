# Read-only Personnel coverage extraction plan

Status: reproducible plan; **not executed**  
Tracking key: `PERF-ROLE-CATALOG`  
Output classification: protected HR organizational/employment data

## Preconditions

Do not run this plan until all of the following are recorded:

1. the source is an authorized stable read-only Production snapshot or another explicitly classified source;
2. a source as-of timestamp and immutable source/snapshot identity are available;
3. a named protected-artifact custodian, restricted destination, access list, and retention classification are approved;
4. a half-open selected period `[period_from, period_to)` is agreed;
5. running the query does not disrupt another owner or mutate the shared environment.

Use one read-only, repeatable-read transaction against the authorized snapshot. Set a statement timeout. Never run migrations, create tables, write audit rows, repair history, or infer missing facts. Hash the query version and source identity in the sanitized run summary; do not expose connection material or row-level output.

## Extraction order

The root is `personnel`, not `users` and not `hr_employment_assignments`.

1. Select every Personnel, including inactive and archived rows.
2. Left-associate every Employment Relationship; retain Personnel with none.
3. Left-associate only assignments that overlap the selected period; retain relationships with none.
4. Resolve Position, Job, organizational unit, workplace, and capacity only from recorded period-effective assignment/history fields. Prefer the recorded assignment snapshots for historical meaning; never replace missing history with today’s live Position. Extract the current master catalog separately and label it current-as-of-source, never historical.
5. Left-associate period-overlapping `hr_assignment_performance_responsibilities`; retain assignments with none.
6. Resolve the responsible Supervisor through the recorded Supervisor assignment and its relationship. Never use today’s Position hierarchy as historical evidence.
7. Left-associate User separately for the subject and Supervisor. User absence does not remove the subject. Supervisor authority additionally requires current User/employment/permission checks in the canonical workflow; this extraction records facts and blockers only.
8. Join effective Job template and Position addendum versions only after the #371/#372 manifest/applicability contract is agreed. Missing versions remain blockers.
9. Join cohort, accepted result, and badge projections as separate optional facts. They never redefine the inventory denominator.

## Reference query shape

This query is a reviewable extraction shape, not an instruction to run against an unapproved database. It intentionally returns protected identifiers and therefore its output must stay in the approved restricted location.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5min';

WITH parameters AS (
  SELECT
    CAST(:period_from AS timestamptz) AS period_from,
    CAST(:period_to AS timestamptz) AS period_to
),
personnel_root AS (
  SELECT
    p.id AS personnel_id,
    p."isActive" AS personnel_is_active,
    p."archivedAt" AS personnel_archived_at,
    u.id AS subject_user_id,
    u."isActive" AS subject_user_is_active
  FROM personnel p
  LEFT JOIN users u ON u."personnelId" = p.id
),
relationship_sections AS (
  SELECT
    pr.*,
    er.id AS relationship_id,
    er.status AS relationship_status,
    er."effectiveFrom" AS relationship_from,
    er."effectiveTo" AS relationship_to,
    er."sourceSystem" AS relationship_source_system,
    er."sourceId" AS relationship_source_id
  FROM personnel_root pr
  LEFT JOIN hr_employment_relationships er ON er."personnelId" = pr.personnel_id
),
assignment_sections AS (
  SELECT
    rs.*,
    a.id AS assignment_id,
    a.type AS assignment_type,
    a."effectiveFrom" AS assignment_from,
    a."effectiveTo" AS assignment_to,
    a."positionId" AS position_id,
    a."positionSnapshot" AS position_snapshot,
    a."organizationalUnitId" AS organizational_unit_id,
    a."organizationalUnitSnapshot" AS organizational_unit_snapshot,
    a."workplaceId" AS workplace_id,
    a."costCenterId" AS cost_center_id,
    a."performanceAllocationPercent" AS performance_allocation_percent,
    a."responsibleSupervisorAssignmentId" AS legacy_supervisor_assignment_id
  FROM relationship_sections rs
  CROSS JOIN parameters x
  LEFT JOIN hr_employment_assignments a
    ON a."employmentRelationshipId" = rs.relationship_id
   AND a."effectiveFrom" < x.period_to
   AND (a."effectiveTo" IS NULL OR a."effectiveTo" > x.period_from)
),
responsibility_sections AS (
  SELECT
    a.*,
    r.id AS responsibility_id,
    r.status AS responsibility_status,
    r."effectiveFrom" AS responsibility_from,
    r."effectiveTo" AS responsibility_to,
    r."allocationPercent" AS responsibility_allocation_percent,
    r."supervisorAssignmentId" AS supervisor_assignment_id,
    ser."personnelId" AS supervisor_personnel_id,
    su.id AS supervisor_user_id,
    su."isActive" AS supervisor_user_is_active,
    sa."effectiveFrom" AS supervisor_assignment_from,
    sa."effectiveTo" AS supervisor_assignment_to,
    ser.status AS supervisor_relationship_status,
    ser."effectiveFrom" AS supervisor_relationship_from,
    ser."effectiveTo" AS supervisor_relationship_to
  FROM assignment_sections a
  CROSS JOIN parameters x
  LEFT JOIN hr_assignment_performance_responsibilities r
    ON r."employmentAssignmentId" = a.assignment_id
   AND r.status = 'ACTIVE'
   AND r."effectiveFrom" < x.period_to
   AND (r."effectiveTo" IS NULL OR r."effectiveTo" > x.period_from)
  LEFT JOIN hr_employment_assignments sa ON sa.id = r."supervisorAssignmentId"
  LEFT JOIN hr_employment_relationships ser ON ser.id = sa."employmentRelationshipId"
  LEFT JOIN users su ON su."personnelId" = ser."personnelId"
)
SELECT *
FROM responsibility_sections
ORDER BY personnel_id, relationship_from NULLS FIRST, assignment_from NULLS FIRST,
         responsibility_from NULLS FIRST, relationship_id, assignment_id, responsibility_id;

ROLLBACK;
```

The physical PostgreSQL identifiers generated by Prisma quote camel-cased field names, as shown above. Validate the query against the exact schema version without changing that schema. The approved extraction implementation should bind parameters, not interpolate them.

## Current master-data discovery

Extract current Jobs, Positions, organizational units, workplaces, and capacities separately from historical coverage. This inventory answers what exists in the authorized snapshot as of its timestamp; it cannot reconstruct what existed earlier.

```sql
SELECT
  j.id AS job_id, j.code AS job_code, j.title AS job_title,
  j.description AS job_description, j.responsibilities AS job_responsibilities,
  j."isActive" AS job_is_active
FROM hr_jobs j
ORDER BY j.code, j.id;

SELECT
  p.id AS position_id, p.code AS position_code, p.title AS position_title,
  p."jobId" AS job_id, p."organizationalUnitId" AS organizational_unit_id,
  p."workplaceId" AS workplace_id, p."costCenterId" AS cost_center_id,
  p."supervisorPositionId" AS current_supervisor_position_id,
  p.capacity, p."isActive" AS position_is_active
FROM hr_positions p
ORDER BY p.code, p.id;

SELECT
  ou.id AS organizational_unit_id, ou.code, ou.name, ou.type,
  ou."parentId" AS parent_id, ou."isActive" AS organizational_unit_is_active
FROM hr_organizational_units ou
ORDER BY ou.code, ou.id;

SELECT
  w.id AS workplace_id, w.code, w.name,
  w.description, w."isActive" AS workplace_is_active
FROM hr_workplaces w
ORDER BY w.code, w.id;
```

Current `supervisorPositionId` is structure discovery only. It is never evidence of the responsible Supervisor for a historical period. Job responsibility text is an extracted fact only when present in this authorized source; criteria, anchors, weights, evidence policies, and interpretations derived from it remain proposed until human review.

## Reconciliation queries

Within the same snapshot, calculate and store these values separately:

```sql
SELECT COUNT(*) AS personnel_count FROM personnel;
SELECT COUNT(*) AS employment_relationship_count FROM hr_employment_relationships;

SELECT COUNT(*) AS period_assignment_count
FROM hr_employment_assignments a
WHERE a."effectiveFrom" < CAST(:period_to AS timestamptz)
  AND (a."effectiveTo" IS NULL OR a."effectiveTo" > CAST(:period_from AS timestamptz));

SELECT COUNT(*) AS period_responsibility_section_count
FROM hr_assignment_performance_responsibilities r
WHERE r.status = 'ACTIVE'
  AND r."effectiveFrom" < CAST(:period_to AS timestamptz)
  AND (r."effectiveTo" IS NULL OR r."effectiveTo" > CAST(:period_from AS timestamptz));
```

Then reconcile the protected rows:

- `COUNT(DISTINCT personnel_id)` must equal `personnel_count` exactly;
- relationship rows grouped by non-null `relationship_id` must equal the relationship total;
- assignment and responsibility totals must match their period queries without inflating Personnel totals;
- zero-relationship, zero-assignment, missing-Position, missing-Job, missing-history, missing-allocation, missing-responsibility, missing-Supervisor, and no-User categories must be reported explicitly;
- duplicate/overlapping primary relationships, assignments, responsibilities, or allocations are blockers, not silently collapsed;
- re-employment relationships remain separate and are evaluated only in their recorded effective periods.

## Coverage classifications

For each Personnel, compute five independent projections:

1. `inventoryCoverage`: present in the Personnel-root output;
2. `periodEligibility`: relationship and period rules, without requiring User;
3. `structuralTemplateReadiness`: complete historical assignment/responsibility plus effective DRAFT/approved template facts as appropriate;
4. `cohortMembership`: explicit effective cohort membership only;
5. `acceptedResultAndBadge`: accepted result and separately available limited badge projection.

Suggested blocker codes include:

- `RELATIONSHIP_MISSING`, `RELATIONSHIP_PERIOD_GAP`, `RELATIONSHIP_OVERLAP`;
- `ASSIGNMENT_MISSING`, `PRIMARY_ASSIGNMENT_MISSING`, `POSITION_MISSING`, `JOB_MISSING`;
- `HISTORICAL_POSITION_CONTEXT_MISSING`, `ORGANIZATIONAL_CONTEXT_MISSING`;
- `ALLOCATION_PERCENT_MISSING`, `ALLOCATION_PERCENT_INCONSISTENT`;
- `RESPONSIBILITY_HISTORY_MISSING`, `RESPONSIBLE_SUPERVISOR_MISSING`;
- `SUPERVISOR_USER_MISSING`, `SUPERVISOR_EMPLOYMENT_INACTIVE`, `SUPERVISOR_PERMISSION_UNVERIFIED`;
- `JOB_TEMPLATE_VERSION_MISSING`, `POSITION_ADDENDUM_VERSION_MISSING`;
- `COHORT_NOT_MEMBER`, `ACCEPTED_RESULT_MISSING`, `BADGE_UNAVAILABLE`.

These codes describe different layers and must not be reduced to one readiness boolean.

## Safe outputs

The protected artifact may contain the row-level data above plus source/query hashes. Its filename and storage metadata must not contain a Personnel name or national identifier. Encrypt it at rest, restrict access, and record the custodian and approved recipients through the existing organizational controls.

The repository/GitHub-safe summary may contain only:

- source category, immutable source identity/hash, schema version, query version/hash, selected period and as-of time;
- separate sanitized totals and limitation-category counts;
- reconciliation PASS/BLOCKED status and non-identifying blocker counts;
- catalog/Job/Position/template version identities and approval states;
- protected artifact custodian role and access constraints, without the artifact path if that path is sensitive.

Do not include names, national codes, employee numbers, email addresses, User ids, Personnel ids, assignment ids, Supervisor identities, narratives, scores, or row-level combinations in Git/GitHub evidence.

## Completion gate

An extraction run may claim complete inventory coverage only when the Personnel-root reconciliation is exact. It may not claim period eligibility, structural readiness, cohort membership, accepted results, or badge availability merely because inventory coverage is 100%. Actual catalog content remains proposed until the assigned human reviewers explicitly approve immutable versions.
