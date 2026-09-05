import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { persistPerformancePayload, readPerformancePayload, performanceVaultKeyFromEnvironment, type PerformanceVaultKey } from './personnelPerformancePayloadStore';

type Scope = { aggregateType: string; aggregateIdHash: string };
const hashId = (id: string) => createHash('sha256').update(id).digest('hex');
const dependencyHash = (scopes: Scope[]) => hashId(scopes.map(({ aggregateType, aggregateIdHash }) => `${aggregateType}:${aggregateIdHash}`).sort().join('\n'));
const unavailable = () => Object.assign(new Error('وابستگی منابع خروجی قابل تأیید نیست؛ شواهد تا بررسی نگهداری می‌شود.'), { code: 'PERFORMANCE_EXPORT_LINEAGE_UNVERIFIED', status: 409 });

// The reporting population includes exclusions and denominator-only subjects, not only displayed rows.
// Capture within the same transaction/snapshot as the report; never reconstruct old exports from today's graph.
export const capturePerformanceExportSources = async (tx: Prisma.TransactionClient, subjectIds: string[], from: Date, to: Date) => {
  const sources: Array<{ aggregateType: string; id: string; record: unknown }> = [];
  const add = <T extends { id: string }>(aggregateType: string, records: T[]) => {
    sources.push(...records.map((record) => ({ aggregateType, id: record.id, record })));
    return records;
  };
  const subjects = add('PERFORMANCE_SUBJECT', await tx.performanceSubject.findMany({ where: { id: { in: subjectIds } } }));
  const evaluations = add('EVALUATION', await tx.performanceEvaluation.findMany({ where: { subjectId: { in: subjectIds }, measurementTo: { gte: from, lt: to } } }));
  const evaluationIds = evaluations.map(({ id }) => id);
  const sections = add('EVALUATION_SECTION', await tx.performanceEvaluationSection.findMany({ where: { evaluationId: { in: evaluationIds } } }));
  const sectionIds = sections.map(({ id }) => id);
  add('PERFORMANCE_DRAFT', await tx.performanceDraft.findMany({ where: { sectionId: { in: sectionIds } } }));
  const submissions = add('PERFORMANCE_SUBMISSION', await tx.performanceSubmission.findMany({ where: { sectionId: { in: sectionIds } } }));
  add('PERFORMANCE_REVIEW', await tx.performanceReview.findMany({ where: { submissionId: { in: submissions.map(({ id }) => id) } } }));
  const results = add('ACCEPTED_RESULT', await tx.performanceAcceptedResult.findMany({ where: { evaluationId: { in: evaluationIds } } }));
  add('CALCULATION_TRACE', await tx.performanceCalculationTrace.findMany({ where: { evaluationId: { in: evaluationIds } } }));
  const snapshots = add('PERFORMANCE_SNAPSHOT', await tx.performanceSnapshot.findMany({ where: { evaluationId: { in: evaluationIds } } }));
  add('PERFORMANCE_CORRECTION', await tx.performanceCorrection.findMany({ where: { evaluationId: { in: evaluationIds } } }));
  add('PERFORMANCE_EVIDENCE_RESTRICTION', await tx.performanceEvidenceRestriction.findMany({ where: { evaluationId: { in: evaluationIds } } }));
  const privacyScopes = add('PERFORMANCE_PRIVACY_SCOPE', await tx.performancePrivacyScope.findMany({ where: { evaluationId: { in: evaluationIds } } }));
  add('PERFORMANCE_PRIVACY_CASE', await tx.performancePrivacyCase.findMany({ where: { id: { in: privacyScopes.map(({ caseId }) => caseId) } } }));
  const bindings = add('PERFORMANCE_ARTIFACT_BINDING', await tx.performanceArtifactSnapshotBinding.findMany({ where: { snapshotId: { in: snapshots.map(({ id }) => id) } } }));
  const ids = (values: Array<string | null>) => [...new Set(values.filter((id): id is string => Boolean(id)))];
  add('POLICY_VERSION', await tx.performancePolicyVersion.findMany({ where: { id: { in: ids([...bindings.map(({ policyVersionId }) => policyVersionId), ...results.map(({ levelPolicyVersionId }) => levelPolicyVersionId)]) } } }));
  add('CRITERION_VERSION', await tx.performanceCriterionVersion.findMany({ where: { id: { in: ids(bindings.map(({ criterionVersionId }) => criterionVersionId)) } } }));
  add('TEMPLATE_VERSION', await tx.performanceTemplateVersion.findMany({ where: { id: { in: ids(bindings.map(({ templateVersionId }) => templateVersionId)) } } }));
  add('EMPLOYMENT_RELATIONSHIP', await tx.hrEmploymentRelationship.findMany({ where: { id: { in: ids(subjects.map(({ employmentRelationshipId }) => employmentRelationshipId)) } }, select: { id: true, personnelId: true, effectiveFrom: true, effectiveTo: true, status: true } }));
  const assignments = add('EMPLOYMENT_ASSIGNMENT', await tx.hrEmploymentAssignment.findMany({ where: { id: { in: sections.map(({ employmentAssignmentId }) => employmentAssignmentId) } }, select: { id: true, employmentRelationshipId: true, positionId: true, effectiveFrom: true, effectiveTo: true } }));
  add('POSITION', await tx.hrPosition.findMany({ where: { id: { in: ids(assignments.map(({ positionId }) => positionId)) } }, select: { id: true, jobId: true } }));
  // Family versions consulted by historical selection include retired and removed memberships.
  const families = add('PERFORMANCE_PEER_FAMILY', await tx.performancePeerFamilyVersion.findMany({ where: { lifecycle: { in: ['ACTIVE', 'RETIRED'] }, effectiveFrom: { lt: to } } }));
  add('PERFORMANCE_PEER_FAMILY_JOB', await tx.performancePeerFamilyJob.findMany({ where: { familyVersionId: { in: families.map(({ id }) => id) } } }));
  const phase = await tx.performanceFeaturePhaseVersion.findFirst({ where: { effectiveFrom: { lte: new Date() } }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }] });
  if (phase) {
    add('PERFORMANCE_FEATURE_PHASE', [phase]);
    if (phase.cohortVersionId) {
      add('PERFORMANCE_COHORT', await tx.performanceCohortVersion.findMany({ where: { id: phase.cohortVersionId } }));
      add('PERFORMANCE_COHORT_MEMBER', await tx.performanceCohortMember.findMany({ where: { cohortVersionId: phase.cohortVersionId } }));
    }
  }
  // Source payloads remain references with integrity hashes, not duplicated confidential narratives.
  const payloadIds = sources.flatMap(({ record }) => {
    const value = record as { encryptedPayloadId?: string | null };
    return value.encryptedPayloadId ? [value.encryptedPayloadId] : [];
  });
  const payloads = await tx.performanceEncryptedPayload.findMany({ where: { id: { in: payloadIds } }, select: { id: true, aggregateType: true, aggregateId: true, plaintextHash: true, schemaVersion: true } });
  if (payloads.length !== new Set(payloadIds).size) throw unavailable();
  add('PERFORMANCE_PAYLOAD', payloads);
  // Bind the payload's own hold scope even where it differs from its owner record.
  const scopes = new Map<string, Scope>();
  for (const { aggregateType, id } of [...sources, ...payloads.map((payload) => ({ aggregateType: payload.aggregateType, id: payload.aggregateId }))]) {
    const scope = { aggregateType, aggregateIdHash: hashId(id) };
    scopes.set(`${aggregateType}:${scope.aggregateIdHash}`, scope);
  }
  return { sources, scopes: [...scopes.values()], reportingFrom: from.toISOString(), reportingTo: to.toISOString() };
};

