import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { shipmentQuantityEvidenceIntegrityHash } from '../../shipmentQuantityProjectionStore';

// The adjustment test owns these rows and rolls its enclosing transaction back.
// They represent an already exited shipment, not a second test stack or a real dispatch.
export async function createStatementAdjustmentFixture(tx: Prisma.TransactionClient) {
  const key = randomUUID();
  const [actor, department, product] = await Promise.all([
    tx.user.create({ data: { email: `statement-${key}@example.invalid`, username: `statement-${key}`,
      password: 'test-only-not-a-login', firstName: 'QA', lastName: 'Statement', role: 'ADMIN', isActive: true } }),
    tx.department.findFirst(), tx.product.findFirst(),
  ]);
  if (!department || !product) throw new Error('Local seed requires a department and product.');
  const digest = (tag: string) => createHash('sha256').update(`${key}:${tag}`).digest('hex');
  const customer = await tx.crmCustomer.create({ data: { firstName: 'QA', lastName: `statement-${key}` } });
  const rowId = `statement-row-${key}`;
  const contract = await tx.salesContract.create({ data: {
    contractNumber: `statement-${key}`, title: 'Statement fixture', titlePersian: 'آزمون اصلاح صورت‌حساب',
    content: '', status: 'APPROVED', customerId: customer.id, departmentId: department.id,
    createdBy: actor.id, responsibleSellerId: actor.id,
  } });
  const item = await tx.contractItem.create({ data: { contractId: contract.id, productId: product.id,
    productRowId: rowId, productType: 'count', quantity: 2, unitPrice: 50, totalPrice: 100 } });
  const financial = await tx.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE',
    status: 'APPROVED_FOR_ISSUE', sourceKind: 'SALES_CONTRACT', sourceId: contract.id,
    contractId: contract.id, customerId: customer.id, amount: 100, createdBy: actor.id,
    financiallyApprovedAt: new Date(), financiallyApprovedBy: actor.id } });
  const driver = await tx.externalDriver.create({ data: { firstName: 'QA', lastName: 'Driver',
    nationalCode: key, phone: '09121111111', status: 'ACTIVE', createdBy: actor.id } });
  const vehicle = await tx.externalVehicle.create({ data: { vehicleType: 'TRUCK', status: 'ACTIVE', createdBy: actor.id } });
  const project = await tx.projectAddress.create({ data: { customerId: customer.id, address: 'Statement fixture' } });
  const loading = await tx.logisticsLoading.create({ data: { loadingNumber: `statement-${key}`,
    customerId: customer.id, projectId: project.id, createdBy: actor.id, status: 'FINALIZED' } });
  const turn = await tx.guardDriverQueueTurn.create({ data: { driverSource: 'EXTERNAL', status: 'EXIT_RECORDED',
    externalDriverId: driver.id, externalVehicleId: vehicle.id, admittedBy: actor.id,
    admissionSnapshot: {}, integrityHash: digest('turn'), loadingId: loading.id } });
  const batch = await tx.logisticsAllocationBatch.create({ data: { loadingId: loading.id,
    idempotencyKey: key, finalizedBy: actor.id } });
  const revision = await tx.logisticsAllocationRevision.create({ data: { batchId: batch.id,
    loadingId: loading.id, queueTurnId: turn.id, revisionNumber: 1, snapshot: {
      loading: { customer: { name: 'QA customer' }, project: { address: project.address } },
      queueTurn: { admissionSnapshot: { plate: { plate: 'QA-PLATE' } } },
    },
    integrityHash: digest('revision'), finalizedBy: actor.id } });
  const line = await tx.logisticsAllocationRevisionLine.create({ data: { revisionId: revision.id,
    sourceContractId: contract.id, sourceContractItemId: item.id, productRowId: rowId,
    productId: product.id, quantity: 2, unit: 'count', snapshot: {}, integrityHash: digest('line') } });
  const candidate = await tx.accountingDispatchCandidate.create({ data: { allocationRevisionId: revision.id, status: 'ACCEPTED' } });
  const waybill = await tx.accountingDispatchWaybill.create({ data: { candidateId: candidate.id,
    status: 'EXIT_RECORDED', snapshot: {}, integrityHash: digest('waybill'), issuedBy: actor.id } });
  const expiresAt = new Date(Date.now() + 60_000);
  const session = await tx.dispatchConfirmationSession.create({ data: { waybillId: waybill.id,
    method: 'EXTERNAL_BIOMETRIC', status: 'CONFIRMED', driverSource: 'EXTERNAL', driverId: driver.id,
    accountingActorId: actor.id, waybillIntegrityHash: waybill.integrityHash, workstationId: 'QA', expiresAt } });
  const authorization = await tx.dispatchExitAuthorization.create({ data: { waybillId: waybill.id,
    sessionId: session.id, status: 'CONSUMED', method: session.method, driverSource: 'EXTERNAL', driverId: driver.id,
    waybillIntegrityHash: waybill.integrityHash, evidenceSnapshot: {}, integrityHash: digest('authorization'), validUntil: expiresAt } });
  const at = new Date(Date.now() - 10_000);
  const exit = await tx.guardPhysicalExit.create({ data: { authorizationId: authorization.id, waybillId: waybill.id,
    queueTurnId: turn.id, allocationRevisionId: revision.id, occurredAt: at, recordedAt: at,
    recordedBy: actor.id, snapshot: {}, integrityHash: digest('exit') } });
  for (const [kind, sourceType, sourceId, metadata] of [
    ['CONTRACTED_SET', 'CONTRACT_QUANTITY_VERSION', item.id, {}],
    ['ALLOCATION_FINALIZED', 'LOGISTICS_ALLOCATION_REVISION', line.id, {}],
    ['PHYSICAL_EXIT', 'GUARD_PHYSICAL_EXIT', `${exit.id}:${line.id}`, { loadingId: loading.id,
      waybillId: waybill.id, physicalExitId: exit.id, authorizationId: authorization.id,
      allocationLineId: line.id, allocationRevisionId: revision.id }],
  ] as const) {
    const evidence = { id: randomUUID(), contractId: contract.id, contractItemId: item.id, productRowId: rowId, unit: 'count',
      kind, quantity: '2.000', effectiveAt: at.toISOString(), recordedAt: at.toISOString(),
      sourceType, sourceId, sourceVersion: 1, integrityHash: '', metadata };
    await tx.shipmentQuantityEvidence.create({ data: { ...evidence, quantity: new Prisma.Decimal(2),
      effectiveAt: at, recordedAt: at, integrityHash: shipmentQuantityEvidenceIntegrityHash(evidence) } });
  }
  return { waybillId: waybill.id, revisionId: revision.id, revisionLineId: line.id, itemId: item.id,
    productRowId: rowId, contractId: contract.id, customerId: customer.id, financialRecordId: financial.id,
    createdBy: actor.id, currency: contract.currency, lineQuantity: new Prisma.Decimal(2), lineUnit: 'count', loadingId: loading.id };
}
