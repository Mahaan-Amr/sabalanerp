import { enablePerformanceTestRelease, enrollPerformanceTestCohort } from './personnelPerformanceTestRelease';
import { PERFORMANCE_RETENTION_SCHEDULE_V1 } from '../personnelPerformanceRetention';
import { canonicalPerformanceHash, DEFAULT_LEVEL_POLICY_CONTENT } from '../personnelPerformancePolicy';
import { persistPerformancePayload, performanceVaultKeyFromEnvironment, readPerformancePayload } from '../personnelPerformancePayloadStore';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { prisma } from '../../lib/prisma';
import {
  cleanupExpiredPerformanceExports,
  deliverPersonalPerformanceSummary,
  fixedCohortPerformanceTrend,
  getPersonnelPerformanceBadges,
  listEligibleConsequenceResults,
  performanceExportPdfHtml,
  performanceExportRows,
  renderPerformanceExportArtifact,
} from '../personnelPerformanceDisclosureStore';
import { buildPerformanceAnalytics } from '../personnelPerformanceDisclosure';
import { publishCompensationAgreement } from '../hrCompensationAgreementStore';
import { DEFAULT_CURRENT_LEVEL_POLICY_CONTENT } from '../personnelPerformancePolicyStore';
import { persistAcceptedPerformanceResult } from '../personnelPerformanceResultStore';
import { PerformancePolicyKind } from '@prisma/client';

const seed = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], marker: string) => {
      const suffix = `${Date.now().toString(36)}-${marker}`;
      const actor = await tx.user.create({ data: {
        email: `performance-disclosure-${suffix}@example.invalid`,
        username: `performance_disclosure_${suffix}`,
        password: 'not-used', firstName: 'عامل', lastName: 'افشا',
      } });
  await enablePerformanceTestRelease(tx, actor.id);
      const personnel = await tx.personnel.create({ data: { firstName: 'پرسنل', lastName: 'ارجاع' } });
      const relationship = await tx.hrEmploymentRelationship.create({ data: {
        personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
      } });
      const subject = await tx.performanceSubject.create({ data: {
        stableKey: `subject-${suffix}`, nonDisplayKey: `opaque-${suffix}`, personnelId: personnel.id,
        employmentRelationshipId: relationship.id, createdByUserId: actor.id,
      } });
      const payload = (id: string) => tx.performanceEncryptedPayload.create({ data: {
        id, aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: id, payloadKind: 'IMMUTABLE_HANDOFF', schemaVersion: 1,
        format: 'sabalan-personnel-performance', formatVersion: 1, cipher: 'aes-256-gcm', keyId: 'test-v1',
        iv: Buffer.alloc(12), authTag: Buffer.alloc(16), ciphertext: Buffer.from('encrypted'), plaintextHash: 'a'.repeat(64), aadHash: 'b'.repeat(64),
      } });
      const firstPayload = await payload(`handoff-payload-a-${suffix}`);
      const handoff = await tx.performanceConsequenceHandoff.create({ data: {
        subjectId: subject.id, personnelId: personnel.id, employmentRelationshipId: relationship.id,
        consequenceType: 'COMPENSATION_REVIEW', policyCycleKey: '1405', reasonCategory: 'SUSTAINED_CONTRIBUTION',
        reason: 'بازبینی جبران خدمت بر پایه نتیجه مصوب و شاهد مستقل', encryptedPayloadId: firstPayload.id,
        snapshotHash: 'snapshot-a', createdByUserId: actor.id,
      } });
      return { tx, suffix, actor, personnel, relationship, subject, payload, handoff, marker };
};

const publishPolicyFixture = async (
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  actorUserId: string,
  policyKind: PerformancePolicyKind,
  content: Record<string, unknown>,
  suffix: string,
) => {
  const id = `disclosure-policy-${policyKind.toLowerCase()}-${suffix}`;
  const previewId = `disclosure-preview-${policyKind.toLowerCase()}-${suffix}`;
  const payload = await persistPerformancePayload(tx, {
    aggregateType: 'POLICY_VERSION', aggregateId: id, payloadKind: 'POLICY_CONTENT_REVISION_1', schemaVersion: 1,
    payload: content, keyring: performanceVaultKeyFromEnvironment(),
  });
  const policy = await tx.performancePolicyVersion.create({ data: {
    id, policyKind, version: 1, contentHash: payload.contentHash, encryptedPayloadId: payload.id, createdByUserId: actorUserId,
  } });
  const previewPayload = await persistPerformancePayload(tx, {
    aggregateType: 'POLICY_ACTIVATION_PREVIEW', aggregateId: previewId, payloadKind: 'POPULATION_RESULT', schemaVersion: 1,
    payload: { fixture: true, population: [] }, keyring: performanceVaultKeyFromEnvironment(),
  });
  const effectiveAt = new Date(Date.now() - 10_000);
  await tx.performancePolicyActivationPreview.create({ data: {
    id: previewId, policyVersionId: id, policyContentHash: policy.contentHash,
    populationHash: previewPayload.contentHash, encryptedPayloadId: previewPayload.id,
    eligibleSubjectCount: 0, evaluatedSubjectCount: 0, increasedCount: 0, decreasedCount: 0,
    unchangedCount: 0, expiredCount: 0, needsNewEvaluationCount: 0, errorCount: 0,
    resultHash: previewPayload.contentHash, generatedAt: effectiveAt, confirmedAt: effectiveAt, confirmedByUserId: actorUserId,
  } });
  await tx.performancePolicyVersion.update({ where: { id }, data: {
    lifecycle: 'SCHEDULED', effectiveFrom: effectiveAt, publicationReason: 'Rollback-only disclosure compatibility fixture',
    publishedByUserId: actorUserId, publishedAt: effectiveAt, activationPreviewId: previewId,
    activationPreviewHash: previewPayload.contentHash, activationConfirmedAt: effectiveAt,
  } });
  return tx.performancePolicyVersion.update({ where: { id }, data: { lifecycle: 'ACTIVE' } });
};

