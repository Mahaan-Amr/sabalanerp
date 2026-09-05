import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPerformancePolicyDraft } from '../personnelPerformancePolicyStore';
import { prisma } from '../../lib/prisma';
import { resolvePersonnelPerformanceWriteGate } from '../personnelPerformanceRolloutPolicy';

const rollback = Symbol('rollback-performance-operations');
const main = async () => {
  await assert.rejects(() => createPerformancePolicyDraft(prisma, {
    policyKind: 'RETENTION', content: { schemaVersion: 1 }, createdByUserId: 'never-persist-invalid-policy',
  }), (error: { code?: string }) => error.code === 'PERFORMANCE_POLICY_VALIDATION_FAILED');
  try {
    await prisma.$transaction(async (tx) => {
      const suffix = randomUUID();
      const actor = await tx.user.create({ data: {
        email: `operations-${suffix}@example.invalid`, username: `operations-${suffix}`,
        password: 'not-used', firstName: 'عامل', lastName: 'آزمون',
      } });
      const latest = await tx.performanceFeaturePhaseVersion.findFirst({ orderBy: { version: 'desc' } });
      const previous = await tx.performanceFeaturePhaseVersion.create({ data: {
        version: (latest?.version ?? 0) + 1, phase: 'POLICY_DARK_LAUNCH', releaseEnabled: true,
        effectiveFrom: new Date('2099-01-01Z'), reason: 'Isolated operations acceptance', recordedByUserId: actor.id,
      } });
      await tx.performanceSafetyPause.create({ data: {
        phaseVersionId: previous.id, scope: 'ALL', reasonCode: 'INTEGRITY_MISMATCH',
        reason: 'Isolated operations acceptance', startedByUserId: actor.id,
      } });
      await tx.performanceFeaturePhaseVersion.create({ data: {
        version: previous.version + 1, predecessorId: previous.id, phase: 'POLICY_DARK_LAUNCH', releaseEnabled: true,
        effectiveFrom: new Date('2099-01-02Z'), reason: 'Isolated next phase', recordedByUserId: actor.id,
      } });
      assert.deepEqual(await resolvePersonnelPerformanceWriteGate(tx, 'MANAGE_POLICY', new Date('2099-01-03Z')),
        { allowed: false, reason: 'SAFETY_PAUSED' }, 'a new phase must not hide an unresolved global safety pause');
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
};
main().finally(() => prisma.$disconnect());
