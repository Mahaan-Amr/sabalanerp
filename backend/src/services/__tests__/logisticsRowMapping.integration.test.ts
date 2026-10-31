import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { buildLegacyContractMigrationPlan, CURRENT_CONTRACT_PRODUCT_POLICY_V3 } from '../contractProductGraphMigration';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';
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
const runId = cleanupRunId || `qa-loading-row-${randomUUID()}`;
assert(/^qa-loading-row-[0-9a-f-]{36}$/.test(runId), 'Only this synthetic fixture namespace may be cleaned');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function cleanup() {
  await db.$transaction(async tx => {
    const contract = await tx.salesContract.findUnique({ where: { id: contractId } });
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (contract) assert.equal(contract.contractNumber, runId);
    if (actor) assert.equal(actor.username, runId);
    const invoices = await tx.accountingFinancialRecord.findMany({ where: { contractId }, select: { id: true } });
    const invoiceIds = invoices.map(row => row.id);
    const versions = await tx.contractApprovedPricingVersion.findMany({ where: { contractId }, select: { id: true } });
    const loadings = await tx.logisticsLoading.findMany({ where: { createdBy: actorId } });
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
  const template = await db.salesContract.findFirstOrThrow({ where: { partnerCaseId: null,
    items: { some: { productType: 'longitudinal' } } }, include: { items: true, customer: true } });
  const productId = template.items.find(item => item.productType === 'longitudinal')!.productId;
  const wideRowId = `contract-row-${randomUUID()}`;
  const products = [
    { rowId, productId, productType: 'longitudinal', length: 3, width: 40, quantity: 2, squareMeters: 2.4,
      totalPrice: 24000, originalTotalPrice: 24000 },
    { rowId: wideRowId, productId, productType: 'longitudinal', length: 3, width: 60, quantity: 3, squareMeters: 5.4,
      totalPrice: 54000, originalTotalPrice: 54000 },
  ].map(row => ({ ...row, stoneName: 'سنگ آزمون اتصال ردیف', lengthUnit: 'm', widthUnit: 'cm',
    pricePerSquareMeter: 10000, cuttingCost: 0, totalSubServiceCost: 0, finishingCost: 0,
    isMandatory: false, isCut: false, meta: { isLayer: false },
    longitudinalPolicyInput: { calculationPolicyVersion: 'calculation-v1', packingPolicyVersion: 'packing-v1',
      pricingPolicyVersion: 'pricing-v1', roundingPolicyVersion: 'rounding-v1', sourceBatchId: `${row.rowId}:batch`,
      motherWidthMeters: String(row.width / 100), widthMeters: String(row.width / 100), lengthMeters: '3', quantity: row.quantity,
      lastManualField: 'quantity', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      baseRateToman: '10000', mandatoryEnabled: false, mandatoryPercentage: '20', rememberedMandatoryPercentage: '20',
      sawKerfEnabled: false, sawKerfMeters: '0.003', calibrationEnabled: false, calibrationSelection: 'automatic',
      longitudinalCutRateToman: '0', calibrationCutRateToman: '0' } }));
  const project = await db.projectAddress.create({ data: { id: projectId, customerId: template.customerId,
    address: 'Local row mapping QA', projectName: runId } });
  const data = { contractKind: 'collaboration', projectId, customerId: template.customerId,
    customer: { id: template.customerId, firstName: template.customer.firstName, lastName: template.customer.lastName },
    project: { id: projectId, address: project.address }, products, serviceRows: [],
    discount: { enabled: false, baseSubtotal: '78000', amount: '0', percent: '0', currency: 'تومان' },
    payment: { currency: 'تومان', totalContractAmount: 78000 } };
  const plan = buildLegacyContractMigrationPlan({ id: contractId, totalAmount: '78000', contractData: data },
    1, CURRENT_CONTRACT_PRODUCT_POLICY_V3, true);
  assert(plan.ok, JSON.stringify(plan));
  await db.user.create({ data: { id: actorId, email: `${runId}@example.invalid`, username: runId,
    firstName: 'QA', lastName: 'Row mapping', password: 'test-only-no-login', role: 'ADMIN', isActive: true,
    mustChangePassword: false } });
  // Deliberately reverse database row order relative to the contract JSON.
  await db.salesContract.create({ data: { id: contractId, contractNumber: runId, title: runId, titlePersian: 'آزمون اتصال ردیف بارگیری',
    content: '', status: 'SIGNED', customerId: template.customerId, departmentId: template.departmentId,
    createdBy: actorId, responsibleSellerId: actorId, totalAmount: '78000', currency: 'تومان', contractData: json(data),
    items: { create: [...products].reverse().map((row, index) => ({ productId, productRowId: row.rowId,
      productType: 'longitudinal', quantity: row.quantity, unitPrice: '10000', totalPrice: row.totalPrice,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)) })) },
    productGraphState: { create: { schemaVersion: plan.graph.schemaVersion, revision: plan.graph.revision,
      graph: json(plan.graph), policySnapshot: json(CURRENT_CONTRACT_PRODUCT_POLICY_V3), inputHash: plan.provenanceHash,
      resultHash: plan.provenanceHash, totalAmountToman: '78000' } },
    productGraphAudits: { create: { commandId: `${runId}:writer`, actorId, baseRevision: 0, resultRevision: 1,
      command: json({ kind: 'canonical-wizard-save', writerVersion: 1, policy: CURRENT_CONTRACT_PRODUCT_POLICY_V3 }),
      resultGraph: json(plan.graph), inputHash: plan.provenanceHash, resultHash: plan.provenanceHash } },
  } });
  const session = await createAuthoritativeSession(db, actorId, { ipAddress: '127.0.0.1', userAgent: 'LoadingRowMappingIntegrationQA' });
  const request = async (path: string, body?: Record<string, unknown>, method = body ? 'POST' : 'GET', expectedStatus = 200) => {
    const response = await fetch(`http://127.0.0.1:5000/api/${path}`, { method,
      headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${session.token}` },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
    const result = await response.json() as Record<string, any>;
    assert.equal(response.status, expectedStatus, JSON.stringify({ path, status: response.status, code: result.code, error: result.error }));
    assert.equal(result.success, true, JSON.stringify(result));
    return result.data;
  };
  const created = await request('accounting/actions', { kind: 'CREATE_INVOICE', contractId, mode: 'FROM_CONTRACT_TOTAL',
    idempotencyKey: `${runId}:invoice`, correlationId: `${runId}:invoice` });
  await request('accounting/actions', { kind: 'APPROVE_FINANCIAL_INVOICE', invoiceId: created.affected.financialRecordIds[0],
    systemInvoiceNumber: runId, systemInvoiceDate: new Date().toISOString().slice(0, 10), sepidarAmount: '780000',
    idempotencyKey: `${runId}:approve`, correlationId: `${runId}:approve` });
  const contract = await db.salesContract.findUniqueOrThrow({ where: { id: contractId }, include: { items: { orderBy: { createdAt: 'asc' } } } });
  assert.equal(contract.items[0].productRowId, wideRowId);
  const remaining = await request(`logistics/projects/${projectId}/remaining`);
  const sources = remaining.groups.flatMap((group: any) => group.sources);
  const selected = products.map((row, index) => {
    const source = sources.find((source: any) => source.productRowId === row.rowId);
    assert(source, `Missing source ${row.rowId}`);
    assert.equal(source.remainingQuantity, index === 0 ? 6 : 9);
    assert.equal(source.productSnapshot.width, row.width);
    return { sourceContractItemId: source.contractItemId, quantity: index === 0 ? '5.8' : '7', unit: 'meter',
      productSnapshot: source.productSnapshot, sourceSnapshot: source };
  });
  const loading = await request(`logistics/projects/${projectId}/draft`, { forceNew: true }, 'POST', 201);
  assert(loading.id);
  const driverId = randomUUID(), vehicleId = randomUUID(), turnId = randomUUID();
  const expiresAt = new Date(Date.now() + 365 * 86_400_000);
  await db.externalDriver.create({ data: { id: driverId, firstName: 'QA', lastName: runId,
    nationalCode: createHash('sha256').update(driverId).digest('hex').replace(/[a-f]/g, '1').slice(0, 10),
    phone: '09120000000', licenceNumber: driverId, licenceClass: '1', licenceExpiresAt: expiresAt,
    status: 'ACTIVE', statusRecordedBy: actorId, createdBy: actorId,
    documents: { create: { documentType: 'DRIVING_LICENCE', reference: runId, expiresAt, recordedBy: actorId } } } });
  await db.externalVehicle.create({ data: { id: vehicleId, vehicleType: 'QA truck', status: 'ACTIVE',
    statusRecordedBy: actorId, createdBy: actorId,
    plates: { create: { plate: vehicleId, normalizedPlate: vehicleId, effectiveFrom: new Date(), reason: runId, recordedBy: actorId } },
    documents: { create: { documentType: 'VEHICLE_REGISTRATION', reference: runId, expiresAt, recordedBy: actorId } } } });
  await db.externalDriverVehicleAssignment.create({ data: { driverId, vehicleId, effectiveFrom: new Date(), reason: runId, recordedBy: actorId } });
  await db.driverBiometricEnrollment.create({ data: { externalDriverId: driverId, status: 'ACTIVE', confirmationPhone: '09120000000', enrolledBy: actorId } });
  await db.guardDriverQueueTurn.create({ data: { id: turnId, driverSource: 'EXTERNAL', status: 'AVAILABLE_FOR_LOADING',
    externalDriverId: driverId, externalVehicleId: vehicleId, admittedAt: new Date(), admittedBy: actorId,
    admissionSnapshot: { schemaVersion: 1, externalDriverId: driverId, externalVehicleId: vehicleId },
    integrityHash: createHash('sha256').update(turnId).digest('hex'), availableAt: new Date(), availableBy: actorId } });
  await request(`logistics/canonical-driver-queue/${turnId}/reserve`, { loadingId: loading.id });
  await request(`logistics/loadings/${loading.id}`, { lines: selected }, 'PUT');
  await request(`logistics/loadings/${loading.id}/canonical-allocations/${turnId}`, { lines: selected }, 'PUT');
  const checkLines = (lines: any[]) => {
    assert.equal(lines.length, 2);
    for (const [index, row] of products.entries()) {
      const line = lines.find(line => line.productRowId === row.rowId);
      assert(line);
      assert.equal(line.sourceContractItemId, selected[index].sourceContractItemId);
      assert.equal(String(line.quantity), index === 0 ? '5.8' : '7');
    }
  };
  const reopened = await request(`logistics/loadings/${loading.id}`);
  checkLines(reopened.lines);
  checkLines(reopened.canonicalAllocationDrafts[0].lines);
  for (const [index, row] of products.entries()) {
    const line = reopened.lines.find((line: any) => line.productRowId === row.rowId);
    assert.equal(line.productSnapshot.width, row.width);
    assert.equal(line.sourceSnapshot.remainingQuantity, index === 0 ? 6 : 9);
  }
  const finalized = await request(`logistics/loadings/${loading.id}/finalize`, { idempotencyKey: `${runId}:finalize` });
  assert.equal(finalized.revisions.length, 1);
  checkLines(finalized.revisions[0].lines);
  const finalRead = await request(`logistics/loadings/${loading.id}`);
  assert.equal(finalRead.status, 'FINALIZED');
  checkLines(finalRead.canonicalAllocationRevisions[0].lines);
  const persisted = await db.logisticsAllocationRevision.findUniqueOrThrow({ where: { id: finalized.revisions[0].id }, include: { lines: true } });
  checkLines(persisted.lines);
  const projection = await readShipmentQuantityProjection(db, { contractId });
  for (const [index, row] of products.entries()) {
    const actual = projection.rows.find(result => result.productRowId === row.rowId)!;
    assert.equal(Number(actual.quantities!.finalizedReserved), index === 0 ? 5.8 : 7);
    assert.equal(Number(actual.quantities!.availableToLoad), index === 0 ? 0.2 : 2);
  }
  assert.deepEqual(await db.salesContract.findUniqueOrThrow({ where: { id: template.id }, include: { items: true, customer: true } }), template);
  console.log(JSON.stringify({ result: 'PASS', runId, actualDockerHttpApi: true, realPostgres: true,
    saved: true, reopened: true, finalized: true, reopenedAfterFinalizing: true,
    rows: [{ width: 40, contracted: 6, reserved: 5.8, remaining: 0.2 }, { width: 60, contracted: 9, reserved: 7, remaining: 2 }],
    databaseRowOrder: 'wide,narrow', contractJsonOrder: 'narrow,wide', existingContractUnchanged: true }, null, 2));
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
  try { await cleanup(); console.log('Synthetic row-mapping fixture cleanup: PASS'); }
  finally { await db.$disconnect(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
