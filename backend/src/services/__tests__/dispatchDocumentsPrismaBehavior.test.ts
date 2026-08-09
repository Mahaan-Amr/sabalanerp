import assert from 'node:assert/strict';
import { PrismaDispatchDocumentRepository } from '../dispatchDocuments/prismaRepository';
import { DispatchDocumentEvidenceConflictError } from '../dispatchDocuments/service';

const writes: string[] = [];
const advisoryLocks: string[] = [];
let replacementMode = false;
const tx = {
  $executeRawUnsafe: async (_query: string, key: string) => { advisoryLocks.push(key); return 1; },
  $queryRawUnsafe: async () => [],
  dispatchCutoverControl: { findUnique: async () => ({ phase: 'CANONICAL_LIVE' }) },
  dispatchDocumentCommandResult: { findUnique: async () => null, create: async () => { writes.push('command'); return {}; } },
  accountingDispatchCandidate: {
    findUnique: async () => replacementMode
      ? ({ id: 'candidate-1', status: 'ACCEPTED', allocationRevisionId: 'revision-1', allocationRevision: { finalizedAt: new Date('2026-08-10T00:00:00.000Z') } })
      : ({ id: 'candidate-1', status: 'PENDING', allocationRevisionId: 'revision-1', workItem: { id: 'work-1' } }),
    update: async ({ data }: any) => { writes.push(`candidate:${data.status}`); return {}; },
  },
  accountingDispatchWorkItem: { update: async () => { writes.push('work-item:COMPLETED'); return {}; } },
  shipmentStatementCutover: { findUnique: async () => ({ enabled: true, cutoverAt: new Date('2026-08-09T00:00:00.000Z') }) },
  logisticsAllocationRevision: { findUnique: async () => ({ finalizedAt: new Date('2026-08-10T00:00:00.000Z') }) },
  logisticsAllocationRevisionPricing: { findMany: async () => [{ contractId: 'contract-b' }, { contractId: 'contract-a' }] },
  accountingDispatchWaybill: {
    findUnique: async () => replacementMode ? ({ id: 'waybill-old', status: 'ISSUED', candidateId: 'candidate-1',
      physicalExit: null, manualOutageExit: null, replacementWaybill: null }) : null,
    create: async () => { writes.push('WAYBILL_CREATED'); throw new Error('stale evidence must not issue'); },
  },
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
      idempotencyKey: 'accept-1', actorId: 'accountant', correlationId: 'correlation-1', intentFingerprint: 'intent-1' });
    assert.equal(result.status, 'STALE_REQUIRES_SUCCESSOR');
    assert.deepEqual(writes, ['candidate:STALE_REQUIRES_SUCCESSOR', 'work-item:COMPLETED', 'command', 'audit']);
    assert.equal(writes.includes('WAYBILL_CREATED'), false);
    assert.deepEqual(advisoryLocks.filter(key => key.startsWith('APPROVED_PRICING_HEAD:')),
      ['APPROVED_PRICING_HEAD:contract-a', 'APPROVED_PRICING_HEAD:contract-b']);

    writes.length = 0;
    const conflictingRepository = new PrismaDispatchDocumentRepository(prisma, { assess: async () => {
      throw new DispatchDocumentEvidenceConflictError('malformed priced evidence');
    } });
    const conflict = await conflictingRepository.acceptAndIssue({ candidateId: 'candidate-1', allocationRevisionId: 'revision-1',
      expectedSourceIntegrityHash: 'source-hash', waybillSnapshot: {}, waybill: { id: 'waybill-2', number: '2',
        status: 'ISSUED', issuedAt: '2026-08-10T01:00:00.000Z', replacesWaybillId: null }, artifacts: [],
      idempotencyKey: 'accept-conflict', actorId: 'accountant', correlationId: 'correlation-2', intentFingerprint: 'intent-2' });
    assert.equal(conflict.status, 'EVIDENCE_CONFLICT');
    assert.deepEqual(writes, ['candidate:EVIDENCE_CONFLICT', 'work-item:COMPLETED', 'command', 'audit']);

    replacementMode = true;
    advisoryLocks.length = 0;
    await assert.rejects(() => repository.replaceWaybill({ waybillId: 'waybill-old', allocationRevisionId: 'revision-1',
      expectedSourceIntegrityHash: 'source-hash', waybillSnapshot: {}, replacement: { id: 'waybill-new', number: '2',
        status: 'ISSUED', issuedAt: '2026-08-10T01:00:00.000Z', replacesWaybillId: 'waybill-old' }, artifacts: [],
      reason: 'replace', idempotencyKey: 'replace-1', actorId: 'accountant', correlationId: 'replace-1',
      authority: {}, intentFingerprint: 'replace-intent' }), /Stale priced evidence/);
    assert.deepEqual(advisoryLocks.filter(key => key.startsWith('APPROVED_PRICING_HEAD:')),
      ['APPROVED_PRICING_HEAD:contract-a', 'APPROVED_PRICING_HEAD:contract-b'],
      'replacement locks the same deterministic approved-pricing heads before freshness assessment');
  } finally {
    if (previous === undefined) delete process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED;
    else process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED = previous;
  }
};
run().then(() => console.log('dispatch document stale transaction behavior tests passed'));
