import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { approveOrdinarySales } from '../ordinaryContractLifecycle';
import { assertContractOperationMinimums, OperationMinimumError } from '../operationMinimumGuard';

const url = process.env.OPERATION_MINIMUM_TEST_DATABASE_URL;
assert.ok(url, 'OPERATION_MINIMUM_TEST_DATABASE_URL must target the existing sabalanerp-local database');
const location = new URL(url);
assert.ok(['127.0.0.1', 'localhost'].includes(location.hostname) && location.port === '55432' && location.pathname === '/sabalanerp',
  'Minimum integration QA must use the existing sabalanerp-local database');
const database = new PrismaClient({ datasources: { db: { url } } });
class RollbackFixture extends Error {}
async function main() {
try {
  await assert.rejects(database.$transaction(async tx => {
    const source = await tx.salesContract.findFirst({ where: { partnerKind: null, partnerCaseId: null } });
    assert.ok(source, 'Existing local fixture contract required for identities');
    const token = randomUUID();
    const tool = await tx.subService.create({ data: { code: `QA-MIN-${token}`, namePersian: 'ابزار آزمون حداقل',
      pricePerMeter: 100, calculationBase: 'length', minimumQuantity: 300 } });
    const rows = ['a', 'b', 'c'].map(id => ({ id, sourceType: 'tool', sourceId: tool.id, unit: 'meter', quantity: 100 }));
    const contract = await tx.salesContract.create({ data: { contractNumber: `QA-MIN-${token}`, title: 'Minimum isolated QA',
      titlePersian: 'آزمون حداقل عملیات', content: 'QA', customerId: source.customerId, departmentId: source.departmentId,
      createdBy: source.createdBy, responsibleSellerId: source.responsibleSellerId, totalAmount: 30000, currency: 'IRT',
      status: 'DRAFT', commercialFlowVersion: 1, commercialRevision: 1, commercialExpiresAt: new Date('2099-01-01'),
      contractData: { serviceRows: rows.slice(0, 2) } } });
    await assert.rejects(approveOrdinarySales(tx, contract.id, source.createdBy, undefined, 1), error =>
      error instanceof OperationMinimumError && error.details[0].deficitQuantity === '100');
    assert.equal((await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } })).salesApprovalRevision, null);
    await tx.salesContract.update({ where: { id: contract.id }, data: { contractData: { serviceRows: rows } } });
    const approved = await approveOrdinarySales(tx, contract.id, source.createdBy, undefined, 1);
    assert.equal(approved.salesApprovalRevision, 1);
    await tx.subService.update({ where: { id: tool.id }, data: { minimumQuantity: 350 } });
    assert.equal((await approveOrdinarySales(tx, contract.id, source.createdBy, undefined, 1)).salesApprovalRevision, 1,
      'Idempotent approval retains prior commercial agreement');
    await tx.salesContract.update({ where: { id: contract.id }, data: { commercialRevision: 2, salesApprovalRevision: null, status: 'DRAFT' } });
    await assert.rejects(approveOrdinarySales(tx, contract.id, source.createdBy, undefined, 2), OperationMinimumError);
    await tx.subService.update({ where: { id: tool.id }, data: { minimumQuantity: null } });
    await assertContractOperationMinimums(tx, contract.id);
    throw new RollbackFixture();
  }, { timeout: 30000 }), RollbackFixture);
  console.log('Operation minimum local transaction integration passed; fixtures rolled back.');
} finally { await database.$disconnect(); }

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
