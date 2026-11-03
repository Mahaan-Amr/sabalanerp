import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { executeAccountingAction } from '../accountingService';
import { buildLegacyContractMigrationPlan, CURRENT_CONTRACT_PRODUCT_POLICY_V3 } from '../contractProductGraphMigration';
import { hasConflictingPartnerAccountingEvidence } from '../partnerSales/accounting/provenance';

const target = new URL(process.env.DATABASE_URL || '');
assert(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '55432'
  && target.pathname === '/sabalanerp_approval_replay_20261102', 'Refusing non-isolated database');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function run() {
  const id = randomUUID();
  const user = await prisma.user.create({ data: { id, email: `${id}@example.invalid`, username: id,
    password: 'test-only-no-login', firstName: 'Test', lastName: 'Actor', role: 'ADMIN', isActive: true } });
  const customer = await prisma.crmCustomer.create({ data: { firstName: 'Test', lastName: 'Customer' } });
  const department = await prisma.department.create({ data: { name: id, namePersian: id } });
  const product = await prisma.product.create({ data: { code: id, name: id, namePersian: id,
    cuttingDimensionCode: 'test', cuttingDimensionName: 'test', cuttingDimensionNamePersian: 'test',
    stoneTypeCode: 'test', stoneTypeName: 'test', stoneTypeNamePersian: 'test', widthCode: 'test',
    widthValue: 40, widthName: 'test', thicknessCode: 'test', thicknessValue: 2, thicknessName: 'test',
    mineCode: 'test', mineName: 'test', mineNamePersian: 'test', finishCode: 'test', finishName: 'test',
    finishNamePersian: 'test', colorCode: 'test', colorName: 'test', colorNamePersian: 'test',
    qualityCode: 'test', qualityName: 'test', qualityNamePersian: 'test', images: [] } });
  const rowId = `contract-row-${randomUUID()}`;
  const row = { rowId, productId: product.id, productType: 'longitudinal', length: 3, width: 40, quantity: 2,
    squareMeters: 2.4, totalPrice: 24000, originalTotalPrice: 24000, stoneName: 'Synthetic', lengthUnit: 'm',
    widthUnit: 'cm', pricePerSquareMeter: 10000, cuttingCost: 0, totalSubServiceCost: 0, finishingCost: 0,
    isMandatory: false, isCut: false, meta: { isLayer: false }, longitudinalPolicyInput: {
      calculationPolicyVersion: 'calculation-v1', packingPolicyVersion: 'packing-v1', pricingPolicyVersion: 'pricing-v1',
      roundingPolicyVersion: 'rounding-v1', sourceBatchId: `${rowId}:batch`, motherWidthMeters: '0.4', widthMeters: '0.4',
      lengthMeters: '3', quantity: 2, lastManualField: 'quantity', lastManualDimension: 'length', lengthDisplayUnit: 'm',
      widthDisplayUnit: 'cm', baseRateToman: '10000', mandatoryEnabled: false, mandatoryPercentage: '20',
      rememberedMandatoryPercentage: '20', sawKerfEnabled: false, sawKerfMeters: '0.003', calibrationEnabled: false,
      calibrationSelection: 'automatic', longitudinalCutRateToman: '0', calibrationCutRateToman: '0' } };
  const contractId = randomUUID();
  const project = await prisma.projectAddress.create({ data: { customerId: customer.id, address: 'Synthetic', projectName: id } });
  const data = { contractKind: 'collaboration', projectId: project.id, customerId: customer.id,
    customer: { id: customer.id, firstName: customer.firstName, lastName: customer.lastName },
    project: { id: project.id, address: project.address }, products: [row], serviceRows: [],
    discount: { enabled: false, baseSubtotal: '24000', amount: '0', percent: '0', currency: 'تومان' },
    payment: { currency: 'تومان', totalContractAmount: 24000 } };
  const plan = buildLegacyContractMigrationPlan({ id: contractId, totalAmount: '24000', contractData: data },
    1, CURRENT_CONTRACT_PRODUCT_POLICY_V3, true);
  assert(plan.ok, JSON.stringify(plan));
  await prisma.salesContract.create({ data: { id: contractId, contractNumber: id, title: id, titlePersian: id,
    content: '', status: 'SIGNED', customerId: customer.id, departmentId: department.id, createdBy: user.id,
    responsibleSellerId: user.id, totalAmount: '24000', currency: 'تومان', contractData: json(data),
    items: { create: [{ productId: product.id, productRowId: rowId, productType: 'longitudinal', quantity: 2,
      unitPrice: '10000', totalPrice: '24000' }] },
    productGraphState: { create: { schemaVersion: plan.graph.schemaVersion, revision: plan.graph.revision,
      graph: json(plan.graph), policySnapshot: json(CURRENT_CONTRACT_PRODUCT_POLICY_V3), inputHash: plan.provenanceHash,
      resultHash: plan.provenanceHash, totalAmountToman: '24000' } } } });
  const actor = { userId: id, role: 'ADMIN', effectiveAuthority: { actorRole: 'ADMIN', workspace: 'accounting',
    workspacePermission: 'admin', feature: 'accounting_records_approve_void', featurePermission: 'edit' } };
  const created = await executeAccountingAction({ kind: 'CREATE_INVOICE', contractId, mode: 'FROM_CONTRACT_TOTAL',
    idempotencyKey: `${id}:create` }, actor);
  const invoiceId = (created.affected as { financialRecordIds: string[] }).financialRecordIds[0];
  const invoice = await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: invoiceId } });
  assert.equal(hasConflictingPartnerAccountingEvidence(invoice), false,
    'the production-created ordinary snapshot must pass the provenance guard without modification');
  const command = { kind: 'APPROVE_FINANCIAL_INVOICE', invoiceId, systemInvoiceNumber: id,
    systemInvoiceDate: new Date().toISOString().slice(0, 10), sepidarAmount: invoice.amount.toString(),
    idempotencyKey: `${id}:approval`, correlationId: `${id}:first` };
  const [first, second] = await Promise.all([
    executeAccountingAction(command, actor),
    executeAccountingAction({ ...command, correlationId: `${id}:concurrent` }, actor),
  ]);
  assert.deepEqual(second, first, 'same request after a lost response must return the original result');
  await assert.rejects(executeAccountingAction({ ...command, note: 'changed payload' }, actor));
  await assert.rejects(executeAccountingAction(command, { ...actor, userId: randomUUID() }),
    'a different actor must not receive the stored outcome');
  await assert.rejects(executeAccountingAction({ ...command, idempotencyKey: `${id}:other` }, actor));
  await prisma.accountingFinancialRecord.update({ where: { id: invoiceId }, data: { status: 'POSTED' } });
  const afterStatusChange = await executeAccountingAction({ ...command, correlationId: `${id}:later` }, actor);
  assert.deepEqual(afterStatusChange, first, 'replay returns the recorded outcome after subsequent status change');
  const savedInvoice = await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: invoiceId } });
  assert.deepEqual(savedInvoice.sourceSnapshot, invoice.sourceSnapshot, 'approval preserves the original provenance snapshot');
  const audits = await prisma.accountingAuditLog.count({ where: { entityId: invoiceId, action: command.kind } });
  assert.equal(audits, 1, 'replay must not create another financial approval audit');
}
run().finally(() => prisma.$disconnect());
