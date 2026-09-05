import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { GuardDriverQueueTurnStatus, Prisma, type LogisticsLoading, type PrismaClient } from '@prisma/client';
import { createAuthorizedActorFixture } from './authorityFixture';
import { createProductionApprovedPricingFixture } from './productionApprovedPricingFixture';

const json = (value: unknown) => value as Prisma.InputJsonValue;

export const authorConcurrentPricingFixture = async (
  client: PrismaClient,
  runId: string,
  options: { activateCutover?: boolean } = {},
) => {
  const approved = await createProductionApprovedPricingFixture(client, { runId, quantity: '2', amount: '100' });
  const logistics = await createAuthorizedActorFixture(client, { runId, workspace: 'logistics',
    feature: 'logistics_loadings_finalize' });
  const manifest = await client.shipmentStatementMigrationManifest.create({ data: { id: `concurrency-manifest-${runId}`,
    migrationName: `concurrency-${runId}`, schemaVersion: 1, sourceSchemaHash: 'e'.repeat(64), createdBy: logistics.actor.id } });
  if (options.activateCutover !== false) {
    await client.shipmentStatementCutover.update({ where: { id: 'customer-shipment-statements' }, data: {
      enabled: true, cutoverAt: new Date('2000-01-01T00:00:00.000Z'), activatedAt: new Date('2000-01-01T00:00:01.000Z'),
      activatedBy: logistics.actor.id, manifestId: manifest.id, integrityHash: 'f'.repeat(64) } });
    await client.shipmentStatementOperationsControl.update({
      where: { id: 'customer-shipment-statements' }, data: { paused: false, incident: false },
    });
  }
  const expiresAt = new Date(Date.now() + 86_400_000 * 365);
  const loadings: LogisticsLoading[] = [];
  for (let index = 0; index < 2; index += 1) {
    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const loadingId = randomUUID();
    const queueTurnId = randomUUID();
    await client.externalDriver.create({ data: { id: driverId, firstName: 'Issue', lastName: `260-${index}`,
      nationalCode: createHash('sha256').update(driverId).digest('hex').slice(0, 10),
      phone: `09${createHash('sha256').update(driverId).digest('hex').replace(/[a-f]/g, '1').slice(0, 9)}`,
      status: 'ACTIVE', statusRecordedBy: logistics.actor.id, createdBy: logistics.actor.id,
      documents: { create: { documentType: 'DRIVING_LICENCE', reference: `issue260-${driverId}`,
        expiresAt, recordedBy: logistics.actor.id } } } });
    await client.externalVehicle.create({ data: { id: vehicleId, vehicleType: 'Issue 260 test vehicle',
      status: 'ACTIVE', statusRecordedBy: logistics.actor.id, createdBy: logistics.actor.id,
      plates: { create: { plate: `260-${vehicleId.slice(0, 8)}`, normalizedPlate: `260${vehicleId.replace(/-/g, '').slice(0, 8)}`,
        effectiveFrom: new Date(), reason: 'Issue 260 isolated concurrency fixture', recordedBy: logistics.actor.id } },
      documents: { create: { documentType: 'VEHICLE_REGISTRATION', reference: `issue260-${vehicleId}`,
        expiresAt, recordedBy: logistics.actor.id } } } });
    const loading = await client.logisticsLoading.create({ data: { id: loadingId,
      loadingNumber: `ISSUE260-${runId}-${index}`, customerId: approved.contract.customerId, projectId: approved.project.id,
      status: 'DRAFT', createdBy: logistics.actor.id, lines: { create: { sourceContractId: approved.contract.id,
        sourceContractItemId: approved.item.id, productRowId: approved.productRowId, productId: approved.productId,
        quantity: '1.000', unit: approved.pricingRow.unit, sourceSnapshot: json({ issue260: runId }) } } } });
    await client.guardDriverQueueTurn.create({ data: { id: queueTurnId, driverSource: 'EXTERNAL',
      status: GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING, externalDriverId: driverId, externalVehicleId: vehicleId,
      admittedAt: new Date(), admittedBy: logistics.actor.id, snapshotSchemaVersion: 1,
      admissionSnapshot: json({ schemaVersion: 1, externalDriverId: driverId, externalVehicleId: vehicleId }),
      integrityHash: createHash('sha256').update(`queue:${queueTurnId}`).digest('hex'), loadingId: loading.id,
      availableAt: new Date(), availableBy: logistics.actor.id, reservedAt: new Date(), reservedBy: logistics.actor.id } });
    await client.logisticsAllocationDraft.create({ data: { loadingId: loading.id, queueTurnId, createdBy: logistics.actor.id,
      lines: { create: { sourceContractId: approved.contract.id, sourceContractItemId: approved.item.id,
        productRowId: approved.productRowId, productId: approved.productId, quantity: '1.000', unit: approved.pricingRow.unit,
        snapshot: json({ issue260: runId, index }) } } } });
    loadings.push(loading);
  }
  return { actorId: logistics.actor.id, effectiveAuthority: logistics.authority, loadings,
    versionId: approved.head.currentVersion.id, rowId: approved.pricingRow.id, contractedQuantity: '2.000',
    expectedGrossAmount: approved.pricingRow.canonicalAllInTotal.toFixed(12),
    approvedVersionGrossAmount: approved.head.currentVersion.grossAmount.toFixed(12),
    versionIntegrityHash: approved.head.currentVersion.integrityHash,
    readinessEvidenceHash: approved.readiness.evidenceHash };
};

