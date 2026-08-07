import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  projectShipmentQuantities,
  type ShipmentQuantityEvidence,
  type ShipmentQuantityProjection,
} from './shipmentQuantityProjection';

type Scope = { contractId?: string; customerId?: string };

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

const exactScaleThree = (value: unknown) => {
  const decimal = new Prisma.Decimal(String(value));
  if (!decimal.isFinite() || decimal.decimalPlaces() > 3) throw new Error(`Quantity exceeds canonical scale three: ${value}`);
  return decimal.toFixed(3);
};

const inferUnit = (item: { productType: string | null }, snapshot: Record<string, any>) => {
  const explicit = String(snapshot.unit || snapshot.preparedUnit || snapshot.meta?.unit || '');
  if (explicit.includes('متر طول') || explicit === 'meter') return 'meter';
  if (explicit.includes('متر مربع') || explicit === 'squareMeter') return 'squareMeter';
  if (explicit.includes('عدد') || explicit === 'count') return 'count';
  if (explicit) return explicit;
  const type = String(item.productType || snapshot.productType || '').toLowerCase();
  if (type.includes('longitudinal') || type.includes('طولی')) return 'meter';
  if (type.includes('slab') || type.includes('اسلب')) return 'squareMeter';
  return 'count';
};

export const deriveContractedQuantity = (item: { quantity: Prisma.Decimal; productType: string | null }, snapshot: Record<string, any>, unit: string) => {
  if (unit === 'meter') {
    const rawLength = new Prisma.Decimal(String(snapshot.length ?? snapshot.actualLength ?? snapshot.actualLengthMeters ?? 0));
    const length = snapshot.lengthUnit === 'cm' ? rawLength.div(100) : rawLength;
    const count = new Prisma.Decimal(String(snapshot.quantity ?? 1));
    if (length.gt(0) && count.gt(0)) return exactScaleThree(length.mul(count));
  }
  if (unit === 'squareMeter' && new Prisma.Decimal(String(snapshot.squareMeters ?? 0)).gt(0)) return exactScaleThree(snapshot.squareMeters);
  if (['squareMeter', 'ton'].includes(unit) && new Prisma.Decimal(String(snapshot.preparedQuantity ?? 0)).gt(0)) return exactScaleThree(snapshot.preparedQuantity);
  return exactScaleThree(snapshot.preparedQuantity ?? snapshot.quantity ?? item.quantity);
};

export const resolveContractProductSnapshot = (contractData: unknown, identity: { productRowId: string | null; productId: string; legacyProductIndex?: number | null }) => {
  const data = asRecord(contractData);
  const products = Array.isArray(data.products) ? data.products : Array.isArray(data.items) ? data.items : [];
  if (identity.productRowId) {
    const exact = products.find((product: any) => product?.rowId === identity.productRowId);
    return exact ? { snapshot: asRecord(exact), conflict: null } : { snapshot: null, conflict: 'Stable productRowId has no matching contract row' };
  }
  if (Number.isInteger(identity.legacyProductIndex) && (identity.legacyProductIndex as number) >= 0) {
    const candidate = products[identity.legacyProductIndex as number];
    if (candidate?.productId === identity.productId) return { snapshot: asRecord(candidate), conflict: null };
    return { snapshot: null, conflict: 'Legacy product index and product ID do not agree' };
  }
  return { snapshot: null, conflict: 'Stable productRowId is missing and no validated legacy index exists' };
};

const mapPersistedEvidence = (item: any): ShipmentQuantityEvidence => ({
  id: item.id,
  contractId: item.contractId,
  contractItemId: item.contractItemId,
  productRowId: item.productRowId,
  unit: item.unit,
  kind: item.kind,
  quantity: item.quantity.toFixed(3),
  effectiveAt: item.effectiveAt.toISOString(),
  recordedAt: item.recordedAt.toISOString(),
  sourceType: item.sourceType,
  sourceId: item.sourceId,
  sourceVersion: item.sourceVersion,
  integrityHash: item.integrityHash,
  metadata: asRecord(item.metadata),
  guardReturnMovementId: item.guardReturnMovementId || undefined,
  returnEvidenceId: item.returnEvidenceId || undefined,
});

