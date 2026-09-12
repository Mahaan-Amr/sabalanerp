import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { mandatoryReleaseDeploymentGateNames } from '../deploymentGates';

function databaseUrl() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local database required');
  }
  return url.toString();
}

test('release readiness publication is insert-only on the real schema', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()),
    sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client(), id = `deploy-partner-release-${temporary.runId}`;
  try {
    const now = new Date(), expiresAt = new Date(now.getTime() + 15 * 60_000);
    await database.deploymentOperation.create({ data: { id, releaseId: id, targetCommit: 'a'.repeat(40),
      owner: 'release-owner', phase: 'COMPLETED', leaseToken: `${id}-lease`, leaseExpiresAt: expiresAt,
      heartbeatAt: now, startedAt: now, completedAt: now, reportJson: { format: 'sabalan-deployment-report',
        version: 1, mode: 'RELEASE', deploymentId: id, releaseId: id, targetCommit: 'a'.repeat(40),
        gates: mandatoryReleaseDeploymentGateNames.map(name => ({ name, passed: true })) } } });
    await database.partnerReleaseReadinessPublication.create({ data: { id, deploymentId: id, releaseId: id,
      targetCommit: 'a'.repeat(40), schemaId: 'partner-schema-v1', checkedAt: now, expiresAt,
      packageSha256: 'b'.repeat(64), trustEnvelopeSha256: 'c'.repeat(64), trustKeyId: 'offline-2026',
      packageBytesBase64: 'e30=', trustEnvelopeBytesBase64: 'e30=',
      evidenceJson: { source: 'DATABASE_VERIFIED', evidenceId: id } } });
    await database.$transaction(async tx => {
      await tx.$executeRawUnsafe('SAVEPOINT release_evidence_update');
      await assert.rejects(tx.partnerReleaseReadinessPublication.update({ where: { id },
        data: { trustKeyId: 'forged-key' } }), /immutable|append-only/i);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT release_evidence_update');
      await tx.$executeRawUnsafe('SAVEPOINT release_evidence_delete');
      await assert.rejects(tx.partnerReleaseReadinessPublication.delete({ where: { id } }), /immutable|append-only/i);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT release_evidence_delete');
    });
    assert.equal(await database.partnerReleaseReadinessPublication.count({ where: { id } }), 1);
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