export const sealPerformanceExportLineage = async (tx: Prisma.TransactionClient, exportId: string,
  sources: Awaited<ReturnType<typeof capturePerformanceExportSources>>, reconstruction: unknown, keyring: PerformanceVaultKey) => {
  const hash = dependencyHash(sources.scopes);
  const payload = await persistPerformancePayload(tx, { aggregateType: 'PERFORMANCE_ANALYTICS_RECONSTRUCTION', aggregateId: exportId,
    payloadKind: 'EXPORT_SOURCE_LINEAGE', schemaVersion: 1, keyring,
    payload: JSON.parse(JSON.stringify({ schemaVersion: 1, mode: 'KNOWN_AT_CUTOFF', capturedAt: new Date().toISOString(), ...sources, dependencyHash: hash, reconstruction })) });
  await tx.performanceExportDependency.createMany({ data: sources.scopes.map((scope) => ({ exportId, ...scope })) });
  await tx.performanceExportLineage.create({ data: { exportId, schemaVersion: 1, reconstructionId: payload.id, dependencyHash: hash, dependencyCount: sources.scopes.length } });
  return payload;
};

// Shared retention interface for #366: sealed scopes survive export TTL cleanup without exposing identities.
export const resolvePerformanceExportDependencies = async (tx: Prisma.TransactionClient, exportId: string) => {
  const lineage = await tx.performanceExportLineage.findUnique({ where: { exportId } });
  if (!lineage || lineage.schemaVersion !== 1) throw unavailable();
  const dependencies = await tx.performanceExportDependency.findMany({ where: { exportId }, select: { aggregateType: true, aggregateIdHash: true } });
  if (dependencies.length !== lineage.dependencyCount || dependencyHash(dependencies) !== lineage.dependencyHash) throw unavailable();
  const payload = await readPerformancePayload<{ schemaVersion: number; scopes: Scope[]; dependencyHash: string }>(tx, lineage.reconstructionId, performanceVaultKeyFromEnvironment());
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.scopes) || payload.dependencyHash !== lineage.dependencyHash
    || dependencyHash(payload.scopes) !== lineage.dependencyHash) throw unavailable();
  return dependencies;
};

