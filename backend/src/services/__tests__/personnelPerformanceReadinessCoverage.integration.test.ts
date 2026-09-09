import assert from 'node:assert/strict';
import path from 'node:path';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';
import { enablePerformanceTestRelease } from './personnelPerformanceTestRelease';
import {
  getPerformanceReadinessCoverage,
  reconstructPerformanceReadiness,
  type PerformanceReadinessInventoryClassification,
} from '../personnelPerformanceReadinessStore';
import { readPerformancePayload } from '../personnelPerformancePayloadStore';

const repositoryRoot = path.resolve(process.cwd(), '..');
const sourceDatabaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=4&pool_timeout=10';
const keyring = { keyId: 'readiness-coverage-v1', key: Buffer.from('0123456789abcdef0123456789abcdef') };

const main = async () => {
  const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot, sourceDatabaseUrl });
  const client = database.client();
  try {
    const suffix = database.runId;
    const actor = await client.user.create({ data: {
      email: `performance-coverage-${suffix}@example.invalid`, username: `performance_coverage_${suffix}`,
      password: 'not-used', firstName: 'آزمون', lastName: 'پوشش',
    } });
    await enablePerformanceTestRelease(client, actor.id);
    const measurementFrom = new Date('2026-01-01T00:00:00.000Z');
    const measurementTo = new Date('2026-04-01T00:00:00.000Z');
    const runReadiness = async (idempotencyKey: string) => {
      let result = await reconstructPerformanceReadiness(client, {
        idempotencyKey, measurementFrom, measurementTo, actorUserId: actor.id, batchSize: 500, keyring,
      });
      while (result.hasMore) result = await reconstructPerformanceReadiness(client, {
        idempotencyKey, measurementFrom, measurementTo, actorUserId: actor.id, batchSize: 500, keyring,
      });
      return result;
    };
    const baseline = await runReadiness(`coverage-baseline-${suffix}`);
    const [withoutRelationship, withoutAssignment, archived, planned, outsidePeriod, multiAssignment,
      invalidRelationshipPeriod, invalidAssignmentPeriod] = await Promise.all([
      client.personnel.create({ data: { firstName: 'بدون', lastName: `رابطه ${suffix}` } }),
      client.personnel.create({ data: { firstName: 'بدون', lastName: `مأموریت ${suffix}` } }),
      client.personnel.create({ data: { firstName: 'بایگانی', lastName: suffix, isActive: false, archivedAt: new Date('2025-12-01T00:00:00.000Z') } }),
      client.personnel.create({ data: { firstName: 'برنامه', lastName: suffix } }),
      client.personnel.create({ data: { firstName: 'خارج', lastName: `بازه ${suffix}` } }),
      client.personnel.create({ data: { firstName: 'چند', lastName: `مأموریت ${suffix}` } }),
      client.personnel.create({ data: { firstName: 'رابطه', lastName: `بازه نامعتبر ${suffix}` } }),
      client.personnel.create({ data: { firstName: 'مأموریت', lastName: `بازه نامعتبر ${suffix}` } }),
    ]);
    const [withoutAssignmentRelationship, plannedRelationship, outsideRelationship, multiRelationship,
      invalidRelationship, invalidAssignmentRelationship] = await Promise.all([
      client.hrEmploymentRelationship.create({ data: {
        personnelId: withoutAssignment.id, status: 'ACTIVE', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), createdBy: 'coverage-test',
      } }),
      client.hrEmploymentRelationship.create({ data: {
        personnelId: planned.id, status: 'PLANNED', effectiveFrom: new Date('2026-02-01T00:00:00.000Z'), createdBy: 'coverage-test',
      } }),
      client.hrEmploymentRelationship.create({ data: {
        personnelId: outsidePeriod.id, status: 'ENDED', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
        effectiveTo: new Date('2025-12-01T00:00:00.000Z'), createdBy: 'coverage-test',
      } }),
      client.hrEmploymentRelationship.create({ data: {
        personnelId: multiAssignment.id, status: 'ACTIVE', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), createdBy: 'coverage-test',
      } }),
      client.hrEmploymentRelationship.create({ data: {
        personnelId: invalidRelationshipPeriod.id, status: 'ACTIVE', effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-02-01T00:00:00.000Z'), createdBy: 'coverage-test',
      } }),
      client.hrEmploymentRelationship.create({ data: {
        personnelId: invalidAssignmentPeriod.id, status: 'ACTIVE', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), createdBy: 'coverage-test',
      } }),
    ]);
    await client.hrEmploymentRelationship.create({ data: {
      personnelId: multiAssignment.id, status: 'PLANNED', effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), createdBy: 'coverage-test',
    } });
    await client.hrEmploymentAssignment.createMany({ data: [
      {
        employmentRelationshipId: multiRelationship.id, type: 'PRIMARY', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
        performanceAllocationPercent: '60.00', createdBy: 'coverage-test',
      },
      {
        employmentRelationshipId: multiRelationship.id, type: 'SECONDARY', effectiveFrom: new Date('2025-02-01T00:00:00.000Z'),
        performanceAllocationPercent: '40.00', createdBy: 'coverage-test',
      },
      {
        employmentRelationshipId: invalidAssignmentRelationship.id, type: 'PRIMARY', effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-02-01T00:00:00.000Z'), performanceAllocationPercent: '100.00', createdBy: 'coverage-test',
      },
    ] });

    const result = await runReadiness(`coverage-${suffix}`);

    assert.deepEqual({
      personnelCount: result.coverage.inventory.personnelCount - baseline.coverage.inventory.personnelCount,
      relationshipCount: result.coverage.inventory.relationshipCount - baseline.coverage.inventory.relationshipCount,
      assignmentCount: result.coverage.inventory.assignmentCount - baseline.coverage.inventory.assignmentCount,
    }, { personnelCount: 8, relationshipCount: 7, assignmentCount: 3 },
    'inventory totals count canonical records once even when Personnel has multiple assignments');
    assert.deepEqual({
      personnelCount: result.coverage.periodEligibility.personnelCount - baseline.coverage.periodEligibility.personnelCount,
      relationshipCount: result.coverage.periodEligibility.relationshipCount - baseline.coverage.periodEligibility.relationshipCount,
      assignmentCount: result.coverage.periodEligibility.assignmentCount - baseline.coverage.periodEligibility.assignmentCount,
    }, { personnelCount: 3, relationshipCount: 3, assignmentCount: 2 },
    'period eligibility remains separate from structural readiness');
    for (const [classification, expectedIncrease] of Object.entries({
      EMPLOYMENT_RELATIONSHIP_MISSING: 1, EMPLOYMENT_ASSIGNMENT_MISSING: 1, PERSONNEL_INACTIVE: 1,
      RELATIONSHIP_PLANNED: 2, RELATIONSHIP_OUTSIDE_PERIOD: 1,
      RELATIONSHIP_INTERVAL_INVALID: 1, ASSIGNMENT_INTERVAL_INVALID: 1,
    })) assert.equal(
      (result.coverage.inventoryClassifications[classification as PerformanceReadinessInventoryClassification] ?? 0)
        - (baseline.coverage.inventoryClassifications[classification as PerformanceReadinessInventoryClassification] ?? 0),
      expectedIncrease,
    );
    assert.equal(result.coverage.structuralTemplateReadiness.readyAssignmentCount, baseline.coverage.structuralTemplateReadiness.readyAssignmentCount);
    assert.equal(result.coverage.structuralTemplateReadiness.readyPersonnelCount, baseline.coverage.structuralTemplateReadiness.readyPersonnelCount);
    assert.equal(result.coverage.structuralTemplateReadiness.readyRelationshipCount, baseline.coverage.structuralTemplateReadiness.readyRelationshipCount);
    assert.equal(result.coverage.structuralTemplateReadiness.blockedSourceCount - baseline.coverage.structuralTemplateReadiness.blockedSourceCount, 6);
    assert.equal(result.coverage.structuralTemplateReadiness.failedSourceCount, baseline.coverage.structuralTemplateReadiness.failedSourceCount);
    assert.deepEqual(result.coverage.cohort, baseline.coverage.cohort);
    assert.deepEqual(result.coverage.acceptedResult, baseline.coverage.acceptedResult);
    assert.deepEqual(result.coverage.resultBadge, baseline.coverage.resultBadge);
    assert.equal(result.run.sourceCount - baseline.run.sourceCount, 10, 'every Personnel is represented while relationship and assignment leaves remain distinct');

    const completionAudit = await client.performanceAuditEvent.findFirstOrThrow({
      where: { aggregateType: 'READINESS_RUN', aggregateId: result.run.id, eventType: 'READINESS_COMPLETED' },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    const auditEvidence = await readPerformancePayload<{
      inventory: typeof result.coverage.inventory;
      inventoryClassifications: typeof result.coverage.inventoryClassifications;
      periodEligibility: typeof result.coverage.periodEligibility;
    }>(client, completionAudit.encryptedPayloadId!, keyring);
    assert.deepEqual(auditEvidence.inventory, result.coverage.inventory);
    assert.deepEqual(auditEvidence.inventoryClassifications, result.coverage.inventoryClassifications,
      'immutable completion evidence preserves every canonical missing-link and ineligibility classification');
    assert.deepEqual(auditEvidence.periodEligibility, result.coverage.periodEligibility);

    const records = await client.performanceReadinessRecord.findMany({ where: { runId: result.run.id } });
    const newAssignmentIds = new Set((await client.hrEmploymentAssignment.findMany({
      where: { employmentRelationshipId: multiRelationship.id }, select: { id: true },
    })).map(({ id }) => id));
    const newRecords = records.filter((record) => newAssignmentIds.has(record.employmentAssignmentId));
    assert.equal(newRecords.length, 2, 'only real period-eligible assignments use assignment readiness records');
    assert.ok(newRecords.every((record) => record.status === 'BLOCKED' && record.blockerCode === 'POSITION_MISSING'));
    const evaluationsBeforeInventory = await client.performanceEvaluation.count({ where: { createdByUserId: actor.id } });
    assert.equal(evaluationsBeforeInventory, 0, 'inventory rows never create scoreable evaluations');

    await client.personnel.create({ data: { firstName: 'رانش', lastName: suffix } });
    await assert.rejects(
      getPerformanceReadinessCoverage(client, { runId: result.run.id }),
      (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_READINESS_DRIFT',
      'completed coverage never mixes immutable run records with a changed live Personnel inventory',
    );
    assert.equal((await client.performanceReadinessRun.findUniqueOrThrow({ where: { id: result.run.id } })).status, 'DRIFTED');

    console.log('Personnel performance readiness coverage integration tests passed.');
  } finally {
    await client.$disconnect();
    await database.cleanup();
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
