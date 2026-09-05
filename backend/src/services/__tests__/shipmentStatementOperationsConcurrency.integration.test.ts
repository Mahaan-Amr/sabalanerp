import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { SHIPMENT_STATEMENT_OPERATIONS_ID, SHIPMENT_STATEMENT_OPERATIONS_LOCK } from '../dispatchDocuments/featureGate';
import { transitionShipmentStatementOperations } from '../shipmentStatementOperations';
import { PrismaShipmentStatementCutoverRepository } from '../shipmentStatementCutover/prismaRepository';
import { finalizeCanonicalLoadingAllocations } from '../dispatchAllocation';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';
import { createConcurrentPricingFixture } from './shipmentStatementConcurrency/pricingFixture';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const json = (value: unknown) => value as Prisma.InputJsonValue;

const seedCanonicalContractTemplate = async (client: PrismaClient, runId: string) => {
  const department = await client.department.create({ data: {
    name: `operations-${runId}`, namePersian: `operations-${runId}-fa`,
  } });
  const seller = await client.user.create({ data: {
    username: `operations-seller-${runId}`, email: `operations-seller-${runId}@example.invalid`,
    password: 'not-a-login', firstName: 'Operations', lastName: 'Seller', departmentId: department.id,
  } });
  const customer = await client.crmCustomer.create({ data: { firstName: 'Operations', lastName: 'Customer' } });
  const product = await client.product.create({ data: {
    code: `operations-${runId}`, name: 'Operations product', namePersian: 'محصول آزمون عملیات',
    cuttingDimensionCode: 'prepared', cuttingDimensionName: 'Prepared', cuttingDimensionNamePersian: 'آماده',
    stoneTypeCode: 'test', stoneTypeName: 'Test', stoneTypeNamePersian: 'آزمون',
    widthCode: '40', widthValue: '40', widthName: '40', thicknessCode: '2', thicknessValue: '2', thicknessName: '2',
    mineCode: 'test', mineName: 'Test', mineNamePersian: 'آزمون', finishCode: 'test', finishName: 'Test',
    finishNamePersian: 'آزمون', colorCode: 'test', colorName: 'Test', colorNamePersian: 'آزمون',
    qualityCode: 'test', qualityName: 'Test', qualityNamePersian: 'آزمون', images: [],
  } });
  const productRowId = `template-row-${randomUUID()}`;
  const graph = {
    schemaVersion: 1, revision: 1,
    calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    catalogSnapshots: [{ catalogProductId: product.id, snapshotVersion: 'catalog-v1', facts: {} }],
    rows: [{ productRowId, catalogProductId: product.id, catalogSnapshotVersion: 'catalog-v1',
      productType: 'prepared', contractualTitle: 'Operations product',
      commercial: { requestedQuantity: '1', totalAmountToman: '100' } }],
    stairSystems: [], layerConfigurations: [], sourceBatches: [], remainingStones: [], allocations: [],
    operationGroups: [], toolSelections: [], finishingSelections: [],
  };
  const hash = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
  await client.salesContract.create({ data: {
    contractNumber: `OPERATIONS-TEMPLATE-${runId}`, title: 'Operations template', titlePersian: 'قالب آزمون عملیات',
    content: '', status: 'APPROVED', customerId: customer.id, departmentId: department.id,
    createdBy: seller.id, responsibleSellerId: seller.id, totalAmount: '100', currency: 'تومان',
    contractData: json({ products: [] }),
    items: { create: { productId: product.id, productRowId, productType: 'prepared', quantity: '1',
      unitPrice: '100', totalPrice: '100', description: 'Operations product' } },
    productGraphState: { create: { schemaVersion: 1, revision: 1, graph: json(graph),
      policySnapshot: json(graph.calculationPolicy), inputHash: hash, resultHash: hash, totalAmountToman: '100' } },
  } });
};