const persistedEvidencePayload = (item: ShipmentQuantityEvidence) => ({
  contractId: item.contractId, contractItemId: item.contractItemId, productRowId: item.productRowId,
  unit: item.unit, kind: item.kind, quantity: item.quantity, effectiveAt: item.effectiveAt,
  recordedAt: item.recordedAt, sourceType: item.sourceType, sourceId: item.sourceId,
  sourceVersion: item.sourceVersion, metadata: item.metadata || {},
  guardReturnMovementId: item.guardReturnMovementId || null, returnEvidenceId: item.returnEvidenceId || null,
});

export const shipmentQuantityEvidenceIntegrityHash = (item: ShipmentQuantityEvidence) =>
  hash(persistedEvidencePayload(item));

const projectionIntegrityPayload = (row: {
  contractId: string; contractItemId: string; productRowId: string; unit: string;
  quantities: { contracted: string; finalizedReserved: string; physicallyDispatched: string; availableToLoad: string } | null;
  health: string; healthReasons: readonly string[]; sourceEvidenceIds: readonly string[]; cutoff: string; lastVerifiedAt: string | null;
}) => ({
  contractId: row.contractId, contractItemId: row.contractItemId, productRowId: row.productRowId, unit: row.unit,
  quantities: row.quantities, health: row.health, healthReasons: row.healthReasons,
  sourceEvidenceIds: row.sourceEvidenceIds, cutoff: row.cutoff, lastVerifiedAt: row.lastVerifiedAt,
});

export const shipmentQuantityProjectionIntegrityHash = (row: Parameters<typeof projectionIntegrityPayload>[0]) =>
  hash(projectionIntegrityPayload(row));

export const captureFinanciallyApprovedContractQuantityVersions = async (prisma: PrismaClient, scope: Scope, cutoverAt = new Date()) => {
  const contracts = await prisma.salesContract.findMany({
    where: { ...(scope.contractId ? { id: scope.contractId } : {}), ...(scope.customerId ? { customerId: scope.customerId } : {}) },
    include: { items: true },
  });
  const approvals = await prisma.accountingFinancialRecord.findMany({
    where: { contractId: { in: contracts.map((contract) => contract.id) }, financiallyApprovedAt: { not: null } },
    select: { contractId: true, financiallyApprovedAt: true }, orderBy: { financiallyApprovedAt: 'desc' },
  });
  const approvalByContract = new Map<string, Date>();
  approvals.forEach((approval) => { if (approval.contractId && !approvalByContract.has(approval.contractId)) approvalByContract.set(approval.contractId, approval.financiallyApprovedAt!); });
  const existingVersions = await prisma.shipmentQuantityEvidence.findMany({
    where: { contractId: { in: contracts.map((contract) => contract.id) }, kind: 'CONTRACTED_SET' },
    orderBy: { sourceVersion: 'desc' },
  });
  const latestByRow = new Map<string, typeof existingVersions[number]>();
  existingVersions.forEach((version) => { if (!latestByRow.has(version.contractItemId)) latestByRow.set(version.contractItemId, version); });
  const versions: Array<Omit<ShipmentQuantityEvidence, 'id'>> = [];
  for (const contract of contracts) {
    const approval = approvalByContract.get(contract.id);
    if (!approval) continue;
    for (const item of contract.items) {
      const resolution = resolveContractProductSnapshot(contract.contractData, { productRowId: item.productRowId, productId: item.productId });
      const snapshot = resolution.snapshot || {};
      const unit = inferUnit(item, snapshot);
      const previousVersion = latestByRow.get(item.id);
      const sourceVersion = (previousVersion?.sourceVersion || 0) + 1;
      const effectiveAt = previousVersion ? approval : cutoverAt;
      const common = {
        contractId: contract.id, contractItemId: item.id, productRowId: item.productRowId || `missing:${item.id}`, unit,
        effectiveAt: effectiveAt.toISOString(), recordedAt: cutoverAt.toISOString(), sourceId: item.id, sourceVersion,
      };
      try {
        if (resolution.conflict) throw new Error(resolution.conflict);
        const quantity = deriveContractedQuantity(item, snapshot, unit);
        if (previousVersion && previousVersion.quantity.toFixed(3) === quantity && previousVersion.unit === unit
          && previousVersion.productRowId === common.productRowId && asRecord(previousVersion.metadata).financiallyApprovedAt === approval.toISOString()) continue;
        const version = { ...common, kind: 'CONTRACTED_SET' as const, quantity, sourceType: 'FINANCIALLY_APPROVED_CONTRACT_QUANTITY_VERSION', metadata: { financiallyApprovedAt: approval.toISOString(), capturedAtCutover: !previousVersion }, integrityHash: '' };
        versions.push({ ...version, integrityHash: shipmentQuantityEvidenceIntegrityHash({ id: '', ...version }) });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Contract quantity version could not be captured';
        const version = { ...common, kind: 'EVIDENCE_CONFLICT' as const, quantity: '0.000', sourceType: 'CONTRACT_QUANTITY_VERSION_CAPTURE_CONFLICT', metadata: { reason, financiallyApprovedAt: approval.toISOString() }, integrityHash: '' };
        versions.push({ ...version, integrityHash: shipmentQuantityEvidenceIntegrityHash({ id: '', ...version }) });
      }
    }
  }
  if (versions.length > 0) await prisma.shipmentQuantityEvidence.createMany({
    data: versions.map((item) => ({ ...item, effectiveAt: new Date(item.effectiveAt), recordedAt: new Date(item.recordedAt), quantity: item.quantity, metadata: item.metadata as Prisma.InputJsonValue })),
    skipDuplicates: true,
  });
  return versions.length;
};

