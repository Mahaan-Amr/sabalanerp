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
        authority: { effectiveAuthority: 'SYSTEM_RECOVERY_ADMIN', workspace: 'SYSTEM_RECOVERY', feature: 'accounting_audit_view', permission: 'ADMIN', subjectType: 'DISPATCH_DOCUMENT', subjectId: aggregateId, sessionId: 'integration-session', deviceId: 'integration-device', beforeHash: null, afterHash: null },
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

test('per-aggregate advisory lock prevents a two-connection audit fork', {
  skip: databaseUrl ? false : 'DATABASE_URL is required for Prisma integration coverage',
}, async () => {
  const left = new PrismaClient(); const right = new PrismaClient();
  const aggregateId = `recovery-concurrency-${Date.now()}`;
  const authority = { effectiveAuthority: 'SYSTEM_RECOVERY_ADMIN', workspace: 'SYSTEM_RECOVERY' as const, feature: 'accounting_audit_view', permission: 'ADMIN' as const, subjectType: 'DISPATCH_DOCUMENT', subjectId: aggregateId, sessionId: 'integration-session', deviceId: 'integration-device', beforeHash: null, afterHash: null };
  const append = (client: PrismaClient, suffix: string) => client.$transaction(async tx => {
    await createPrismaDispatchArtifactAuditPort(tx).append({ action: 'INCIDENT_RECORDED', actorId: 'integration-support', correlationId: aggregateId,
      idempotencyKey: `${aggregateId}:${suffix}`, artifactId: aggregateId, storageKey: 'integration/original.pdf', reason: 'concurrency proof', authority,
      occurredAt: new Date().toISOString(), detail: { suffix } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  try {
    await Promise.all([append(left, 'left'), append(right, 'right')]);
    const rows = await left.dispatchLifecycleAudit.findMany({ where: { aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
    assert.equal(rows.length, 2);
    assert.equal(rows.filter(row => row.previousHash === null).length, 1);
    const root = rows.find(row => row.previousHash === null)!;
    assert.equal(rows.find(row => row.id !== root.id)?.previousHash, root.eventHash);
  } finally {
    await left.dispatchLifecycleAudit.deleteMany({ where: { aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId } });
    await Promise.all([left.$disconnect(), right.$disconnect()]);
  }
});
