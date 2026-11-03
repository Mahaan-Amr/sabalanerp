import assert from 'node:assert/strict';
import { decideAccountingDispatchCandidate, installDispatchDocumentsCommands,
  replaceAccountingDispatchWaybill, voidAccountingDispatchWaybill } from '../dispatchAllocation';

const calls: string[] = [];
installDispatchDocumentsCommands({
  decideCandidate: async input => { calls.push(`decision:${input.candidateId}`); return { candidateId: input.candidateId, status: 'ACCEPTED', waybill: null }; },
  voidWaybill: async input => { calls.push(`void:${input.waybillId}`); return { id: input.waybillId, status: 'VOIDED' }; },
  replaceWaybill: async input => { calls.push(`replace:${input.waybillId}`); return { id: input.waybillId, status: 'REPLACED' }; },
});
const prisma = {
  accountingDispatchCandidate: { findUnique: async () => ({ allocationRevision: { finalizedAt: new Date('2026-08-10T00:00:00.000Z') } }) },
  accountingDispatchWaybill: { findUnique: async () => ({ candidateId: 'candidate-1' }) },
  shipmentStatementCutover: { findUnique: async () => ({ cutoverAt: new Date('2026-08-09T00:00:00.000Z') }) },
} as any;

const run = async () => {
  await decideAccountingDispatchCandidate(prisma, { candidateId: 'candidate-1', action: 'ACCEPT', idempotencyKey: 'accept-1', actorId: 'accountant' });
  await voidAccountingDispatchWaybill(prisma, { waybillId: 'waybill-1', reason: 'void', idempotencyKey: 'void-1', actorId: 'accountant', effectiveAuthority: {} });
  await replaceAccountingDispatchWaybill(prisma, { waybillId: 'waybill-1', reason: 'replace', idempotencyKey: 'replace-1', actorId: 'accountant', effectiveAuthority: {} });
  assert.deepEqual(calls, ['decision:candidate-1', 'void:waybill-1', 'replace:waybill-1']);
};
run().then(() => console.log('dispatch document canonical delegation tests passed'));
