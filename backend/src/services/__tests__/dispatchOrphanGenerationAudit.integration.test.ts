import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createDispatchDocumentRecoveryOperations, createDispatchDocumentFilesystem,
  createDurableDispatchRecoveryAuditPort, dispatchRecoveryIntegrityHash } from '../dispatchDocumentAuditRecovery';
import type { DispatchQuarantineFileReceipt } from '../dispatchQuarantineFileReceipt';

test('real local audit JSON preserves quarantine generation and refuses to manufacture legacy authorization', async () => {
  assert.equal(process.env.DISPATCH_ORPHAN_AUDIT_LOCAL_ACCEPTANCE, '1');
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55432');
  assert.match(url.pathname, /^\/qa_dispatch_orphan_[a-f0-9]{32}$/);
  assert.equal(url.searchParams.get('connection_limit'), '2'); assert.equal(url.searchParams.get('pool_timeout'), '5');
  const client = new PrismaClient();
  const runId = randomBytes(16).toString('hex'), actorId = 'orphan-audit-qa-' + runId;
  const fileReceipt: DispatchQuarantineFileReceipt = { format: 'sabalan-dispatch-quarantine/v1',
    operationId: 'a'.repeat(64), versionSha256: 'b'.repeat(64), moveReceiptSha256: 'c'.repeat(64) };
  try {
    for (const variant of ['current', 'legacy', 'malformed'] as const) {
      const storageKey = `dispatch-documents/orphan-audit-qa-${runId}-${variant}.pdf`;
      const aggregateId = dispatchRecoveryIntegrityHash({ storageKey });
      const authority = { effectiveAuthority: 'SYSTEM_RECOVERY_ADMIN', workspace: 'SYSTEM_RECOVERY' as const,
        feature: 'accounting_audit_view', permission: 'ADMIN' as const, subjectType: 'DISPATCH_DOCUMENT',
        subjectId: aggregateId, sessionId: runId, deviceId: 'isolated-local-qa', beforeHash: null, afterHash: null };
      await createDurableDispatchRecoveryAuditPort(client).append({ action: 'QUARANTINE_COMPLETED', actorId,
        correlationId: runId, idempotencyKey: runId + ':' + variant, occurredAt: '2026-10-01T00:00:00.000Z',
        storageKey, authority, reason: 'isolated local audit acceptance', detail: {
          quarantinedAt: '2026-10-01T00:00:00.000Z', reconciliationReportHash: 'd'.repeat(64),
          ...(variant === 'current' ? { fileReceipt } : variant === 'malformed' ? { fileReceipt: { versionSha256: 'e'.repeat(64) } } : {}),
        } });
      const persisted = await client.dispatchLifecycleAudit.findFirstOrThrow({ where: {
        aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId, eventType: 'QUARANTINE_COMPLETED',
      } });
      if (variant === 'current') assert.deepEqual((persisted.payload as any).detail.fileReceipt, fileReceipt);
      let received: DispatchQuarantineFileReceipt | null | undefined; let stages = 0; let finalized = 0;
      const stop = new Error('STOP_BEFORE_REAL_FILE_STAGING');
      const operations = createDispatchDocumentRecoveryOperations(client, createDispatchDocumentFilesystem(), {} as never, {
        orphanStorage: async () => ({ read: async () => null, quarantine: async () => fileReceipt,
          restoreQuarantined: async () => {}, restoreStagedCleanup: async () => {},
          stageCleanup: async (key, evidence) => { assert.equal(key, storageKey); received = evidence; stages += 1; throw stop; },
          finalizeCleanup: async () => { finalized += 1; },
        }),
      });
      await assert.rejects(operations.cleanup({ storageKey, actorId, reason: 'isolated local audit acceptance',
        correlationId: runId, idempotencyKey: runId + ':cleanup:' + variant, authority,
        now: new Date('2026-10-19T00:00:00.000Z') }), stop);
      assert.equal(stages, 1); assert.equal(finalized, 0);
      assert.deepEqual(received, variant === 'current' ? fileReceipt : null);
      const rows = await client.dispatchLifecycleAudit.findMany({ where: { aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
      assert.equal(rows.length, 2); assert.equal(rows[1]!.previousHash, rows[0]!.eventHash);
      assert.equal(rows[1]!.eventType, 'CLEANUP_INTENT_RECORDED');
      assert.equal(rows.every(row => row.actorId === actorId), true);
    }
  } finally {
    await client.$disconnect();
  }
});