export const readShipmentQuantityProjection = async (
  prisma: PrismaClient,
  scope: Scope,
  options: { cutoff?: string; mode?: 'OPERATIONAL_AS_OF' | 'AUDIT_KNOWN_AT' } = {},
): Promise<ShipmentQuantityProjection> => {
  if (!scope.contractId && !scope.customerId) throw new Error('A contract or customer scope is required');
  const contracts = await prisma.salesContract.findMany({
    where: {
      ...(scope.contractId ? { id: scope.contractId } : {}),
      ...(scope.customerId ? { customerId: scope.customerId } : {}),
    },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      logisticsLoadingLines: {
        where: { loading: { status: 'FINALIZED' } },
        include: { loading: { include: { securityVehicleMovements: true } }, corrections: true },
      },
    },
  });
  if (contracts.length === 0) return projectShipmentQuantities([], options);

  const contractIds = contracts.map((contract) => contract.id);
  const [approvals, persisted, previous] = await Promise.all([
    prisma.accountingFinancialRecord.findMany({
      where: { contractId: { in: contractIds }, financiallyApprovedAt: { not: null } },
      select: { contractId: true, financiallyApprovedAt: true },
      orderBy: { financiallyApprovedAt: 'asc' },
    }),
    prisma.shipmentQuantityEvidence.findMany({ where: { contractId: { in: contractIds } } }),
    prisma.shipmentQuantityProjection.findMany({ where: { contractId: { in: contractIds }, lastVerifiedAt: { not: null } } }),
  ]);
  const approvedAt = new Map(approvals.map((item) => [item.contractId, item.financiallyApprovedAt!]));
  const evidence: ShipmentQuantityEvidence[] = [];
  for (const item of persisted.map(mapPersistedEvidence)) {
    if (item.integrityHash === shipmentQuantityEvidenceIntegrityHash(item)) {
      evidence.push(item);
      continue;
    }
    evidence.push({
      ...item,
      id: `integrity-conflict:${item.id}`,
      kind: 'EVIDENCE_CONFLICT',
      quantity: '0.000',
      sourceType: 'SHIPMENT_EVIDENCE_INTEGRITY_CONFLICT',
      sourceId: item.id,
      sourceVersion: 1,
      integrityHash: hash({ evidenceId: item.id, observedHash: item.integrityHash }),
      metadata: { reason: `Integrity check failed for evidence ${item.id}` },
    });
  }
  const explicitContractRows = new Set(persisted.filter((item) => item.kind === 'CONTRACTED_SET').map((item) => item.contractItemId));
  const explicitLegacySources = new Set(persisted.filter((item) => item.sourceType.startsWith('LEGACY_')).map((item) => item.sourceId));

  for (const contract of contracts) {
    const approval = approvedAt.get(contract.id);
    if (!approval) continue;
    contract.items.forEach((item) => {
      const stableRowId = item.productRowId || `missing:${item.id}`;
      const resolution = resolveContractProductSnapshot(contract.contractData, { productRowId: item.productRowId, productId: item.productId });
      const snapshot = resolution.snapshot || {};
      const unit = inferUnit(item, snapshot);
      if (!explicitContractRows.has(item.id)) {
        evidence.push({
          id: `missing-version:${item.id}`, contractId: contract.id, contractItemId: item.id, productRowId: stableRowId, unit,
          kind: 'EVIDENCE_CONFLICT', quantity: '0.000', effectiveAt: options.cutoff || new Date().toISOString(), recordedAt: new Date().toISOString(),
          sourceType: 'CONTRACT_QUANTITY_VERSION_MISSING', sourceId: item.id, sourceVersion: 1,
          integrityHash: hash({ itemId: item.id, reason: 'approved version missing' }),
          metadata: { reason: 'Financially approved contract quantity version is missing; rebuild the cutover baseline' },
        });
      }
      if (resolution.conflict) {
        evidence.push({
          id: `missing-row:${item.id}`, contractId: contract.id, contractItemId: item.id, productRowId: stableRowId, unit,
          kind: 'EVIDENCE_CONFLICT', quantity: '0.000', effectiveAt: approval.toISOString(), recordedAt: contract.updatedAt.toISOString(),
          sourceType: 'CONTRACT_ROW_IDENTITY_CONFLICT', sourceId: item.id, sourceVersion: 1,
          integrityHash: hash({ itemId: item.id, reason: resolution.conflict }), metadata: { reason: resolution.conflict },
        });
      }
    });

    for (const line of contract.logisticsLoadingLines) {
      if (explicitLegacySources.has(line.id)) continue;
      const item = contract.items.find((candidate) => candidate.id === line.sourceContractItemId);
      if (!item) continue;
      const verifiedExit = line.loading.securityVehicleMovements.some((movement) => movement.direction === 'OUTBOUND' && movement.status === 'EXITED');
      const kind = verifiedExit ? 'LEGACY_DISPATCHED' as const : 'LEGACY_UNRECONCILED_RESERVED' as const;
      const effectiveAt = verifiedExit
        ? line.loading.securityVehicleMovements.find((movement) => movement.direction === 'OUTBOUND' && movement.status === 'EXITED')!.occurredAt
        : line.loading.finalizedAt || line.loading.updatedAt;
      const base = {
        contractId: contract.id, contractItemId: item.id, productRowId: item.productRowId || `missing:${item.id}`,
        unit: line.unit, effectiveAt: effectiveAt.toISOString(), recordedAt: line.loading.updatedAt.toISOString(), kind,
      };
      evidence.push({
        id: `legacy-loading:${line.id}`, ...base, quantity: line.quantity.toFixed(3), sourceType: 'LEGACY_LOADING_LINE',
        sourceId: line.id, sourceVersion: 1, integrityHash: hash({ ...base, quantity: line.quantity.toFixed(3) }),
      });
      line.corrections.forEach((correction) => evidence.push({
        id: `legacy-correction:${correction.id}`, ...base, quantity: correction.deltaQuantity.toFixed(3),
        effectiveAt: correction.createdAt.toISOString(), recordedAt: correction.createdAt.toISOString(),
        sourceType: 'LEGACY_LOADING_CORRECTION', sourceId: correction.id, sourceVersion: 1,
        integrityHash: hash({ correctionId: correction.id, quantity: correction.deltaQuantity.toFixed(3) }),
      }));
    }
  }

  const lastVerifiedRows = previous.flatMap((row) => {
    if (row.contracted === null || row.finalizedReserved === null || row.physicallyDispatched === null || row.availableToLoad === null || !row.lastVerifiedAt
      || (options.cutoff && row.lastVerifiedAt.toISOString() > options.cutoff)) return [];
    const normalized = {
      contractId: row.contractId, contractItemId: row.contractItemId, productRowId: row.productRowId, unit: row.unit,
      quantities: { contracted: row.contracted.toFixed(3), finalizedReserved: row.finalizedReserved.toFixed(3), physicallyDispatched: row.physicallyDispatched.toFixed(3), availableToLoad: row.availableToLoad.toFixed(3) },
      health: row.health, healthReasons: asRecord(row.healthReasons) as any, sourceEvidenceIds: row.sourceEvidenceIds as any,
      cutoff: row.cutoff.toISOString(), lastVerifiedAt: row.lastVerifiedAt.toISOString(),
    };
    if (row.integrityHash !== shipmentQuantityProjectionIntegrityHash({ ...normalized, healthReasons: Array.isArray(row.healthReasons) ? row.healthReasons as string[] : [], sourceEvidenceIds: Array.isArray(row.sourceEvidenceIds) ? row.sourceEvidenceIds as string[] : [] })) {
      evidence.push({
        id: `projection-integrity:${row.contractItemId}`, contractId: row.contractId, contractItemId: row.contractItemId,
        productRowId: row.productRowId, unit: row.unit, kind: 'EVIDENCE_CONFLICT', quantity: '0.000',
        effectiveAt: options.cutoff || new Date().toISOString(), recordedAt: new Date().toISOString(),
        sourceType: 'PREVIOUS_PROJECTION_INTEGRITY_CONFLICT', sourceId: row.contractItemId, sourceVersion: 1,
        integrityHash: hash({ row: row.contractItemId, observedHash: row.integrityHash }), metadata: { reason: 'Previous projection integrity check failed' },
      });
      return [];
    }
    return [{ contractId: row.contractId, contractItemId: row.contractItemId, productRowId: row.productRowId, unit: row.unit, quantities: normalized.quantities, verifiedAt: row.lastVerifiedAt.toISOString() }];
  });
  const result = projectShipmentQuantities(evidence, {
    ...options,
    lastVerifiedRows,
  });
  const presentation = new Map<string, { contractNumber: string; productName: string | null }>();
  for (const contract of contracts) contract.items.forEach((item) => {
    const snapshot = resolveContractProductSnapshot(contract.contractData, { productRowId: item.productRowId, productId: item.productId }).snapshot || {};
    presentation.set(item.id, {
      contractNumber: contract.contractNumber,
      productName: String(snapshot.name || snapshot.stoneName || snapshot.productName || '').trim() || null,
    });
  });
  return {
    ...result,
    rows: result.rows.map((row) => ({ ...row, ...presentation.get(row.contractItemId) })),
  };
};

