import assert from 'node:assert/strict';
import { prisma } from '../../lib/prisma';
import { createContractLifecycleRequest, decideContractLifecycleRequest, executeContractLifecycleAction, getContractLifecyclePreview, ContractLifecycleBlockedError } from '../contractLifecycleService';
import { partnerContractWasDeleted } from '../partnerSales/cases/operationalDeletion';
import { createAuditedPartnerAuthorization } from '../partnerSales/authorization/audited';
async function main() {
  const ids = JSON.parse(process.env.PARTNER_LIFECYCLE_TEST_IDS!);
  const input = { contractId: ids.contractId, actorId: ids.partnerId, reason: 'آزمون مدیریت وضعیت همکار', partnerLifecycle: true };
  assert.equal((await getContractLifecyclePreview(ids.contractId, true)).deleteEligibility.eligible, true);
  const before = await prisma.partnerCaseRevision.findMany({ where: { caseId: ids.caseId } });
  const request = await createContractLifecycleRequest({ ...input, kind: 'DEACTIVATE' });
  await decideContractLifecycleRequest({ requestId: request.id, decision: 'APPROVE', actorId: ids.partnerId });
  assert.equal((await prisma.salesContract.findUniqueOrThrow({ where: { id: ids.contractId } })).isInactive, true);
  await executeContractLifecycleAction({ ...input, action: 'REACTIVATE' });
  assert.equal((await prisma.salesContract.findUniqueOrThrow({ where: { id: ids.contractId } })).isInactive, false);
  const invoice = await prisma.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE', status: 'DRAFT', sourceKind: 'PARTNER_INTERNAL_RECORD', sourceId: ids.internalId, createdBy: ids.partnerId } });
  await assert.rejects(() => executeContractLifecycleAction({ ...input, action: 'DELETE' }), (error: unknown) => error instanceof ContractLifecycleBlockedError && error.blockers.some(row => row.code === 'FINANCIAL_DOCUMENTS' && row.details?.some(detail => detail.id === invoice.id)));
  await assert.rejects(() => executeContractLifecycleAction({ ...input, action: 'DEACTIVATE' }), (error: unknown) => error instanceof ContractLifecycleBlockedError && error.blockers.some(row => row.code === 'OPEN_FINANCIAL_WORKFLOWS'));
  await prisma.accountingFinancialRecord.delete({ where: { id: invoice.id } });
  // A deliberately retained legacy shipment record proves the independent
  // reader blocks deletion even if an earlier import violated source ownership.
  const delivery = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    return tx.delivery.create({ data: { contractId: ids.contractId, deliveryDate: new Date(), deliveryAddress: 'isolated test', status: 'DELIVERED' } });
  });
  await assert.rejects(() => executeContractLifecycleAction({ ...input, action: 'DELETE' }), (error: unknown) => error instanceof ContractLifecycleBlockedError && error.blockers.some(row => row.code === 'CONCLUSIVE_PHYSICAL_OPERATIONS'));
  await prisma.delivery.delete({ where: { id: delivery.id } });
  const deleted = await executeContractLifecycleAction({ ...input, action: 'DELETE' });
  assert.equal('deleted' in deleted && deleted.deleted, true);
  assert.equal(await partnerContractWasDeleted(prisma, ids.contractId), true);
  assert.deepEqual(await prisma.partnerCaseRevision.findMany({ where: { caseId: ids.caseId } }), before);
  assert.ok(await prisma.partnerSaleCase.findUnique({ where: { id: ids.caseId } }));
  await assert.rejects(() => executeContractLifecycleAction({ ...input, action: 'REACTIVATE' }), /Contract not found/);
  await prisma.$transaction(async tx => {
    const decision = await createAuditedPartnerAuthorization(tx, { actorId: ids.partnerId, purpose: 'PARTNER', channel: 'API' }, { correlationId: 'deleted-case-test' }).authorize('CASE_READ', { kind: 'CASE', id: ids.caseId });
    assert.equal(decision.ok, false); if (!decision.ok) assert.equal(decision.error.code, 'NOT_FOUND');
  });
  assert.equal(await prisma.accountingAuditLog.count({ where: { contractId: ids.contractId, action: 'CONTRACT_DELETE' } }), 1);
}
main().finally(() => prisma.$disconnect());
