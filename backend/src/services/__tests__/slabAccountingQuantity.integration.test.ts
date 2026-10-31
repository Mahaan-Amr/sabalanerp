import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { calculateSlab, parseSlabPolicyInput } from '@sabalanerp/contract-product-graph';
import { buildLegacyContractMigrationPlan, CURRENT_CONTRACT_PRODUCT_POLICY_V3 } from '../contractProductGraphMigration';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';
import { bindFinalizedAllocationPricing } from '../allocationPricingBinding';
import { createPrismaAllocationPricingBindingPort } from '../allocationPricingPrismaAdapter';
import { readShipmentQuantityProjection } from '../shipmentQuantityProjectionStore';

// Uses only the existing local Compose database and the real running HTTP backend.
const database = new URL(process.env.DATABASE_URL || '');
assert(['localhost', '127.0.0.1'].includes(database.hostname) && database.port === '55432'
  && database.pathname === '/sabalanerp', 'This test requires sabalanerp-local on port 55432');
const db = new PrismaClient();
let contractId: string = randomUUID();
let actorId: string = randomUUID();
const rowId = `contract-row-${randomUUID()}`;
let projectId: string = randomUUID();
const cleanupRunId = process.argv.find(arg => arg.startsWith('--cleanup-only='))?.split('=')[1];
const runId = cleanupRunId || `qa-slab-100795-${randomUUID()}`;
assert(/^qa-slab-100795-[0-9a-f-]{36}$/.test(runId), 'Only this synthetic fixture namespace may be cleaned');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown) => value as Record<string, any>;