const main = async () => {
  await assert.rejects(prisma.$transaction(async (tx) => {
    const suffix = `${Date.now().toString(36)}-accepted-level-chain`;
    const actor = await tx.user.create({ data: {
      email: `${suffix}@example.invalid`, username: suffix, password: 'not-used', firstName: 'عامل', lastName: 'زنجیره',
    } });
    await enablePerformanceTestRelease(tx, actor.id);
    await tx.hrFeatureCatalog.upsert({ where: { code: 'DELIVER_PERFORMANCE_PERSONAL_SUMMARY' }, update: {}, create: {
      code: 'DELIVER_PERFORMANCE_PERSONAL_SUMMARY', workspaceCode: 'HUMAN_RESOURCES', version: 1,
      displayName: 'تحویل خلاصه شخصی عملکرد',
    } });
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: `${suffix}:summary-delivery`, userId: actor.id, featureCode: 'DELIVER_PERFORMANCE_PERSONAL_SUMMARY',
      level: 'EDIT', effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: actor.id, reason: 'Rollback-only accepted-level delivery fixture',
    } });
    await publishPolicyFixture(tx, actor.id, PerformancePolicyKind.LEVEL_CLASSIFICATION, DEFAULT_LEVEL_POLICY_CONTENT, suffix);
    await publishPolicyFixture(tx, actor.id, PerformancePolicyKind.CURRENT_LEVEL, DEFAULT_CURRENT_LEVEL_POLICY_CONTENT, suffix);
    type BoundaryScenario = {
      exactScore: string;
      expectedCode: 'URGENT_IMPROVEMENT' | 'IMPROVEMENT' | 'MEETS' | 'EXCEEDS' | 'OUTSTANDING';
      parts: ReadonlyArray<readonly [string, 1 | 5]>;
    };
    const boundaryScenarios: readonly BoundaryScenario[] = [
      { exactScore: '0.000000', expectedCode: 'URGENT_IMPROVEMENT', parts: [['100.000000', 1]] },
      { exactScore: '19.999999', expectedCode: 'URGENT_IMPROVEMENT', parts: [['80.000001', 1], ['19.999999', 5]] },
      { exactScore: '20.000000', expectedCode: 'IMPROVEMENT', parts: [['80.000000', 1], ['20.000000', 5]] },
      { exactScore: '39.999999', expectedCode: 'IMPROVEMENT', parts: [['60.000001', 1], ['39.999999', 5]] },
      { exactScore: '40.000000', expectedCode: 'MEETS', parts: [['60.000000', 1], ['40.000000', 5]] },
      { exactScore: '59.999999', expectedCode: 'MEETS', parts: [['40.000001', 1], ['59.999999', 5]] },
      { exactScore: '60.000000', expectedCode: 'EXCEEDS', parts: [['40.000000', 1], ['60.000000', 5]] },
      { exactScore: '79.999999', expectedCode: 'EXCEEDS', parts: [['20.000001', 1], ['79.999999', 5]] },
      { exactScore: '80.000000', expectedCode: 'OUTSTANDING', parts: [['20.000000', 1], ['80.000000', 5]] },
      { exactScore: '100.000000', expectedCode: 'OUTSTANDING', parts: [['100.000000', 5]] },
    ];
    const subjects: Array<{ personnelId: string; subjectId: string; relationshipId: string }> = [];
    const immutableHashes: Array<{ resultId: string; exactScoreHash: string; payloadHash: string }> = [];
    for (let index = 0; index < boundaryScenarios.length; index += 1) {
      const scenario = boundaryScenarios[index];
      const personnel = await tx.personnel.create({ data: { firstName: 'سطح', lastName: String(index + 1) } });
      const relationship = await tx.hrEmploymentRelationship.create({ data: {
        personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01Z'), createdBy: actor.id,
      } });
      const subject = await tx.performanceSubject.create({ data: {
        stableKey: `${suffix}-subject-${index}`, nonDisplayKey: `${suffix}-opaque-${index}`,
        personnelId: personnel.id, employmentRelationshipId: relationship.id, createdByUserId: actor.id,
      } });
      const evaluation = await tx.performanceEvaluation.create({ data: {
        stableKey: `${suffix}-evaluation-${index}`, subjectId: subject.id,
        measurementFrom: new Date('2026-08-01Z'), measurementTo: new Date('2026-08-31T20:29:59.999Z'),
        createdByUserId: actor.id,
      } });
      await tx.performanceEvaluation.update({ where: { id: evaluation.id }, data: { status: 'READY_FOR_SUBMISSION' } });
      await tx.performanceEvaluation.update({ where: { id: evaluation.id }, data: { status: 'UNDER_REVIEW' } });
      const criteria = scenario.parts.map(([_weight, grade], partIndex) => ({
        criterionVersionId: `${suffix}-criterion-${index}-${partIndex}`, titleFa: `نتیجه مصوب ${partIndex + 1}`,
        weightPercent: '100.00', kind: 'JUDGMENT' as const,
        anchorsFa: ['یک', 'دو', 'سه', 'چهار', 'پنج'], applicability: null,
        evidence: { minimumReliableCount: 1, allowedKinds: ['STRUCTURED_OBSERVATION' as const], required: true },
        grade,
      }));
      const calculationInput = {
        template: {
          schemaVersion: 1 as const, templateVersionId: `${suffix}-template-${index}`, scoringPolicyVersionId: 'scoring-v1',
          jobSharePercent: '100.00', addendumSharePercent: '0.00',
          categories: criteria.map(({ grade: _grade, ...criterion }, partIndex) => ({
            id: `result-${partIndex}`, titleFa: `نتیجه ${partIndex + 1}`,
            weightPercent: scenario.parts[partIndex][0], required: true, criteria: [criterion],
          })),
        },
        sections: [{
          sectionId: `${suffix}-section-${index}`, effectiveDays: 31, allocationPercent: '100.00',
          effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: '2026-08-31T20:29:59.999Z', snapshotFacts: {},
          responses: criteria.map(({ criterionVersionId, grade }, partIndex) => ({ criterionVersionId, grade, evidence: [{
            kind: 'STRUCTURED_OBSERVATION' as const, quality: 'RELIABLE' as const, occurredAt: '2026-08-15T00:00:00.000Z',
            referenceId: `${suffix}-evidence-${index}-${partIndex}`, sourceVersion: '1', contentHash: (index + 1).toString(16).repeat(64),
          }] })),
        }],
      };
      const accepted = await persistAcceptedPerformanceResult(tx, {
        evaluationId: evaluation.id, calculationInput, acceptedByUserId: actor.id,
        idempotencyKey: `${suffix}-accept-${index}`, acceptedAt: new Date(), keyring: performanceVaultKeyFromEnvironment(),
      });
      assert.equal(accepted.idempotent, false);
      const acceptedOutput = accepted as { historicalLevel: { levelCode: string }; result: { id: string }; idempotent: false };
      assert.equal(acceptedOutput.historicalLevel.levelCode, scenario.expectedCode);
      assert.equal((accepted as { calculation: { exactScore: string } }).calculation.exactScore, scenario.exactScore);
      const row = await tx.performanceAcceptedResult.findUniqueOrThrow({ where: { id: acceptedOutput.result.id } });
      const encrypted = await tx.performanceEncryptedPayload.findUniqueOrThrow({ where: { id: row.encryptedPayloadId } });
      immutableHashes.push({ resultId: row.id, exactScoreHash: row.exactScoreHash, payloadHash: encrypted.plaintextHash });
      subjects.push({ personnelId: personnel.id, subjectId: subject.id, relationshipId: relationship.id });
    }
    await enrollPerformanceTestCohort(tx, actor.id, subjects.map(({ subjectId }) => subjectId));
    const badges = await getPersonnelPerformanceBadges(tx as any, { actorUserId: actor.id, personnelIds: subjects.map(({ personnelId }) => personnelId) });
    assert.deepEqual(badges.map(({ badge }) => badge?.levelCode), boundaryScenarios.map(({ expectedCode }) => expectedCode));
    const projections = await tx.performanceCurrentLevelProjection.findMany({ where: { subjectId: { in: subjects.map(({ subjectId }) => subjectId) } }, orderBy: { levelCode: 'asc' } });
    assert.equal(projections.length, boundaryScenarios.length);
    const acceptedPopulation = badges.flatMap(({ badge }, index) => {
      const levelCode = badge?.levelCode;
      if (!levelCode) throw new Error('Persisted projection badge is unavailable');
      return Array.from({ length: 5 }, (_, copyIndex) => ({
        subjectId: `${subjects[index].subjectId}-${copyIndex}`, personnelId: `${subjects[index].personnelId}-${copyIndex}`,
        displayName: `پرسنل ${index}-${copyIndex}`, employmentRelationshipId: `${subjects[index].relationshipId}-${copyIndex}`,
        levelCode, comparabilitySignature: 'accepted-chain-v1', peerGroupKey: 'accepted-chain-peer',
        measurementTo: new Date('2026-08-31T20:29:59.999Z'),
      }));
    });
    const aggregateReport = buildPerformanceAnalytics({ population: acceptedPopulation, selected: acceptedPopulation });
    const rankingReport = buildPerformanceAnalytics({ population: acceptedPopulation, selected: acceptedPopulation, mode: 'NAMED_RANKING' });
    assert.equal(aggregateReport.suppressed, false);
    assert.equal(rankingReport.suppressed, false);
    if (aggregateReport.suppressed || !('levelDistribution' in aggregateReport)
      || rankingReport.suppressed || !('peerGroups' in rankingReport)) throw new Error('Accepted-result analytics unexpectedly suppressed');
    assert.deepEqual(aggregateReport.levelDistribution.map(({ levelCode, count }) => [levelCode, count]), [
      ['URGENT_IMPROVEMENT', 10], ['IMPROVEMENT', 10], ['MEETS', 10], ['EXCEEDS', 10], ['OUTSTANDING', 10],
    ]);
    assert.deepEqual(rankingReport.peerGroups[0].groups.map(({ levelCode, members }) => [levelCode, members.length]), [
      ['URGENT_IMPROVEMENT', 10], ['IMPROVEMENT', 10], ['MEETS', 10], ['EXCEEDS', 10], ['OUTSTANDING', 10],
    ]);
    const canonicalRows = performanceExportRows(aggregateReport);
    const xlsxArtifact = await renderPerformanceExportArtifact('XLSX', canonicalRows, new AbortController().signal);
    const renderedWorkbook = XLSX.read(xlsxArtifact.bytes);
    const xlsxRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(renderedWorkbook.Sheets[renderedWorkbook.SheetNames[0]]);
    assert.deepEqual(xlsxRows.map(({ levelCode, labelFa, count }) => [levelCode, labelFa, count]),
      canonicalRows.map(({ levelCode, labelFa, count }) => [levelCode, labelFa, count]));
    const pdfHtml = performanceExportPdfHtml(canonicalRows);
    for (const { levelCode, labelFa } of canonicalRows) {
      assert.ok(pdfHtml.includes(String(levelCode)) && pdfHtml.includes(String(labelFa)), 'PDF and Excel use the same accepted-result level rows');
    }
    const previousExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (!previousExecutable && process.platform === 'darwin') {
      const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      await access(macChrome);
      process.env.PUPPETEER_EXECUTABLE_PATH = macChrome;
    }
    try {
      const pdfArtifact = await renderPerformanceExportArtifact('PDF', canonicalRows, new AbortController().signal);
      assert.equal(pdfArtifact.mimeType, 'application/pdf');
      assert.equal(pdfArtifact.bytes.subarray(0, 4).toString(), '%PDF');
      assert.ok(pdfArtifact.bytes.length > 1_000, 'rendered PDF must contain the canonical five-level table');
    } finally {
      if (previousExecutable) process.env.PUPPETEER_EXECUTABLE_PATH = previousExecutable;
      else delete process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    const delivered = await deliverPersonalPerformanceSummary(tx, {
      actorUserId: actor.id, personnelId: subjects[4].personnelId,
      identityVerification: { methodCode: 'IN_PERSON_EMPLOYEE_RECORD', evidenceReference: `${suffix}-employee-record`, verifiedAt: new Date() },
    });
    assert.equal(delivered.summary.levelCode, 'MEETS');
    const receipt = await tx.performanceAuditEvent.findUniqueOrThrow({ where: { id: delivered.receipt.id } });
    const receiptPayload = await readPerformancePayload<any>(tx, receipt.encryptedPayloadId!, performanceVaultKeyFromEnvironment());
    const deliveredProjection = await tx.performanceCurrentLevelProjection.findUniqueOrThrow({ where: { subjectId: subjects[4].subjectId } });
    assert.equal(receiptPayload.source.sourceResultsHash, deliveredProjection.sourceResultsHash);
    assert.equal(receiptPayload.source.levelPolicyVersionId, deliveredProjection.levelPolicyVersionId);
    assert.deepEqual(await Promise.all(immutableHashes.map(async ({ resultId }) => {
      const row = await tx.performanceAcceptedResult.findUniqueOrThrow({ where: { id: resultId } });
      const encrypted = await tx.performanceEncryptedPayload.findUniqueOrThrow({ where: { id: row.encryptedPayloadId } });
      return { resultId, exactScoreHash: row.exactScoreHash, payloadHash: encrypted.plaintextHash };
    })), immutableHashes, 'projection and presentation reads preserve immutable accepted-result hashes');
    throw new Error('ROLLBACK_ACCEPTED_LEVEL_CHAIN');
  }, { timeout: 120_000 }), /ROLLBACK_ACCEPTED_LEVEL_CHAIN/);

  await assert.rejects(prisma.$transaction(async (tx) => {
    const suffix = `${Date.now().toString(36)}-personal-summary`;
    const actor = await tx.user.create({ data: {
      email: `${suffix}@example.invalid`, username: suffix, password: 'not-used', firstName: 'عامل', lastName: 'تحویل',
    } });
    const outsider = await tx.user.create({ data: {
      email: `outsider-${suffix}@example.invalid`, username: `outsider_${suffix}`, password: 'not-used', firstName: 'بدون', lastName: 'اختیار',
    } });
    const personnel = await tx.personnel.create({ data: { firstName: 'پرسنل', lastName: 'بدون حساب' } });
    const relationship = await tx.hrEmploymentRelationship.create({ data: {
      personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01Z'), createdBy: actor.id,
    } });
    const subject = await tx.performanceSubject.create({ data: {
      stableKey: `summary-subject-${suffix}`, nonDisplayKey: `summary-opaque-${suffix}`, personnelId: personnel.id,
      employmentRelationshipId: relationship.id, createdByUserId: actor.id,
    } });
    await enrollPerformanceTestCohort(tx, actor.id, [subject.id]);
    await tx.hrFeatureCatalog.upsert({ where: { code: 'DELIVER_PERFORMANCE_PERSONAL_SUMMARY' }, update: {}, create: {
      code: 'DELIVER_PERFORMANCE_PERSONAL_SUMMARY', workspaceCode: 'HUMAN_RESOURCES', version: 1,
      displayName: 'تحویل خلاصه شخصی عملکرد',
    } });
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: `${suffix}:summary-delivery`, userId: actor.id, featureCode: 'DELIVER_PERFORMANCE_PERSONAL_SUMMARY',
      level: 'EDIT', effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: actor.id, reason: 'Isolated summary delivery test',
    } });
    const [supervisorPersonnel, historicalSupervisorPersonnel] = await Promise.all([
      tx.personnel.create({ data: { firstName: 'سرپرست', lastName: 'جاری' } }),
      tx.personnel.create({ data: { firstName: 'سرپرست', lastName: 'تاریخی' } }),
    ]);
    const [supervisorUser, historicalSupervisorUser] = await Promise.all([
      tx.user.create({ data: { email: `supervisor-${suffix}@example.invalid`, username: `supervisor_${suffix}`, password: 'not-used', firstName: 'سرپرست', lastName: 'جاری', personnelId: supervisorPersonnel.id } }),
      tx.user.create({ data: { email: `historical-${suffix}@example.invalid`, username: `historical_${suffix}`, password: 'not-used', firstName: 'سرپرست', lastName: 'تاریخی', personnelId: historicalSupervisorPersonnel.id } }),
    ]);
    await tx.hrFeatureAccessGrant.createMany({ data: [supervisorUser, historicalSupervisorUser].map((user) => ({
      stableKey: `${suffix}:submit:${user.id}`, userId: user.id, featureCode: 'SUBMIT_PERFORMANCE_EVALUATION',
      level: 'EDIT' as const, effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: actor.id, reason: 'Isolated current-supervisor delivery test',
    })) });
    const unit = await tx.hrOrganizationalUnit.create({ data: { code: `SUMMARY-UNIT-${suffix}`, name: 'واحد تحویل خلاصه', type: 'DEPARTMENT', createdBy: actor.id } });
    const job = await tx.hrJob.create({ data: { code: `SUMMARY-JOB-${suffix}`, title: 'شغل تحویل خلاصه', createdBy: actor.id } });
    const [targetPosition, supervisorPosition] = await Promise.all([
      tx.hrPosition.create({ data: { code: `SUMMARY-TARGET-${suffix}`, title: 'جایگاه گیرنده', jobId: job.id, organizationalUnitId: unit.id, createdBy: actor.id } }),
      tx.hrPosition.create({ data: { code: `SUMMARY-SUPERVISOR-${suffix}`, title: 'جایگاه سرپرست', jobId: job.id, organizationalUnitId: unit.id, createdBy: actor.id } }),
    ]);
    const [supervisorRelationship, historicalSupervisorRelationship] = await Promise.all([
      tx.hrEmploymentRelationship.create({ data: { personnelId: supervisorPersonnel.id, status: 'ACTIVE', effectiveFrom: new Date('2020-01-01Z'), createdBy: actor.id } }),
      tx.hrEmploymentRelationship.create({ data: { personnelId: historicalSupervisorPersonnel.id, status: 'ENDED', effectiveFrom: new Date('2020-01-01Z'), effectiveTo: new Date('2025-01-01Z'), createdBy: actor.id } }),
    ]);
    const [targetAssignment, supervisorAssignment, historicalSupervisorAssignment] = await Promise.all([
      tx.hrEmploymentAssignment.create({ data: { employmentRelationshipId: relationship.id, positionId: targetPosition.id, type: 'PRIMARY', effectiveFrom: new Date('2020-01-01Z'), organizationalUnitId: unit.id, performanceAllocationPercent: '100.00', createdBy: actor.id } }),
      tx.hrEmploymentAssignment.create({ data: { employmentRelationshipId: supervisorRelationship.id, positionId: supervisorPosition.id, type: 'PRIMARY', effectiveFrom: new Date('2020-01-01Z'), organizationalUnitId: unit.id, performanceAllocationPercent: '100.00', createdBy: actor.id } }),
      tx.hrEmploymentAssignment.create({ data: { employmentRelationshipId: historicalSupervisorRelationship.id, positionId: supervisorPosition.id, type: 'PRIMARY', effectiveFrom: new Date('2020-01-01Z'), effectiveTo: new Date('2025-01-01Z'), organizationalUnitId: unit.id, performanceAllocationPercent: '100.00', createdBy: actor.id } }),
    ]);
    await tx.hrAssignmentPerformanceResponsibility.createMany({ data: [
      { employmentAssignmentId: targetAssignment.id, supervisorAssignmentId: historicalSupervisorAssignment.id, effectiveFrom: new Date('2020-01-01Z'), effectiveTo: new Date('2025-01-01Z'), allocationPercent: '100.00', status: 'SUPERSEDED', reason: 'Historical supervisor delivery denial test', createdBy: actor.id },
      { employmentAssignmentId: targetAssignment.id, supervisorAssignmentId: supervisorAssignment.id, effectiveFrom: new Date('2025-01-01Z'), allocationPercent: '100.00', reason: 'Current supervisor delivery test', createdBy: actor.id },
    ] });
    const input = {
      personnelId: personnel.id,
      identityVerification: {
        methodCode: 'IN_PERSON_GOVERNMENT_ID' as const,
        evidenceReference: `identity-record-${suffix}`,
        verifiedAt: new Date(),
      },
    };
    await assert.rejects(() => deliverPersonalPerformanceSummary(tx, { ...input, actorUserId: outsider.id }),
      (error: any) => error?.code === 'PERFORMANCE_PERSONAL_SUMMARY_DELIVERY_FORBIDDEN' && error?.statusCode === 403);
    await assert.rejects(() => deliverPersonalPerformanceSummary(tx, { ...input, actorUserId: historicalSupervisorUser.id }),
      (error: any) => error?.code === 'PERFORMANCE_PERSONAL_SUMMARY_DELIVERY_FORBIDDEN', 'historical supervision never authorizes current delivery');
    await assert.rejects(() => deliverPersonalPerformanceSummary(tx, {
      actorUserId: actor.id, personnelId: personnel.id, identityVerification: undefined as any,
    }), (error: any) => error?.code === 'PERFORMANCE_PERSONAL_SUMMARY_IDENTITY_REQUIRED' && error?.statusCode === 422);
    const delivered = await deliverPersonalPerformanceSummary(tx, { ...input, actorUserId: actor.id });
    assert.deepEqual(delivered.summary, {
      state: 'UNEVALUATED', labelFa: 'ارزیابی‌نشده',
      meaningFa: 'هنوز نتیجه مصوب امتیازداری برای این رابطه استخدامی وجود ندارد.', version: 0,
    });
    assert.equal(delivered.receipt.summaryKind, 'PERSONAL_PERFORMANCE_LEVEL_SUMMARY');
    assert.equal(delivered.receipt.schemaVersion, 1);
    const receipt = await tx.performanceAuditEvent.findUniqueOrThrow({ where: { id: delivered.receipt.id } });
    assert.equal(receipt.eventType, 'PERSONAL_PERFORMANCE_SUMMARY_DELIVERED');
    assert.equal(receipt.actorUserId, actor.id);
    assert.ok(receipt.encryptedPayloadId);
    const receiptPayload = await readPerformancePayload<Record<string, unknown>>(tx, receipt.encryptedPayloadId!, performanceVaultKeyFromEnvironment());
    assert.equal(receiptPayload.recipientPersonnelId, personnel.id);
    assert.equal(receiptPayload.summaryKind, 'PERSONAL_PERFORMANCE_LEVEL_SUMMARY');
    assert.equal(receiptPayload.retentionClass, 'DISCLOSURE_RECEIPT');
    assert.deepEqual(receiptPayload.source, { projectionVersion: 0, levelPolicyVersionId: null, sourceResultsHash: null });
    assert.equal('score' in receiptPayload, false);
    assert.equal('criteria' in receiptPayload, false);
    assert.equal('narrative' in receiptPayload, false);
    assert.equal('rank' in receiptPayload, false);
    assert.notEqual(receiptPayload.identityEvidenceReferenceHash, input.identityVerification.evidenceReference);
    const supervisorDelivery = await deliverPersonalPerformanceSummary(tx, { ...input, actorUserId: supervisorUser.id });
    const supervisorReceipt = await tx.performanceAuditEvent.findUniqueOrThrow({ where: { id: supervisorDelivery.receipt.id } });
    const supervisorPayload = await readPerformancePayload<any>(tx, supervisorReceipt.encryptedPayloadId!, performanceVaultKeyFromEnvironment());
    assert.equal(supervisorPayload.authority.kind, 'CURRENT_RESPONSIBLE_SUPERVISOR');
    const activeAccount = await tx.user.create({ data: {
      email: `recipient-${suffix}@example.invalid`, username: `recipient_${suffix}`, password: 'not-used', firstName: 'دارای', lastName: 'حساب', personnelId: personnel.id,
    } });
    assert.ok(activeAccount);
    await assert.rejects(() => deliverPersonalPerformanceSummary(tx, { ...input, actorUserId: actor.id }),
      (error: any) => error?.code === 'PERFORMANCE_PERSONAL_SUMMARY_DELIVERY_FORBIDDEN');
    throw new Error('ROLLBACK_PERSONAL_SUMMARY_DELIVERY');
  }), /ROLLBACK_PERSONAL_SUMMARY_DELIVERY/);
  await assert.rejects(prisma.$transaction(async (tx) => {
    const subjectIds: string[] = [];
    for (let index = 0; index < 10; index++) subjectIds.push((await seed(tx, `empty-month-${index}`)).subject.id);
    const trend = await fixedCohortPerformanceTrend(tx, subjectIds, new Date('2026-01-01Z'), new Date('2026-04-01Z'));
    assert.equal(trend.suppressed, false);
    if (trend.suppressed) throw new Error('Empty calendar population unexpectedly suppressed');
    assert.equal(trend.fixedCohortSuppressed, true);
    assert.equal(trend.populationComposition.suppressed, false);
    if (!trend.populationComposition.suppressed) {
      assert.deepEqual(trend.populationComposition.periods.map(({ periodKey, missingResultCount, resultPopulationCount }) => [periodKey, missingResultCount, resultPopulationCount]),
        [['2026-03', 10, 0], ['2026-02', 10, 0], ['2026-01', 10, 0]]);
    }
    throw new Error('ROLLBACK_EMPTY_MONTH_TREND');
  }, { timeout: 30_000 }), /ROLLBACK_EMPTY_MONTH_TREND/);
  await assert.rejects(prisma.$transaction(async (tx) => {
    const { actor, relationship, suffix } = await seed(tx, 'publish-agreement');
    const input = {
      actorUserId: actor.id, employmentRelationshipId: relationship.id,
      components: [{ title: 'حقوق پایه', amountRials: '100' }], payRangeMinimumRials: '50', payRangeMaximumRials: '200',
      budgetCode: 'TEST', budgetAvailableRials: '1000', approvalReason: 'انتشار توافق با تأیید مستقل و بودجه معتبر آزمون',
    };
    await assert.rejects(() => publishCompensationAgreement(tx, { ...input, approvalReason: undefined as any }), (error: any) => error.status === 422);
    await assert.rejects(() => publishCompensationAgreement(tx, { ...input, approvalReason: 42 as any }), (error: any) => error.status === 422);
    await assert.rejects(() => publishCompensationAgreement(tx, input), (error: any) => error.status === 403);
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: `${suffix}:agreement-publisher`, userId: actor.id, featureCode: 'MANAGE_COMPENSATION_AGREEMENTS',
      level: 'ADMIN', effectiveFrom: new Date('2020-01-01'), grantedByUserId: actor.id, reason: 'Isolated agreement publication test',
    } });
    const agreement = await publishCompensationAgreement(tx, input);
    assert.equal(agreement.status, 'ACTIVE');
    assert.equal(agreement.totalRials.toString(), '100');
    assert.equal(agreement.approvedByUserId, actor.id);
    throw new Error('ROLLBACK_AGREEMENT_PUBLICATION');
  }), /ROLLBACK_AGREEMENT_PUBLICATION/);
  await assert.rejects(prisma.$transaction(async (tx) => {
    const { actor, relationship } = await seed(tx, 'agreement');
    const agreement = await tx.hrCompensationAgreement.create({ data: {
      employmentRelationshipId: relationship.id, version: 1, effectiveFrom: new Date('2026-01-01'),
      componentsJson: [], totalRials: 100, payRangeMinimumRials: 50, payRangeMaximumRials: 200,
      budgetCode: 'TEST', budgetAvailableRials: 1000, legalControlStatus: 'APPROVED',
      contentHash: 'a'.repeat(64), createdByUserId: actor.id, approvedByUserId: actor.id, approvedAt: new Date('2025-12-01'),
    } });
    await tx.hrCompensationAgreement.update({ where: { id: agreement.id }, data: { status: 'SCHEDULED' } });
    await tx.hrCompensationAgreement.update({ where: { id: agreement.id }, data: { status: 'ACTIVE' } });
    await tx.hrCompensationAgreement.update({ where: { id: agreement.id }, data: { effectiveTo: new Date('2026-12-31') } });
    throw new Error('AGREEMENT_MUTATION_WAS_NOT_REJECTED');
  }), /immutable/i, 'an active agreement cannot silently change its effective interval');
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const seeded = await seed(tx, 'immutable');
      await tx.performanceConsequenceHandoff.update({ where: { id: seeded.handoff.id }, data: { reason: 'بازنویسی غیرمجاز شاهد ارجاع' } });
    }),
    /immutable/i,
    'submitted consequence evidence must remain immutable',
  );
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const seeded = await seed(tx, 'unique');
      const secondPayload = await seeded.payload(`handoff-payload-b-${seeded.suffix}`);
      await tx.performanceConsequenceHandoff.create({ data: {
          subjectId: seeded.subject.id, personnelId: seeded.personnel.id, employmentRelationshipId: seeded.relationship.id,
          consequenceType: 'COMPENSATION_REVIEW', policyCycleKey: '1405', reasonCategory: 'SECOND_REQUEST',
          reason: 'ارجاع فعال رقیب نباید برای همان چرخه ثبت شود', encryptedPayloadId: secondPayload.id,
          snapshotHash: 'snapshot-b', createdByUserId: seeded.actor.id,
        } });
    }),
    /unique constraint/i,
    'only one active handoff may exist for a relationship, consequence type, and policy cycle',
  );
  await assert.rejects(prisma.$transaction(async (tx) => {
    const suffix = `${Date.now().toString(36)}-scope`;
    const actor = await tx.user.create({ data: { email: `${suffix}@example.invalid`, username: suffix, password: 'not-used', firstName: 'عامل', lastName: 'محدوده' } });
  await enablePerformanceTestRelease(tx, actor.id);
    const personnelA = await tx.personnel.create({ data: { firstName: 'الف', lastName: 'محدوده' } });
    const personnelB = await tx.personnel.create({ data: { firstName: 'ب', lastName: 'محدوده' } });
    await tx.hrNamedResponsibility.create({ data: {
      stableKey: `performance-consequence-scope-${suffix}`,
      responsibilityTypeCode: 'PERFORMANCE_CONSEQUENCE_COMPENSATION_REVIEW', scopeType: 'PERSONNEL', scopeId: personnelA.id,
      assignedUserId: actor.id, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), reason: 'آزمون محدوده مستقل', createdByUserId: actor.id,
    } });
    assert.deepEqual(await listEligibleConsequenceResults(tx as any, { personnelId: personnelA.id, actorUserId: actor.id, consequenceType: 'COMPENSATION_REVIEW' }), []);
    await assert.rejects(
      () => listEligibleConsequenceResults(tx as any, { personnelId: personnelB.id, actorUserId: actor.id, consequenceType: 'COMPENSATION_REVIEW' }),
      (error: any) => error?.code === 'PERFORMANCE_CONSEQUENCE_SCOPE_FORBIDDEN',
      'named responsibility must not authorize another Personnel',
    );
    assert.ok(await tx.performanceAuditEvent.findFirst({ where: { actorUserId: actor.id, eventType: 'CONSEQUENCE_HANDOFF_SCOPE_DENIED' } }), 'scoped authority denial must be audited');
    throw new Error('ROLLBACK_SCOPED_AUTHORITY_TEST');
  }), /ROLLBACK_SCOPED_AUTHORITY_TEST/);

  const exportSuffix = `${Date.now().toString(36)}-export`;
  const exportId = `export-${exportSuffix}`;
  const payloadId = `payload-${exportSuffix}`;
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'performance-export-test-'));
  const artifactPath = path.join(temporaryDirectory, 'artifact.enc');
  await writeFile(artifactPath, Buffer.from('encrypted-artifact'));
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const exportUser = await tx.user.create({ data: { email: `${exportSuffix}@example.invalid`, username: exportSuffix, password: 'not-used', firstName: 'عامل', lastName: 'خروجی' } });
  await enablePerformanceTestRelease(tx, exportUser.id);
      const cleanupAt = new Date();
      let retentionPolicy = await tx.performancePolicyVersion.findFirst({
        where: { policyKind: 'RETENTION', lifecycle: 'ACTIVE', effectiveFrom: { lte: cleanupAt } },
      });
      if (!retentionPolicy) {
        const policyAt = new Date(cleanupAt.getTime() - 10_000);
        const policyId = `retention-${exportSuffix}`;
        const previewId = `retention-preview-${exportSuffix}`;
        const previewPayloadId = `retention-preview-payload-${exportSuffix}`;
        const resultHash = 'e'.repeat(64);
        const latestRetention = await tx.performancePolicyVersion.findFirst({ where: { policyKind: 'RETENTION' }, orderBy: { version: 'desc' } });
        const policyPayload = await persistPerformancePayload(tx, {
          aggregateType: 'POLICY_VERSION', aggregateId: policyId, payloadKind: 'POLICY_CONTENT_REVISION_1', schemaVersion: 1,
          payload: PERFORMANCE_RETENTION_SCHEDULE_V1, keyring: performanceVaultKeyFromEnvironment(),
        });
        await tx.performancePolicyVersion.create({ data: {
          encryptedPayloadId: policyPayload.id,
          id: policyId, policyKind: 'RETENTION', version: (latestRetention?.version ?? 0) + 1,
          predecessorId: latestRetention?.id, contentHash: canonicalPerformanceHash(PERFORMANCE_RETENTION_SCHEDULE_V1), createdByUserId: exportUser.id,
        } });
        await tx.performanceEncryptedPayload.create({ data: {
          id: previewPayloadId, aggregateType: 'POLICY_ACTIVATION_PREVIEW', aggregateId: previewId, payloadKind: 'POPULATION_RESULT', schemaVersion: 1,
          format: 'sabalan-personnel-performance', formatVersion: 1, cipher: 'aes-256-gcm', keyId: 'test-v1',
          iv: Buffer.alloc(12), authTag: Buffer.alloc(16), ciphertext: Buffer.from('encrypted'), plaintextHash: resultHash, aadHash: 'f'.repeat(64),
        } });
        await tx.performancePolicyActivationPreview.create({ data: {
          id: previewId, policyVersionId: policyId, policyContentHash: canonicalPerformanceHash(PERFORMANCE_RETENTION_SCHEDULE_V1), populationHash: resultHash,
          encryptedPayloadId: previewPayloadId, eligibleSubjectCount: 0, evaluatedSubjectCount: 0, increasedCount: 0,
          decreasedCount: 0, unchangedCount: 0, expiredCount: 0, needsNewEvaluationCount: 0, errorCount: 0,
          resultHash, generatedAt: policyAt, confirmedAt: policyAt, confirmedByUserId: exportUser.id,
        } });
        await tx.performancePolicyVersion.update({ where: { id: policyId }, data: {
          lifecycle: 'SCHEDULED', effectiveFrom: policyAt, publicationReason: 'آزمون پاک‌سازی خروجی',
          publishedByUserId: exportUser.id, publishedAt: policyAt, activationPreviewId: previewId,
          activationPreviewHash: resultHash, activationConfirmedAt: policyAt,
        } });
        retentionPolicy = await tx.performancePolicyVersion.update({ where: { id: policyId }, data: { lifecycle: 'ACTIVE' } });
      }
      assert.ok(retentionPolicy, 'cleanup requires an active retention policy');
      await tx.performanceEncryptedPayload.create({ data: {
        id: payloadId, aggregateType: 'PERFORMANCE_EXPORT', aggregateId: exportId, payloadKind: 'SCOPE_SNAPSHOT', schemaVersion: 1,
        format: 'sabalan-personnel-performance', formatVersion: 1, cipher: 'aes-256-gcm', keyId: 'test-v1',
        iv: Buffer.alloc(12), authTag: Buffer.alloc(16), ciphertext: Buffer.from('encrypted'), plaintextHash: 'c'.repeat(64), aadHash: 'd'.repeat(64),
      } });
      await tx.performanceExportReceipt.create({ data: {
        id: exportId, requestedByUserId: exportUser.id, exportKind: 'XLSX', scopeHash: 'scope', permissionHash: 'permission',
        status: 'QUEUED', encryptedPayloadId: payloadId, artifactPath, artifactHash: 'artifact-hash', expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      } });
      const failedAttemptPath = path.join(temporaryDirectory, 'failed-attempt.enc');
      await writeFile(failedAttemptPath, Buffer.from('failed-attempt-encrypted-artifact'));
      await tx.performanceExportArtifact.create({ data: { exportId, attemptCount: 1, artifactPath: failedAttemptPath } });
      await tx.$executeRawUnsafe('SAVEPOINT held_export');
      await tx.performanceLegalHold.create({ data: {
        aggregateType: 'PERFORMANCE_EXPORT', aggregateId: exportId,
        aggregateIdHash: createHash('sha256').update(exportId).digest('hex'), version: 1,
        reason: 'Preserve held export in the isolated retention test', placedByUserId: exportUser.id,
      } });
      const unrelatedArtifactPath = path.join(temporaryDirectory, 'unrelated-artifact.enc');
      await writeFile(unrelatedArtifactPath, Buffer.from('unrelated-encrypted-artifact'));
      await tx.performanceExportReceipt.create({ data: {
        id: `${exportId}-unrelated`, requestedByUserId: exportUser.id, exportKind: 'XLSX', scopeHash: 'unrelated-scope',
        permissionHash: 'permission', status: 'QUEUED', artifactPath: unrelatedArtifactPath,
        artifactHash: 'unrelated-artifact-hash', expiresAt: new Date('2000-01-01Z'),
      } });
      assert.equal(await cleanupExpiredPerformanceExports(tx, cleanupAt), 0, 'historical exports without verified source lineage must be preserved');
      await access(artifactPath);
      await access(failedAttemptPath);
      await access(unrelatedArtifactPath);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT held_export');
      assert.equal(await cleanupExpiredPerformanceExports(tx, cleanupAt), 0, 'releasing a hold cannot manufacture historical lineage');
      await access(artifactPath);
      await access(failedAttemptPath);
      const preserved = await tx.performanceExportReceipt.findUniqueOrThrow({ where: { id: exportId } });
      assert.notEqual(preserved.status, 'DELETED');
      assert.equal(preserved.encryptedPayloadId, payloadId);
      assert.equal(await tx.performanceDeletionReceipt.count({ where: { deletedPayloadId: payloadId } }), 0);
      const attempt = await tx.performanceExportCleanupAttempt.findUniqueOrThrow({ where: { exportId } });
      assert.equal(attempt.status, 'HELD');
      assert.equal(attempt.lastFailureCode, 'PERFORMANCE_EXPORT_LINEAGE_UNVERIFIED');
      throw new Error('ROLLBACK_EXPORT_CLEANUP_TEST');
    }), /ROLLBACK_EXPORT_CLEANUP_TEST/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  console.log('Personnel performance disclosure integration tests passed.');
};

main().finally(() => prisma.$disconnect());