export const rebuildShipmentQuantityProjection = async (prisma: PrismaClient, scope: Scope) => {
  await captureFinanciallyApprovedContractQuantityVersions(prisma, scope);
  const result = await readShipmentQuantityProjection(prisma, scope);
  await prisma.$transaction(result.rows.map((row) => prisma.shipmentQuantityProjection.upsert({
    where: { contractItemId: row.contractItemId },
    create: {
      contractItemId: row.contractItemId, contractId: row.contractId, productRowId: row.productRowId, unit: row.unit,
      contracted: row.quantities?.contracted, finalizedReserved: row.quantities?.finalizedReserved,
      physicallyDispatched: row.quantities?.physicallyDispatched, availableToLoad: row.quantities?.availableToLoad,
      health: row.health, healthReasons: row.healthReasons as string[], sourceEvidenceIds: row.sourceEvidenceIds as string[],
      cutoff: new Date(row.cutoff), lastVerifiedAt: row.lastVerifiedAt ? new Date(row.lastVerifiedAt) : null,
      integrityHash: shipmentQuantityProjectionIntegrityHash(row),
    },
    update: {
      productRowId: row.productRowId, unit: row.unit, contracted: row.quantities?.contracted,
      finalizedReserved: row.quantities?.finalizedReserved, physicallyDispatched: row.quantities?.physicallyDispatched,
      availableToLoad: row.quantities?.availableToLoad, health: row.health, healthReasons: row.healthReasons as string[],
      sourceEvidenceIds: row.sourceEvidenceIds as string[], cutoff: new Date(row.cutoff), refreshedAt: new Date(),
      lastVerifiedAt: row.lastVerifiedAt ? new Date(row.lastVerifiedAt) : null, integrityHash: shipmentQuantityProjectionIntegrityHash(row),
    },
  })));
  return result;
};