async function cleanup() {
  await db.$transaction(async tx => {
    const contract = await tx.salesContract.findUnique({ where: { id: contractId } });
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (contract) assert.equal(contract.contractNumber, runId);
    if (actor) assert.equal(actor.username, runId);
    const invoices = await tx.accountingFinancialRecord.findMany({ where: { contractId }, select: { id: true } });
    const invoiceIds = invoices.map(row => row.id);
    const versions = await tx.contractApprovedPricingVersion.findMany({ where: { contractId }, select: { id: true } });
    const loadings = await tx.logisticsLoading.findMany({ where: { createdBy: actorId, loadingNumber: { startsWith: runId } } });
    const loadingIds = loadings.map(row => row.id);
    const turns = await tx.guardDriverQueueTurn.findMany({ where: { loadingId: { in: loadingIds } } });
    const revisions = await tx.logisticsAllocationRevision.findMany({ where: { loadingId: { in: loadingIds } } });
    const revisionIds = revisions.map(row => row.id);
    // Test teardown only: immutable evidence cannot be removed through runtime APIs.
    // The local-DB guard and exact synthetic identities above bound this transaction.
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.dispatchPricedAllocationEvent.deleteMany({ where: { allocationRevisionId: { in: revisionIds } } });
    await tx.logisticsAllocationRevisionPricing.deleteMany({ where: { allocationRevisionId: { in: revisionIds } } });
    await tx.accountingDispatchWorkItem.deleteMany({ where: { candidate: { allocationRevisionId: { in: revisionIds } } } });
    await tx.accountingDispatchCandidate.deleteMany({ where: { allocationRevisionId: { in: revisionIds } } });
    await tx.dispatchLifecycleAudit.deleteMany({ where: { actorId } });
    await tx.logisticsAllocationRevisionLine.deleteMany({ where: { revisionId: { in: revisionIds } } });
    await tx.logisticsAllocationRevision.deleteMany({ where: { id: { in: revisionIds } } });
    await tx.logisticsAllocationBatch.deleteMany({ where: { loadingId: { in: loadingIds } } });
    await tx.guardDriverQueueEvent.deleteMany({ where: { turnId: { in: turns.map(row => row.id) } } });
    await tx.shipmentQuantityEvidence.deleteMany({ where: { contractId } });
    await tx.shipmentQuantityProjection.deleteMany({ where: { contractId } });
    await tx.contractPricingReadinessReason.deleteMany({ where: { readinessResult: { contractId } } });
    await tx.contractPricingReadinessResult.deleteMany({ where: { contractId } });
    await tx.contractApprovedPricingHead.deleteMany({ where: { contractId } });
    await tx.contractApprovedPricingRow.deleteMany({ where: { pricingVersionId: { in: versions.map(row => row.id) } } });
    await tx.contractApprovedPricingVersion.deleteMany({ where: { contractId } });
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    await tx.logisticsAllocationDraft.deleteMany({ where: { loadingId: { in: loadingIds } } });
    await tx.guardDriverQueueTurn.deleteMany({ where: { id: { in: turns.map(row => row.id) } } });
    await tx.logisticsLoading.deleteMany({ where: { id: { in: loadingIds } } });
    await tx.externalDriverDocument.deleteMany({ where: { driver: { createdBy: actorId } } });
    await tx.driverBiometricEnrollment.deleteMany({ where: { externalDriver: { createdBy: actorId } } });
    await tx.externalDriverVehicleAssignment.deleteMany({ where: { recordedBy: actorId } });
    await tx.externalVehicleDocument.deleteMany({ where: { vehicle: { createdBy: actorId } } });
    await tx.externalVehiclePlate.deleteMany({ where: { vehicle: { createdBy: actorId } } });
    await tx.externalDriver.deleteMany({ where: { createdBy: actorId } });
    await tx.externalVehicle.deleteMany({ where: { createdBy: actorId } });
    await tx.accountingInvoiceNumberClaim.deleteMany({ where: { financialRecordId: { in: invoiceIds } } });
    await tx.accountingTaxRecord.deleteMany({ where: { contractId } });
    await tx.accountingInvoiceCandidateItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await tx.accountingAuditLog.deleteMany({ where: { contractId } });
    await tx.accountingContractFlag.deleteMany({ where: { contractId } });
    await tx.accountingFinancialRecord.deleteMany({ where: { contractId } });
    await tx.salesContract.deleteMany({ where: { id: contractId } });
    await tx.projectAddress.deleteMany({ where: { id: projectId, projectName: runId } });
    const events = await tx.notificationEvent.findMany({ where: { resourceId: contractId }, select: { id: true } });
    await tx.notification.deleteMany({ where: { eventId: { in: events.map(row => row.id) } } });
    await tx.notificationEvent.deleteMany({ where: { resourceId: contractId } });
    await tx.user.deleteMany({ where: { id: actorId } });
  }, { timeout: 30_000 });
  assert.equal(await db.salesContract.count({ where: { id: contractId } }), 0);
  assert.equal(await db.accountingFinancialRecord.count({ where: { contractId } }), 0);
  assert.equal(await db.contractApprovedPricingVersion.count({ where: { contractId } }), 0);
  assert.equal(await db.user.count({ where: { id: actorId } }), 0);
  assert.equal(await db.contractPricingReadinessResult.count({ where: { contractId } }), 0);
  assert.equal(await db.shipmentQuantityEvidence.count({ where: { contractId } }), 0);
  assert.equal(await db.accountingContractFlag.count({ where: { contractId } }), 0);
}