const run = async () => {
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(sourceDatabaseUrl, 'DATABASE_URL must target sabalanerp-local');
  const database = await createTemporaryConcurrencyDatabase({
    repositoryRoot: path.resolve(process.cwd(), '..'), sourceDatabaseUrl, migrateEmptySchema: true,
  });
  const holder = database.client();
  const operator = database.client();
  const reader = database.client();
  const originalRuntimeGate = process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED;
  process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED = 'true';
  try {
    await seedCanonicalContractTemplate(operator, database.runId);
    const migrationManifest = await operator.shipmentStatementMigrationManifest.create({ data: {
      migrationName: 'concurrency-test-manifest', schemaVersion: 1,
      sourceSchemaHash: 'b'.repeat(64), createdBy: 'concurrency-test',
    } });
    let releaseHolder!: () => void;
    const released = new Promise<void>(resolve => { releaseHolder = resolve; });
    let holderLocked!: () => void;
    const locked = new Promise<void>(resolve => { holderLocked = resolve; });
    const inFlightOperation = holder.$transaction(async tx => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', SHIPMENT_STATEMENT_OPERATIONS_LOCK);
      holderLocked();
      await released;
    });
    await locked;

    const leaseExpiresAt = new Date(Date.now() + 250);
    const manifestExpiresAt = new Date(Date.now() + 60_000);
    await operator.deploymentOperation.create({ data: {
      id: 'shipment-cutover-concurrency', activeKey: 'production', releaseId: 'release-concurrency',
      targetCommit: 'commit-concurrency', owner: 'concurrency-test', phase: 'MIGRATIONS_APPLIED',
      leaseToken: 'lease-concurrency', leaseExpiresAt, heartbeatAt: new Date(), startedAt: new Date(),
    } });
    let activationFinished = false;
    const activation = new PrismaShipmentStatementCutoverRepository(operator).activate({
      expectedDisabled: true, migrationManifestId: migrationManifest.id, integrityHash: 'a'.repeat(64),
      activatedBy: 'concurrency-test', expiresAt: manifestExpiresAt,
      productionBoundary: { deploymentId: 'shipment-cutover-concurrency', leaseToken: 'lease-concurrency',
        releaseId: 'release-concurrency', targetCommit: 'commit-concurrency' },
    }).then(result => ({ result, error: null }), error => ({ result: null, error }));
    activation.then(() => { activationFinished = true; });
    await delay(400);
    assert.equal(activationFinished, false, 'activation must drain a finalization that already owns the shared lock');
    releaseHolder();
    await inFlightOperation;
    const expiredActivation = await activation;
    assert.match(String(expiredActivation.error), /live deployment lease/i,
      'a lease expiring while activation waits for the shared lock must fail closed');
    assert.equal(await operator.shipmentStatementCutover.count({ where: {
      id: SHIPMENT_STATEMENT_OPERATIONS_ID, enabled: true,
    } }), 0, 'an activation with a lease that expired while waiting must persist nothing');
    const renewedLeaseExpiresAt = new Date(Date.now() + 60_000);
    await operator.deploymentOperation.update({ where: { id: 'shipment-cutover-concurrency' },
      data: { leaseExpiresAt: renewedLeaseExpiresAt, heartbeatAt: new Date() } });
    const activated = await new PrismaShipmentStatementCutoverRepository(operator).activate({
      expectedDisabled: true, migrationManifestId: migrationManifest.id, integrityHash: 'a'.repeat(64),
      activatedBy: 'concurrency-test', expiresAt: renewedLeaseExpiresAt,
      productionBoundary: { deploymentId: 'shipment-cutover-concurrency', leaseToken: 'lease-concurrency',
        releaseId: 'release-concurrency', targetCommit: 'commit-concurrency' },
    });
    assert.equal(activated.enabled, true);
    const activatedControl = await operator.shipmentStatementOperationsControl.findUniqueOrThrow({
      where: { id: SHIPMENT_STATEMENT_OPERATIONS_ID },
    });
    assert.equal(activatedControl.paused, false);
    assert.equal(activatedControl.revision, 1);

    const fixture = await createConcurrentPricingFixture(operator, database.runId, database.databaseUrl,
      { activateCutover: false });
    let releaseFinalization!: () => void;
    const finalizationReleased = new Promise<void>(resolve => { releaseFinalization = resolve; });
    let finalizationLocked!: () => void;
    const finalizationReachedLock = new Promise<void>(resolve => { finalizationLocked = resolve; });
    const finalizer = new Proxy(holder, { get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver);
      return (work: (tx: any) => Promise<unknown>, options?: unknown) => target.$transaction(async tx => {
        const observed = new Proxy(tx, { get(inner, txProperty, txReceiver) {
          if (txProperty !== '$executeRawUnsafe') return Reflect.get(inner, txProperty, txReceiver);
          return async (sql: string, ...values: unknown[]) => {
            const result = await tx.$executeRawUnsafe(sql, ...values);
            if (values[0] === SHIPMENT_STATEMENT_OPERATIONS_LOCK) {
              finalizationLocked();
              await finalizationReleased;
            }
            return result;
          };
        } });
        return work(observed);
      }, options as never);
    } }) as PrismaClient;
    const finalization = finalizeCanonicalLoadingAllocations(finalizer, {
      loadingId: fixture.loadings[0].id, idempotencyKey: `operations-race-${database.runId}`,
      actorId: fixture.actorId, effectiveAuthority: fixture.effectiveAuthority,
    });
    await finalizationReachedLock;
    let pauseFinished = false;
    const pause = transitionShipmentStatementOperations(operator, {
      action: 'PAUSE_PLANNED', actorId: 'operator-1', expectedRevision: 1,
      reason: 'Pause after draining the operation.',
    }, { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' }).then(result => { pauseFinished = true; return result; });
    await delay(150);
    assert.equal(pauseFinished, false, 'pause must wait for real allocation finalization holding the shared lock');
    releaseFinalization();
    const finalized = await finalization;
    assert.equal(finalized.revisions.length, 1);
    assert.equal(await observerCount(operator, finalized.revisions[0].id), 1,
      'the drained real finalization persists its immutable priced event before pause commits');
    const paused = await pause;
    assert.equal(paused.control.paused, true);

    const revisionsBeforeBlockedAttempt = await reader.logisticsAllocationRevision.count();
    await assert.rejects(() => finalizeCanonicalLoadingAllocations(reader, {
      loadingId: fixture.loadings[1].id, idempotencyKey: `operations-blocked-${database.runId}`,
      actorId: fixture.actorId, effectiveAuthority: fixture.effectiveAuthority,
    }), /paused|temporarily unavailable/i);
    assert.equal(await reader.logisticsAllocationRevision.count(), revisionsBeforeBlockedAttempt,
      'a real finalization beginning after pause must persist no revision or pricing evidence');
  } finally {
    if (originalRuntimeGate === undefined) delete process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED;
    else process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED = originalRuntimeGate;
    await Promise.all([holder.$disconnect(), operator.$disconnect(), reader.$disconnect()]);
    await database.cleanup();
  }

  const source = new PrismaClient({ datasources: { db: { url: sourceDatabaseUrl } } });
  try {
    const remaining = await source.$queryRawUnsafe<Array<{ exists: boolean }>>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists', database.databaseName);
    assert.equal(remaining[0]?.exists, false, 'the exact temporary concurrency database must be removed');
  } finally { await source.$disconnect(); }
};

const observerCount = (client: PrismaClient, allocationRevisionId: string) => client.dispatchPricedAllocationEvent.count({
  where: { allocationRevisionId },
});

run().then(() => console.log('shipment statement operations PostgreSQL concurrency: ok'));
