const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const { createPrismaAllocationPricingBindingPort } = require('/app/dist/services/allocationPricingPrismaAdapter');
const { allocatePricedRevision, pricedAllocationIntegrityHash } = require('/app/dist/services/pricedAllocationLedger');
const { readBoundPricedAllocation } = require('/app/dist/services/allocationPricingReadModel');
const { readShipmentQuantityProjection } = require('/app/dist/services/shipmentQuantityProjectionStore');

const prisma = new PrismaClient();

const main = async () => {
  const contract = await prisma.salesContract.findUnique({
    where: { contractNumber: '100302' },
    select: { id: true, contractNumber: true },
  });
  assert(contract, 'Contract 100302 must exist in the restored backup');

  const persistedRows = await prisma.contractApprovedPricingRow.findMany({
    where: { pricingVersion: { contractId: contract.id } },
    include: { pricingVersion: { select: { id: true, integrityHash: true, approvedBy: true } } },
    orderBy: { ordinal: 'asc' },
  });
  assert.equal(persistedRows.length, 1, 'Contract 100302 must have exactly one approved pricing row');
  const persisted = persistedRows[0];
  assert(persisted.linkedContractItemId, 'Recovered row must retain a live operational contract item link');
  assert.notEqual(persisted.contractItemId, persisted.linkedContractItemId,
    'Frozen and live identities must remain distinct for this recovered row');

  const beforeWriteCounts = {
    references: await prisma.logisticsAllocationRevisionPricing.count(),
    events: await prisma.dispatchPricedAllocationEvent.count(),
    lines: await prisma.logisticsAllocationRevisionLine.count(),
    revisions: await prisma.logisticsAllocationRevision.count(),
    batches: await prisma.logisticsAllocationBatch.count(),
    loadings: await prisma.logisticsLoading.count(),
    queueTurns: await prisma.guardDriverQueueTurn.count(),
    externalDrivers: await prisma.externalDriver.count(),
    externalVehicles: await prisma.externalVehicle.count(),
  };
  const rollback = Symbol('qa-downstream-rollback');
  let allocationEvidence;
  try {
    await prisma.$transaction(async (tx) => {
      const project = await tx.projectAddress.findFirst({
        select: { id: true, customerId: true },
        orderBy: { createdAt: 'asc' },
      });
      assert(project, 'Restored backup needs one customer project for rollback-safe allocation QA');
      const actorId = persistedRows[0].pricingVersion.approvedBy || 'release-qa';
      const loading = await tx.logisticsLoading.create({ data: {
        loadingNumber: `QA-ROLLBACK-${randomUUID()}`,
        customerId: project.customerId,
        projectId: project.id,
        createdBy: actorId,
      } });
      const externalDriver = await tx.externalDriver.create({ data: {
        firstName: 'QA',
        lastName: 'Rollback',
        nationalCode: String(Date.now()).slice(-10),
        phone: '09000000000',
        createdBy: actorId,
      } });
      const externalVehicle = await tx.externalVehicle.create({ data: {
        vehicleType: 'QA_ROLLBACK',
        createdBy: actorId,
      } });
      const queueTurn = await tx.guardDriverQueueTurn.create({ data: {
        driverSource: 'EXTERNAL',
        externalDriverId: externalDriver.id,
        externalVehicleId: externalVehicle.id,
        admittedBy: actorId,
        admissionSnapshot: { qa: 'dual-identity-readback' },
        integrityHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
        loadingId: loading.id,
      } });
      const batch = await tx.logisticsAllocationBatch.create({ data: {
        loadingId: loading.id,
        idempotencyKey: `qa-rollback-${randomUUID()}`,
        finalizedBy: actorId,
      } });
      const qaRevision = await tx.logisticsAllocationRevision.create({ data: {
        batchId: batch.id,
        loadingId: loading.id,
        queueTurnId: queueTurn.id,
        revisionNumber: 1,
        snapshot: { qa: 'dual-identity-readback' },
        integrityHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
        finalizedBy: actorId,
      } });
      const liveItem = await tx.contractItem.findUnique({
        where: { id: persisted.linkedContractItemId },
        select: { productId: true },
      });
      assert(liveItem, 'Live contract item must exist');
      const revisionLineId = randomUUID();
      await tx.logisticsAllocationRevisionLine.create({ data: {
        id: revisionLineId,
        revisionId: qaRevision.id,
        sourceContractId: contract.id,
        sourceContractItemId: persisted.linkedContractItemId,
        productRowId: persisted.productRowId,
        productId: liveItem.productId,
        quantity: '1.000',
        unit: persisted.unit,
        snapshot: { qa: 'dual-identity-readback' },
        integrityHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
      } });
      const port = createPrismaAllocationPricingBindingPort(tx);
      await port.lockPricingScope([
        `APPROVED_PRICING_HEAD:${contract.id}`,
        `APPROVED_PRICING_ROW:${contract.id}:${persisted.linkedContractItemId}`,
        `PRICED_ALLOCATION_LEDGER:${persisted.id}`,
      ]);
      const [evidence] = await port.loadLockedPricingEvidence([contract.id]);
      assert(evidence, 'Approved pricing evidence must be available to allocation');
      assert.equal(evidence.versionIntegrityVerified, true);
      assert.equal(evidence.rowIntegrityVerified, true);
      assert.equal(evidence.version.rows.length, 1);
      const operational = evidence.version.rows[0];
      assert.equal(operational.contractItemId, persisted.linkedContractItemId,
        'Allocation must consume the live contract item identity');
      assert.notEqual(operational.contractItemId, persisted.contractItemId,
        'Allocation must not consume the frozen historical identity');
      const priorEvents = await port.loadPriorPricedEvents([operational.id]);
      const calculated = allocatePricedRevision({
        versions: [evidence.version],
        priorEvents,
        lines: [{
          allocationRevisionLineId: revisionLineId,
          contractId: contract.id,
          contractItemId: operational.contractItemId,
          productRowId: operational.productRowId,
          quantity: '1.000',
          unit: operational.unit,
        }],
      });
      assert.equal(calculated.events.length, 1);
      const event = calculated.events[0];
      assert.equal(event.pricingRowId, operational.id);
      assert.equal(event.contractItemId, persisted.linkedContractItemId);
      await port.createPricingReference({
        allocationRevisionId: qaRevision.id,
        contractId: contract.id,
        pricingVersionId: evidence.version.id,
        expectedPricingHash: evidence.version.integrityHash,
        readinessEvidenceHash: evidence.version.readinessEvidenceHash,
      });
      const eventPayload = {
        allocationRevisionId: qaRevision.id,
        allocationRevisionLineId: revisionLineId,
        pricingVersionId: event.pricingVersionId,
        pricingRowId: event.pricingRowId,
        quantity: event.quantity,
        grossAmount: event.grossAmount,
        discountAmount: event.discountAmount,
        netAmount: event.netAmount,
        consumesFinalRemainder: event.consumesFinalRemainder,
        evidence: event.evidence,
        recordedBy: evidence.version.approvedBy,
      };
      await port.createPricedEvent({ ...eventPayload, integrityHash: pricedAllocationIntegrityHash(eventPayload) });
      const readback = await readBoundPricedAllocation(tx, qaRevision.id);
      assert.equal(readback.lines.length, 1);
      assert.equal(readback.lines[0].contractItemId, persisted.linkedContractItemId,
        'Persisted event readback must attribute the live contract item');
      assert.equal(readback.lines[0].productRowId, persisted.productRowId);
      allocationEvidence = {
        versionId: evidence.version.id,
        pricingRowId: operational.id,
        operationalContractItemId: operational.contractItemId,
        integrityVerified: evidence.versionIntegrityVerified && evidence.rowIntegrityVerified,
        persistedEventPassedDatabaseTrigger: true,
        persistedEventReadback: readback,
        simulatedEvent: event,
        totals: calculated.totals,
      };
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert(allocationEvidence, 'Rollback-safe allocation QA must complete');
  assert.deepEqual({
    references: await prisma.logisticsAllocationRevisionPricing.count(),
    events: await prisma.dispatchPricedAllocationEvent.count(),
    lines: await prisma.logisticsAllocationRevisionLine.count(),
    revisions: await prisma.logisticsAllocationRevision.count(),
    batches: await prisma.logisticsAllocationBatch.count(),
    loadings: await prisma.logisticsLoading.count(),
    queueTurns: await prisma.guardDriverQueueTurn.count(),
    externalDrivers: await prisma.externalDriver.count(),
    externalVehicles: await prisma.externalVehicle.count(),
  }, beforeWriteCounts, 'Rollback-safe QA must leave no database writes');

  const projection = await readShipmentQuantityProjection(prisma, { contractId: contract.id });
  const row = projection.rows.find((candidate) => candidate.contractItemId === persisted.linkedContractItemId);
  assert(row, 'Shipment projection must resolve the live contract item identity');
  assert.equal(row.productRowId, persisted.productRowId);
  assert.equal(row.quantities?.contracted, '16.667');
  assert.equal(row.health, 'CURRENT');
  assert(!projection.rows.some((candidate) => candidate.contractItemId === persisted.contractItemId),
    'Shipment projection must not expose the frozen historical identity as an operational row');

  const financial = await prisma.accountingFinancialRecord.findMany({
    where: { contractId: contract.id },
    select: { id: true, status: true, financiallyApprovedAt: true, systemInvoiceNumber: true },
    orderBy: { createdAt: 'asc' },
  });
  const evidenceRows = await prisma.shipmentQuantityEvidence.findMany({
    where: { contractId: contract.id },
    select: {
      id: true, contractItemId: true, productRowId: true, quantity: true, unit: true,
      kind: true, sourceType: true, sourceId: true, metadata: true,
    },
    orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
  });
  const report = {
    database: new URL(process.env.DATABASE_URL).pathname.slice(1),
    contract,
    financial: financial.map((item) => ({ ...item, financiallyApprovedAt: item.financiallyApprovedAt?.toISOString() || null })),
    frozenAuditIdentity: persisted.contractItemId,
    liveOperationalIdentity: persisted.linkedContractItemId,
    approvedPricing: {
      versionId: persisted.pricingVersion.id,
      rowId: persisted.id,
      productRowId: persisted.productRowId,
      contractedQuantity: persisted.contractedQuantity.toFixed(3),
      unit: persisted.unit,
      rowIntegrityHash: persisted.integrityHash,
      versionIntegrityHash: persisted.pricingVersion.integrityHash,
    },
    shipmentEvidence: evidenceRows.map((item) => ({ ...item, quantity: item.quantity.toFixed(3) })),
    shipmentProjection: row,
    allocationEvidence,
    assertions: {
      frozenIdentityPreserved: true,
      liveIdentityUsedOperationally: true,
      shipmentProjectionCurrent: true,
      allocationSimulationSucceeded: true,
      persistedAllocationEventReadbackSucceeded: true,
      databaseWritesPerformedByThisScript: 0,
    },
  };
  fs.writeFileSync('/tmp/downstream-100302-evidence.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.assertions));
};

main().finally(() => prisma.$disconnect());
