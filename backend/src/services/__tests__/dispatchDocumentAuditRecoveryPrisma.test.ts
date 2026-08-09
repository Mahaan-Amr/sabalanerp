import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  createPrismaDispatchArtifactAuditPort,
  listDispatchDocumentRecoveryAudit,
  type DispatchArtifactAuditEvent,
} from '../dispatchDocumentAuditRecovery';

const databaseUrl = process.env.DATABASE_URL?.trim();

test('Prisma recovery audit adapter appends a hash-linked queryable chain and rolls back cleanly', {
  skip: databaseUrl ? false : 'DATABASE_URL is required for Prisma integration coverage',
}, async () => {
  const prisma = new PrismaClient();
  const aggregateId = `recovery-test-${Date.now()}`;
  try {
    await assert.rejects(prisma.$transaction(async tx => {
      const audit = createPrismaDispatchArtifactAuditPort(tx);
      const base: Omit<DispatchArtifactAuditEvent, 'action' | 'occurredAt'> = {
        actorId: 'integration-support', correlationId: aggregateId, idempotencyKey: `${aggregateId}:reconcile`,
        artifactId: aggregateId, storageKey: 'integration/original.pdf', reason: 'integration rollback proof', detail: {},
      };
      await audit.append({ ...base, action: 'RECONCILIATION_COMPLETED', occurredAt: '2026-08-09T08:00:00.000Z' });
      await audit.append({ ...base, action: 'INCIDENT_RECORDED', occurredAt: '2026-08-09T08:00:01.000Z', idempotencyKey: `${aggregateId}:incident` });
      const report = await listDispatchDocumentRecoveryAudit(tx, { aggregateId, pageSize: 10 });
      assert.equal(report.total, 2);
      const rows = report.items as Array<{ previousHash: string | null; eventHash: string; eventType: string }>;
      assert.deepEqual(rows.map(row => row.eventType), ['INCIDENT_RECORDED', 'RECONCILIATION_COMPLETED']);
      assert.equal(rows[0].previousHash, rows[1].eventHash);
      assert.match(rows[0].eventHash, /^[a-f0-9]{64}$/);
      throw new Error('ROLLBACK_DISPATCH_RECOVERY_TEST');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), /ROLLBACK_DISPATCH_RECOVERY_TEST/);
    assert.equal(await prisma.dispatchLifecycleAudit.count({ where: { aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId } }), 0);
  } finally {
    await prisma.$disconnect();
  }
});