export const createConcurrentPricingFixture = async (client: PrismaClient, runId: string, databaseUrl: string,
  options: { activateCutover?: boolean } = {}) => {
  const child = spawnSync(process.execPath, [path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.resolve(process.cwd(), 'src', 'services', '__tests__', 'shipmentStatementConcurrency',
      'pricingFixtureSetup.test.ts')], { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, ISSUE260_PARENT_RUN_ID: runId,
      ISSUE260_ACTIVATE_CUTOVER: options.activateCutover === false ? 'false' : 'true' } });
  assert.equal(child.error, undefined, `production pricing fixture subprocess failed: ${child.error?.message || ''}`);
  assert.equal(child.signal, null, `production pricing fixture subprocess timed out: ${child.signal || ''}`);
  assert.equal(child.status, 0, `production pricing fixture subprocess failed\n${child.stdout}\n${child.stderr}`);
  const proofs = child.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    try { return JSON.parse(line) as Record<string, any>; } catch { return null; }
  }).filter((proof): proof is Record<string, any> => proof?.kind === 'issue260-production-pricing-fixture');
  assert.equal(proofs.length, 1, 'production pricing fixture must emit exactly one proof');
  const proof = proofs[0];
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.parentRunId, runId);
  assert.equal(proof.databaseName, new URL(databaseUrl).pathname.slice(1));
  assert.deepEqual(proof.loadingIds?.length, 2);
  assert.match(String(proof.versionIntegrityHash), /^[a-f0-9]{64}$/);
  assert.match(String(proof.readinessEvidenceHash), /^[a-f0-9]{64}$/);
  assert.equal(proof.expectedGrossAmount, proof.approvedVersionGrossAmount);
  const loadings = await client.logisticsLoading.findMany({ where: { id: { in: proof.loadingIds } }, orderBy: { loadingNumber: 'asc' } });
  assert.equal(loadings.length, 2);
  const head = await client.contractApprovedPricingHead.findFirstOrThrow({ where: { currentVersionId: proof.versionId },
    include: { currentVersion: true } });
  assert.equal(head.currentVersion.integrityHash, proof.versionIntegrityHash);
  const readiness = await client.contractPricingReadinessResult.findFirstOrThrow({ where: {
    pricingVersionId: proof.versionId, status: 'READY' }, orderBy: { evaluatedAt: 'desc' } });
  assert.equal(readiness.evidenceHash, proof.readinessEvidenceHash);
  return { actorId: String(proof.actorId), effectiveAuthority: proof.effectiveAuthority,
    loadings, versionId: String(proof.versionId), rowId: String(proof.rowId),
    contractedQuantity: String(proof.contractedQuantity), expectedGrossAmount: String(proof.expectedGrossAmount),
    approvedVersionGrossAmount: String(proof.approvedVersionGrossAmount),
    versionIntegrityHash: String(proof.versionIntegrityHash), readinessEvidenceHash: String(proof.readinessEvidenceHash) };
};

export type ConcurrentPricingFixture = Awaited<ReturnType<typeof createConcurrentPricingFixture>>;
