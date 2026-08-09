import assert from 'node:assert/strict';
import { PrismaDispatchDocumentRepository } from '../dispatchDocuments/prismaRepository';

const writes: string[] = [];
const tx = {
  $executeRawUnsafe: async () => 1,
  dispatchCutoverControl: { findUnique: async () => ({ phase: 'CANONICAL_LIVE' }) },
  dispatchDocumentCommandResult: { findUnique: async () => null, create: async () => { writes.push('command'); return {}; } },
  accountingDispatchCandidate: {
    findUnique: async () => ({ id: 'candidate-1', status: 'PENDING', allocationRevisionId: 'revision-1', workItem: { id: 'work-1' } }),
    update: async ({ data }: any) => { writes.push(`candidate:${data.status}`); return {}; },
  },
  accountingDispatchWorkItem: { update: async () => { writes.push('work-item:COMPLETED'); return {}; } },
  shipmentStatementCutover: { findUnique: async () => ({ enabled: true, cutoverAt: new Date('2026-08-09T00:00:00.000Z') }) },
  logisticsAllocationRevision: { findUnique: async () => ({ finalizedAt: new Date('2026-08-10T00:00:00.000Z') }) },
  accountingDispatchWaybill: { create: async () => { writes.push('WAYBILL_CREATED'); throw new Error('stale candidate must not issue'); } },
  dispatchLifecycleAudit: { findFirst: async () => null, create: async () => { writes.push('audit'); return {}; } },
};
const prisma = { $transaction: async (work: any) => work(tx) } as any;

const run = async () => {
  const previous = process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED;
  process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED = 'true';
  try {
    const repository = new PrismaDispatchDocumentRepository(prisma, { assess: async () => ({
      status: 'STALE_REQUIRES_SUCCESSOR', staleContracts: [{ contractId: 'contract-1', boundPricingVersionId: 'price-1', currentPricingVersionId: 'price-2' }],
    }) });
    const result = await repository.acceptAndIssue({ candidateId: 'candidate-1', allocationRevisionId: 'revision-1',
      expectedSourceIntegrityHash: 'source-hash', waybillSnapshot: {}, waybill: { id: 'waybill-1', number: '1',
        status: 'ISSUED', issuedAt: '2026-08-10T01:00:00.000Z', replacesWaybillId: null }, artifacts: [],
      idempotencyKey: 'accept-1', actorId: 'accountant', correlationId: 'correlation-1' });
    assert.equal(result.status, 'STALE_REQUIRES_SUCCESSOR');
    assert.deepEqual(writes, ['candidate:STALE_REQUIRES_SUCCESSOR', 'work-item:COMPLETED', 'command', 'audit']);
    assert.equal(writes.includes('WAYBILL_CREATED'), false);
  } finally {
    if (previous === undefined) delete process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED;
    else process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED = previous;
  }
};
run().then(() => console.log('dispatch document stale transaction behavior tests passed'));
