import assert from 'node:assert/strict';
import {
  AccountingRecordStatus,
  ContractStatus,
  CorrectionRequestCategory,
  CorrectionRequestStatus,
  FinancialRecordKind,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { executeAccountingAction } from '../accountingService';

const prisma = new PrismaClient();
const token = `snapshot-boundary-${Date.now()}`;
let contractId: string | null = null;

const record = (value: unknown): Record<string, any> => {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, any>;
};

const assertBoundedSnapshot = (value: unknown) => {
  const snapshot = record(value);
  const contractData = record(snapshot.contractData);
  const customer = record(contractData.customer);
  const rootCustomer = record(snapshot.customer);

  assert.equal(customer.salesContracts, undefined);
  assert.equal(customer.communications, undefined);
  assert.equal(customer.primaryContact?.communicationHistory, undefined);
  assert.equal(customer.primaryContact?.customer, undefined);
  assert.equal(rootCustomer.salesContracts, undefined);
  assert.equal(rootCustomer.id, customer.id);
  assert(Array.isArray(snapshot.items) && snapshot.items.length > 0);
  assert(Buffer.byteLength(JSON.stringify(snapshot), 'utf8') < 200_000);
};

const cleanup = async () => {
  if (!contractId) return;
  const financialRecords = await prisma.accountingFinancialRecord.findMany({
    where: { contractId },
    select: { id: true },
  });
  const financialRecordIds = financialRecords.map(item => item.id);
  await prisma.accountingPaymentStatus.deleteMany({ where: { contractId } });
  await prisma.accountingReceivable.deleteMany({ where: { contractId } });
  await prisma.accountingTaxRecord.deleteMany({ where: { contractId } });
  await prisma.accountingInvoiceCandidateItem.deleteMany({ where: { invoiceId: { in: financialRecordIds } } });
  await prisma.accountingAuditLog.deleteMany({ where: { contractId } });
  await prisma.accountingCorrectionRequest.deleteMany({ where: { contractId } });
  await prisma.accountingFinancialRecord.deleteMany({ where: { contractId } });
  await prisma.salesContract.deleteMany({ where: { id: contractId } });
};

const run = async () => {
  const source = await prisma.salesContract.findFirst({
    where: {
      status: { in: [ContractStatus.APPROVED, ContractStatus.SIGNED, ContractStatus.PRINTED] },
      items: { some: {} },
    },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  assert(source, 'sabalanerp-local needs one eligible contract with an item');

  const sourceData = record(source.contractData);
  const sourceCustomer = record(sourceData.customer);
  const created = await prisma.salesContract.create({
    data: {
      contractNumber: `QA-${token}`,
      title: 'Recursive accounting snapshot QA',
      titlePersian: 'آزمون مرز Snapshot حسابداری',
      content: source.content,
      status: ContractStatus.APPROVED,
      customerId: source.customerId,
      departmentId: source.departmentId,
      createdBy: source.createdBy,
      responsibleSellerId: source.responsibleSellerId,
      responsibleSellerSource: source.responsibleSellerSource,
      totalAmount: source.totalAmount,
      currency: source.currency,
      contractData: {
        ...sourceData,
        customerId: source.customerId,
        customer: {
          ...sourceCustomer,
          id: source.customerId,
          primaryContact: {
            id: 'qa-primary-contact',
            firstName: 'QA',
            lastName: 'Contact',
            mobile: '09120000000',
            communicationHistory: [{ body: 'must not cross the boundary' }],
            customer: { salesContracts: [{ id: 'nested-through-contact' }] },
          },
          communications: [{ id: 'crm-communication' }],
          salesContracts: [{ payload: 'x'.repeat(4_200_000) }],
        },
      } as Prisma.InputJsonValue,
      items: {
        create: source.items.map((item, index) => ({
          productId: item.productId,
          productRowId: `${token}-row-${index}`,
          productType: item.productType,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          description: item.description,
          isMandatory: item.isMandatory,
          mandatoryPercentage: item.mandatoryPercentage,
          originalTotalPrice: item.originalTotalPrice,
          stairPartType: item.stairPartType,
        })),
      },
    },
  });
  contractId = created.id;
  const actor = { userId: source.createdBy, role: 'ADMIN' };

  const initial = await executeAccountingAction({
    kind: 'CREATE_INVOICE',
    contractId,
    mode: 'FROM_CONTRACT_TOTAL',
    idempotencyKey: `${token}:initial`,
  }, actor);
  const initialId = record(initial.affected).financialRecordIds?.[0];
  assert(initialId);
  const initialRecord = await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: initialId } });
  assertBoundedSnapshot(initialRecord.sourceSnapshot);

  await prisma.accountingFinancialRecord.update({
    where: { id: initialId },
    data: {
      status: AccountingRecordStatus.VOIDED,
      financiallyApprovedAt: new Date(),
      financiallyApprovedBy: source.createdBy,
      amount: new Prisma.Decimal(1),
    },
  });
  const correction = await prisma.accountingCorrectionRequest.create({
    data: {
      contractId,
      recordId: initialId,
      category: CorrectionRequestCategory.OTHER,
      status: CorrectionRequestStatus.SALES_EDITED,
      accountantNote: 'QA replacement snapshot boundary',
      createdBy: source.createdBy,
    },
  });
  const replacement = await executeAccountingAction({
    kind: 'CREATE_REPLACEMENT_INVOICE',
    contractId,
    correctionRequestId: correction.id,
    replacesRecordId: initialId,
    idempotencyKey: `${token}:replacement`,
  }, actor);
  const replacementId = record(replacement.affected).financialRecordIds?.[0];
  assert(replacementId);
  const replacementRecord = await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: replacementId } });
  assertBoundedSnapshot(replacementRecord.sourceSnapshot);

  await prisma.accountingFinancialRecord.update({
    where: { id: replacementId },
    data: {
      status: AccountingRecordStatus.ISSUED,
      financiallyApprovedAt: new Date(),
      financiallyApprovedBy: source.createdBy,
    },
  });
  const receivable = await executeAccountingAction({
    kind: 'CREATE_RECEIVABLE',
    contractId,
    idempotencyKey: `${token}:receivable`,
  }, actor);
  const receivableRecord = await prisma.accountingFinancialRecord.findFirstOrThrow({
    where: {
      id: { in: record(receivable.affected).financialRecordIds },
      kind: FinancialRecordKind.RECEIVABLE,
    },
  });
  assertBoundedSnapshot(receivableRecord.sourceSnapshot);
};

run()
  .then(() => console.log('all accounting record paths persist bounded source snapshots: ok'))
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