// A hold placed on later dispute/review evidence also preserves its source evaluation's exports.
// Resolve ownership against the sealed evaluation roots; never replace their historical reconstruction.
// The caller holds the disclosure fence, shared by hold placement and release, throughout this lookup.
export const findPerformanceExportLegalHold = async (tx: Prisma.TransactionClient, exportId: string, scopes: Scope[]) => {
  const direct = await tx.performanceLegalHold.findFirst({ where: { status: 'ACTIVE', OR: scopes }, select: { id: true } });
  if (direct) return direct;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    WITH roots AS (
      SELECT e.id FROM performance_evaluations e
      JOIN performance_export_dependencies d ON d."exportId" = ${exportId}
        AND d."aggregateType" = 'EVALUATION'
        AND d."aggregateIdHash" = encode(sha256(convert_to(e.id, 'UTF8')), 'hex')
    ), sections AS (
      SELECT s.id FROM performance_evaluation_sections s JOIN roots r ON r.id = s."evaluationId"
    ), submissions AS (
      SELECT s.id FROM performance_submissions s JOIN sections section ON section.id = s."sectionId"
    ), descendants AS (
      SELECT 'EVALUATION_SECTION' AS kind, id FROM sections
      UNION ALL SELECT 'PERFORMANCE_DRAFT', d.id FROM performance_drafts d JOIN sections s ON s.id = d."sectionId"
      UNION ALL SELECT 'PERFORMANCE_SUBMISSION', id FROM submissions
      UNION ALL SELECT 'PERFORMANCE_REVIEW', review.id FROM performance_reviews review JOIN submissions s ON s.id = review."submissionId"
      UNION ALL SELECT 'CALCULATION_TRACE', trace.id FROM performance_calculation_traces trace JOIN roots r ON r.id = trace."evaluationId"
      UNION ALL SELECT 'ACCEPTED_RESULT', result.id FROM performance_accepted_results result JOIN roots r ON r.id = result."evaluationId"
      UNION ALL SELECT 'PERFORMANCE_PRIVACY_CASE', scope."caseId" FROM performance_privacy_scopes scope JOIN roots r ON r.id = scope."evaluationId"
    )
    SELECT hold.id FROM performance_legal_holds hold JOIN descendants d
      ON hold."aggregateType" = d.kind AND hold."aggregateIdHash" = encode(sha256(convert_to(d.id, 'UTF8')), 'hex')
    WHERE hold.status = 'ACTIVE' LIMIT 1`;
  return rows[0] ?? null;
};