async function run() {
  const template = await db.salesContract.findFirstOrThrow({ where: {
    partnerCaseId: null, items: { some: { productType: 'slab' } },
  }, include: { items: true, customer: true } });
  const productId = template.items.find(item => item.productType === 'slab')!.productId;
  const project = await db.projectAddress.create({ data: { id: projectId, customerId: template.customerId,
    address: 'QA exact slab destination', projectName: runId } });
  const input = {
    quantity: 3, kerfMeters: '0', sourceRows: [{ quantity: 3, sourceRowId: `${rowId}:source`,
      widthMeters: '1.8', lengthMeters: '2.95', widthDisplayUnit: 'm', lengthDisplayUnit: 'm' }],
    widthMeters: '1.75', lengthMeters: '2.95', sourceBatchId: `${rowId}:batch`, lastManualField: 'width',
    verticalCutSides: [], widthDisplayUnit: 'm', crossCutRateToman: '30000', lengthDisplayUnit: 'm',
    lastManualDimension: 'width', cuttingPricingMethod: 'squareMeter', packingPolicyVersion: 'packing-v1',
    pricingPolicyVersion: 'pricing-v1', baseMaterialRateToman: '22000000', roundingPolicyVersion: 'rounding-v1',
    squareMeterCutRateToman: '500000', calculationPolicyVersion: 'calculation-v1', longitudinalCutRateToman: '30000',
  } as const;
  const calculation = calculateSlab(parseSlabPolicyInput(input));
  assert(calculation.ok, JSON.stringify(calculation));
  const slab = calculation.result;
  assert.equal(slab.finishedAreaSquareMeters, '15.4875');
  assert.equal(slab.totalAmountToman, '358203750');
  const product = { rowId, productId, productType: 'slab', stoneName: 'اسلب آزمون ۱۰۰۷۹۵',
    length: 2.95, width: 1.75, lengthUnit: 'm', widthUnit: 'm', quantity: 3, squareMeters: 15.4875,
    slabPolicyInput: input, pricePerSquareMeter: 22000000, originalTotalPrice: 350460000,
    cuttingCost: 7743750, physicalCuttingCost: 7743750, totalPrice: 358203750,
    totalSubServiceCost: 0, finishingCost: 0, isMandatory: false, isCut: true,
    meta: { isLayer: false } };
  const data = { contractKind: 'collaboration', projectId, project: { id: projectId, address: project.address, projectName: runId }, customerId: template.customerId,
    customer: { id: template.customerId, firstName: template.customer.firstName, lastName: template.customer.lastName },
    products: [product], serviceRows: [], discount: { enabled: false, baseSubtotal: '350460000',
      amount: '0', percent: '0', currency: 'تومان' },
    payment: { currency: 'تومان', totalContractAmount: 358203750 } };
  const plan = buildLegacyContractMigrationPlan({ id: contractId, totalAmount: '358203750', contractData: data },
    1, CURRENT_CONTRACT_PRODUCT_POLICY_V3, true);
  assert(plan.ok, JSON.stringify(plan));
  await db.user.create({ data: { id: actorId, email: `${runId}@example.invalid`, username: runId,
    firstName: 'QA', lastName: 'Slab accounting', password: 'test-only-no-login', role: 'ADMIN', isActive: true,
    mustChangePassword: false } });
  await db.salesContract.create({ data: { id: contractId, contractNumber: runId,
    title: runId, titlePersian: 'آزمون متراژ حسابداری اسلب', content: '', status: 'SIGNED',
    customerId: template.customerId, departmentId: template.departmentId,
    createdBy: actorId, responsibleSellerId: actorId, totalAmount: '358203750', currency: 'تومان', contractData: json(data),
    items: { create: { productId, productRowId: rowId, productType: 'slab', quantity: 3,
      unitPrice: '22000000', totalPrice: '358203750' } },
    productGraphState: { create: { schemaVersion: plan.graph.schemaVersion, revision: plan.graph.revision,
      graph: json(plan.graph), policySnapshot: json(CURRENT_CONTRACT_PRODUCT_POLICY_V3),
      inputHash: plan.provenanceHash, resultHash: plan.provenanceHash, totalAmountToman: '358203750' } },
    productGraphAudits: { create: { commandId: `${runId}:writer`, actorId, baseRevision: 0, resultRevision: 1,
      command: json({ kind: 'canonical-wizard-save', writerVersion: 1, policy: CURRENT_CONTRACT_PRODUCT_POLICY_V3 }),
      resultGraph: json(plan.graph), inputHash: plan.provenanceHash, resultHash: plan.provenanceHash } },
  } });
  const session = await createAuthoritativeSession(db, actorId, { ipAddress: '127.0.0.1', userAgent: 'SlabAccountingIntegrationQA' });
  const request = async (path: string, body: Record<string, unknown>, method = 'POST', expectedStatus = 200) => {
    const response = await fetch(`http://127.0.0.1:5000/api/${path}`, {
      method, headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${session.token}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json() as Record<string, any>;
    assert.equal(response.status, expectedStatus, JSON.stringify({ status: response.status, result }));
    if (expectedStatus !== 200) return result;
    assert.equal(result.success, true, JSON.stringify(result));
    return result.data;
  };
  const action = (body: Record<string, unknown>) => request('accounting/actions', body);
  const created = await action({ kind: 'CREATE_INVOICE', contractId, mode: 'FROM_CONTRACT_TOTAL',
    idempotencyKey: `${runId}:create`, correlationId: `${runId}:create` });
  const invoiceId = String(created.affected.financialRecordIds[0]);
  const before = await db.salesContract.findUniqueOrThrow({ where: { id: contractId }, include: { items: true, productGraphState: true } });
  const draft = await db.accountingFinancialRecord.findUniqueOrThrow({ where: { id: invoiceId }, include: { invoiceItems: true } });
  await action({ kind: 'APPROVE_FINANCIAL_INVOICE', invoiceId,
    systemInvoiceNumber: `QA-SLAB-${randomUUID()}`, systemInvoiceDate: new Date().toISOString().slice(0, 10),
    sepidarAmount: '3582037500', idempotencyKey: `${runId}:approve`, correlationId: `${runId}:approve` });
  const approved = await db.accountingFinancialRecord.findUniqueOrThrow({ where: { id: invoiceId }, include: { invoiceItems: true } });
  assert.equal(approved.status, 'ISSUED');
  assert(approved.financiallyApprovedAt);
  assert.equal(approved.amount.toString(), '3582037500');
  assert.equal(approved.sepidarAmount!.toString(), '3582037500');
  assert.deepEqual(approved.sourceSnapshot, draft.sourceSnapshot);
  assert.deepEqual(approved.invoiceItems, draft.invoiceItems);
  const after = await db.salesContract.findUniqueOrThrow({ where: { id: contractId }, include: { items: true, productGraphState: true } });
  assert.deepEqual(after.contractData, before.contractData);
  assert.deepEqual(after.items, before.items);
  assert.deepEqual(after.productGraphState, before.productGraphState);
  assert.equal(after.totalAmount!.toString(), '358203750');
  const version = await db.contractApprovedPricingVersion.findFirstOrThrow({ where: { contractId }, include: { rows: true } });
  assert.equal(version.rows.length, 1);
  assert.equal(version.rows[0].contractedQuantity.toString(), '15.4875');
  assert.equal(version.rows[0].canonicalAllInTotal.toString(), '358203750');
  const normalization = object(version.sourceEvidence).quantityPrecisionEvidence[0];
  assert.equal(normalization.rawSnapshotAreaSquareMeters, '15.4875');
  assert.equal(normalization.rawCanonicalAreaSquareMeters, '15.4875');
  assert.equal(normalization.differenceSquareMeters, '0');
  assert.equal(await db.accountingContractFlag.count({ where: { contractId, status: 'OPEN' } }), 0);
  const readiness = await db.contractPricingReadinessResult.findFirstOrThrow({ where: { contractId, status: 'READY' } });
  assert.equal(readiness.quantityTotal!.toString(), '15.4875');
  const shipmentQuantity = await db.shipmentQuantityEvidence.findFirstOrThrow({ where: { contractId, kind: 'CONTRACTED_SET' } });
  assert.equal(shipmentQuantity.quantity.toString(), '15.4875');
  assert.equal(await db.shipmentQuantityEvidence.count({ where: { contractId, kind: 'EVIDENCE_CONFLICT' } }), 0);
  assert.equal(await db.accountingAuditLog.count({ where: { contractId, action: 'APPROVE_FINANCIAL_INVOICE' } }), 1);
  const finalized: Array<{ id: string; lines: any[]; finalizedAt: Date }> = [];
  for (const [index, amount] of ['5.1625', '10.325'].entries()) {
    const driverId = randomUUID(), vehicleId = randomUUID(), loadingId = randomUUID(), turnId = randomUUID();
    const expiresAt = new Date(Date.now() + 86_400_000 * 365);
    await db.externalDriver.create({ data: { id: driverId, firstName: 'QA', lastName: runId,
      nationalCode: createHash('sha256').update(driverId).digest('hex').replace(/[a-f]/g, '1').slice(0, 10),
      phone: `09${Date.now().toString().slice(-9)}`, licenceNumber: driverId, licenceClass: '1', licenceExpiresAt: expiresAt,
      status: 'ACTIVE', statusRecordedBy: actorId, createdBy: actorId,
      documents: { create: { documentType: 'DRIVING_LICENCE', reference: runId, expiresAt, recordedBy: actorId } } } });
    await db.externalVehicle.create({ data: { id: vehicleId, vehicleType: 'QA truck', status: 'ACTIVE',
      statusRecordedBy: actorId, createdBy: actorId,
      plates: { create: { plate: vehicleId, normalizedPlate: vehicleId, effectiveFrom: new Date(), reason: runId, recordedBy: actorId } },
      documents: { create: { documentType: 'VEHICLE_REGISTRATION', reference: runId, expiresAt, recordedBy: actorId } } } });
    await db.externalDriverVehicleAssignment.create({ data: { driverId, vehicleId, effectiveFrom: new Date(), reason: runId, recordedBy: actorId } });
    await db.driverBiometricEnrollment.create({ data: { externalDriverId: driverId, status: 'ACTIVE',
      confirmationPhone: '09120000000', enrolledBy: actorId } });
    await db.logisticsLoading.create({ data: { id: loadingId, loadingNumber: `${runId}-${index}`, customerId: template.customerId,
      projectId, createdBy: actorId, lines: { create: { sourceContractId: contractId, sourceContractItemId: after.items[0].id,
        productRowId: rowId, productId, quantity: amount, unit: 'squareMeter' } } } });
    await db.guardDriverQueueTurn.create({ data: { id: turnId, driverSource: 'EXTERNAL', status: 'RESERVED_FOR_LOADING',
      externalDriverId: driverId, externalVehicleId: vehicleId, admittedAt: new Date(), admittedBy: actorId,
      admissionSnapshot: { schemaVersion: 1, externalDriverId: driverId, externalVehicleId: vehicleId },
      integrityHash: createHash('sha256').update(turnId).digest('hex'), loadingId,
      availableAt: new Date(), availableBy: actorId, reservedAt: new Date(), reservedBy: actorId } });
    const saveDraft = (quantity: string) => request(`logistics/loadings/${loadingId}/canonical-allocations/${turnId}`,
      { lines: [{ sourceContractItemId: after.items[0].id, quantity, unit: 'squareMeter' }] }, 'PUT');
    if (index === 1) {
      await saveDraft('10.3251');
      await request(`logistics/loadings/${loadingId}/finalize`, { idempotencyKey: `${runId}:over` }, 'POST', 409);
      assert.equal(await db.logisticsAllocationRevision.count({ where: { loadingId } }), 0);
    }
    await saveDraft(amount);
    const result = await request(`logistics/loadings/${loadingId}/finalize`, { idempotencyKey: `${runId}:finalize:${index}` });
    const revision = await db.logisticsAllocationRevision.findUniqueOrThrow({ where: { id: result.revisions[0].id }, include: { lines: true } });
    assert.equal(revision.lines[0].quantity.toString(), amount);
    finalized.push(revision);
  }
  const projection = await readShipmentQuantityProjection(db, { contractId });
  assert.equal(projection.rows[0].quantities!.contracted, '15.4875');
  assert.equal(projection.rows[0].quantities!.finalizedReserved, '15.4875');
  assert.equal(projection.rows[0].quantities!.availableToLoad, '0.000');
  // Exercise the persisted financial/logistics binding without activating the
  // globally paused statement workflow for other local contracts.
  const rollback = Symbol('isolated priced ledger rollback');
  const controlsBefore = [await db.shipmentStatementCutover.findUnique({ where: { id: 'customer-shipment-statements' } }),
    await db.shipmentStatementOperationsControl.findUnique({ where: { id: 'customer-shipment-statements' } })];
  try {
    await db.$transaction(async tx => {
      const manifest = await tx.shipmentStatementMigrationManifest.create({ data: { migrationName: runId,
        schemaVersion: 1, sourceSchemaHash: 'e'.repeat(64), createdBy: actorId } });
      await tx.shipmentStatementCutover.update({ where: { id: 'customer-shipment-statements' }, data: { enabled: true,
        cutoverAt: new Date(0), activatedAt: new Date(), activatedBy: actorId, manifestId: manifest.id, integrityHash: 'f'.repeat(64) } });
      await tx.shipmentStatementOperationsControl.update({ where: { id: 'customer-shipment-statements' }, data: { paused: false } });
      for (const revision of finalized) {
        await bindFinalizedAllocationPricing(createPrismaAllocationPricingBindingPort(tx), {
          allocationRevisionId: revision.id, finalizedAt: revision.finalizedAt, actorId,
          scope: { customerId: template.customerId, projectId, destination: project.address }, expectedCurrency: 'تومان',
          lines: revision.lines.map(line => ({ allocationRevisionLineId: line.id, contractId, contractItemId: after.items[0].id,
            productRowId: rowId, quantity: line.quantity.toString(), unit: 'squareMeter' })),
        }, { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' });
      }
      const events = await tx.dispatchPricedAllocationEvent.findMany({ where: { allocationRevisionId: { in: finalized.map(row => row.id) } } });
      assert.equal(events.length, 2);
      assert.equal(events.reduce((sum, event) => sum.plus(event.quantity), new Prisma.Decimal(0)).toString(), '15.4875');
      assert.equal(events.reduce((sum, event) => sum.plus(event.grossAmount), new Prisma.Decimal(0)).toString(), '358203750');
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) { if (error !== rollback) throw error; }
  assert.deepEqual([await db.shipmentStatementCutover.findUnique({ where: { id: 'customer-shipment-statements' } }),
    await db.shipmentStatementOperationsControl.findUnique({ where: { id: 'customer-shipment-statements' } })], controlsBefore);
  const templateAfter = await db.salesContract.findUniqueOrThrow({ where: { id: template.id }, include: { items: true, customer: true } });
  assert.deepEqual(templateAfter, template, 'the existing source contract must remain untouched');
  console.log(JSON.stringify({ result: 'PASS', path: 'HTTP /api/accounting/actions', runId,
    status: approved.status, exactArea: product.squareMeters, accountingArea: version.rows[0].contractedQuantity.toString(),
    amountToman: after.totalAmount!.toString(), invoiceRial: approved.amount.toString(), readiness: readiness.status,
    normalization, immutableContractAndGraph: true, immutableInvoiceSnapshotAndItems: true,
    logistics: { partialQuantities: ['5.1625', '10.325'], reserved: '15.4875', available: '0.000',
      overAllocationRejected: true, pricedGrossToman: '358203750', pricedBindingRolledBack: true } }));
}

async function main() {
  if (cleanupRunId) {
    contractId = (await db.salesContract.findUniqueOrThrow({ where: { contractNumber: runId } })).id;
    actorId = (await db.user.findUniqueOrThrow({ where: { username: runId } })).id;
    projectId = (await db.projectAddress.findFirst({ where: { projectName: runId } }))?.id || projectId;
    return;
  }
  await run();
}

main().finally(async () => {
  try { await cleanup(); console.log('Synthetic contract, financial records, pricing and actor cleanup: PASS'); }
  finally { await db.$disconnect(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
