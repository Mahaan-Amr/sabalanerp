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

const toScaleThree = (value: unknown) => new Prisma.Decimal(String(value || 0)).toFixed(3);

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

const contractedQuantity = (item: { quantity: Prisma.Decimal; productType: string | null }, snapshot: Record<string, any>, unit: string) => {
  if (unit === 'meter') {
    const rawLength = Number(snapshot.length ?? snapshot.actualLength ?? snapshot.actualLengthMeters);
    const length = snapshot.lengthUnit === 'cm' ? rawLength / 100 : rawLength;
    const count = Number(snapshot.quantity ?? 1);
    if (Number.isFinite(length) && length > 0 && Number.isFinite(count) && count > 0) return toScaleThree(length * count);
  }
  if (unit === 'squareMeter' && Number(snapshot.squareMeters) > 0) return toScaleThree(snapshot.squareMeters);
  if (['squareMeter', 'ton'].includes(unit) && Number(snapshot.preparedQuantity) > 0) return toScaleThree(snapshot.preparedQuantity);
  return toScaleThree(snapshot.preparedQuantity ?? snapshot.quantity ?? item.quantity);
};

const contractProductSnapshot = (contractData: unknown, productRowId: string | null, productId: string, index: number) => {
  const data = asRecord(contractData);
  const products = Array.isArray(data.products) ? data.products : Array.isArray(data.items) ? data.items : [];
  return asRecord(products.find((product: any) => product?.rowId === productRowId)
    || products[index]
    || products.find((product: any) => product?.productId === productId));
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
});

const persistedEvidencePayload = (item: ShipmentQuantityEvidence) => ({
  contractId: item.contractId, contractItemId: item.contractItemId, productRowId: item.productRowId,
  unit: item.unit, kind: item.kind, quantity: item.quantity, effectiveAt: item.effectiveAt,
  recordedAt: item.recordedAt, sourceType: item.sourceType, sourceId: item.sourceId,
  sourceVersion: item.sourceVersion, metadata: item.metadata || {},
});

export const shipmentQuantityEvidenceIntegrityHash = (item: ShipmentQuantityEvidence) =>
  hash(persistedEvidencePayload(item));

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
    contract.items.forEach((item, index) => {
      const stableRowId = item.productRowId || `missing:${item.id}`;
      const snapshot = contractProductSnapshot(contract.contractData, item.productRowId, item.productId, index);
      const unit = inferUnit(item, snapshot);
      if (!explicitContractRows.has(item.id)) {
        const quantity = contractedQuantity(item, snapshot, unit);
        const identity = { contractId: contract.id, contractItemId: item.id, productRowId: stableRowId, unit, quantity };
        evidence.push({
          id: `current-contract:${item.id}`, ...identity, kind: 'CONTRACTED_SET',
          effectiveAt: approval.toISOString(), recordedAt: contract.updatedAt.toISOString(),
          sourceType: 'CURRENT_FINANCIALLY_APPROVED_CONTRACT_ROW', sourceId: item.id, sourceVersion: 1,
          integrityHash: hash(identity),
        });
      }
      if (!item.productRowId) {
        evidence.push({
          id: `missing-row:${item.id}`, contractId: contract.id, contractItemId: item.id, productRowId: stableRowId, unit,
          kind: 'EVIDENCE_CONFLICT', quantity: '0.000', effectiveAt: approval.toISOString(), recordedAt: contract.updatedAt.toISOString(),
          sourceType: 'CONTRACT_ROW_IDENTITY_CONFLICT', sourceId: item.id, sourceVersion: 1,
          integrityHash: hash({ itemId: item.id, reason: 'missing productRowId' }), metadata: { reason: 'Stable product row identity is missing' },
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

  const result = projectShipmentQuantities(evidence, {
    ...options,
    lastVerifiedRows: previous.flatMap((row) => row.contracted === null || row.finalizedReserved === null || row.physicallyDispatched === null || row.availableToLoad === null || !row.lastVerifiedAt
      || (options.cutoff && row.lastVerifiedAt.toISOString() > options.cutoff) ? [] : [{
      contractId: row.contractId, contractItemId: row.contractItemId, productRowId: row.productRowId, unit: row.unit,
      quantities: {
        contracted: row.contracted.toFixed(3), finalizedReserved: row.finalizedReserved.toFixed(3),
        physicallyDispatched: row.physicallyDispatched.toFixed(3), availableToLoad: row.availableToLoad.toFixed(3),
      },
      verifiedAt: row.lastVerifiedAt.toISOString(),
    }]),
  });
  const presentation = new Map<string, { contractNumber: string; productName: string | null }>();
  for (const contract of contracts) contract.items.forEach((item, index) => {
    const snapshot = contractProductSnapshot(contract.contractData, item.productRowId, item.productId, index);
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
  const result = await readShipmentQuantityProjection(prisma, scope);
  await prisma.$transaction(result.rows.map((row) => prisma.shipmentQuantityProjection.upsert({
    where: { contractItemId: row.contractItemId },
    create: {
      contractItemId: row.contractItemId, contractId: row.contractId, productRowId: row.productRowId, unit: row.unit,
      contracted: row.quantities?.contracted, finalizedReserved: row.quantities?.finalizedReserved,
      physicallyDispatched: row.quantities?.physicallyDispatched, availableToLoad: row.quantities?.availableToLoad,
      health: row.health, healthReasons: row.healthReasons as string[], sourceEvidenceIds: row.sourceEvidenceIds as string[],
      cutoff: new Date(row.cutoff), lastVerifiedAt: row.lastVerifiedAt ? new Date(row.lastVerifiedAt) : null,
      integrityHash: hash(row),
    },
    update: {
      productRowId: row.productRowId, unit: row.unit, contracted: row.quantities?.contracted,
      finalizedReserved: row.quantities?.finalizedReserved, physicallyDispatched: row.quantities?.physicallyDispatched,
      availableToLoad: row.quantities?.availableToLoad, health: row.health, healthReasons: row.healthReasons as string[],
      sourceEvidenceIds: row.sourceEvidenceIds as string[], cutoff: new Date(row.cutoff), refreshedAt: new Date(),
      lastVerifiedAt: row.lastVerifiedAt ? new Date(row.lastVerifiedAt) : null, integrityHash: hash(row),
    },
  })));
  return result;
};
