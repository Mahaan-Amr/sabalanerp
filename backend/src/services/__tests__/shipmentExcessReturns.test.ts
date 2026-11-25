import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import {
  captureContractQuantityVersionAtFinancialApproval,
  readShipmentQuantityProjection,
  shipmentQuantityEvidenceIntegrityHash,
  ShipmentReturnConflictError,
} from '../shipmentQuantityProjectionStore';
import { readPhysicalDispatchReturnHolding, recordFinalizedExcessShipmentReturns } from '../shipmentExcessReturns';
import type { ShipmentQuantityEvidence } from '../shipmentQuantityProjection';

const contractId = 'contract';
const contractItemId = 'item';
const productRowId = 'row';
const unit = 'squareMeter';
const identity = { contractId, contractItemId, productRowId, unit };
const date = (day: string) => new Date(`2026-10-${day}T10:00:00.000Z`);
const evidenceAt = (id: string, kind: ShipmentQuantityEvidence['kind'], quantity: string, sourceType: string,
  at: Date, overrides: Partial<ShipmentQuantityEvidence> = {}) => {
  const item = {
    ...identity, id, kind, quantity, sourceType, sourceId: id, sourceVersion: 1,
    effectiveAt: at.toISOString(), recordedAt: at.toISOString(), integrityHash: '', ...overrides,
  };
  return {
    sourceKind: 'SALES_CONTRACT',
    ...item,
    quantity: new Prisma.Decimal(quantity), effectiveAt: at, recordedAt: at,
    integrityHash: shipmentQuantityEvidenceIntegrityHash(item),
    metadata: Object.fromEntries(Object.entries(item.metadata ?? {}).sort(([a], [b]) => a.length - b.length || a.localeCompare(b))),
  };
};
const approval = (number: number, gross: string, approvedAt: Date) => ({
  id: `pricing-${number}`, versionNumber: number, sourceFinancialRecordId: `invoice-${number}`, contractId,
  approvedAt, createdAt: approvedAt,
  rows: [{ id: `pricing-row-${number}`, contractItemId, productRowId, unit, contractedQuantity: new Prisma.Decimal(gross) }],
});

function fixture() {
  const dispatched = evidenceAt('exit-main', 'PHYSICAL_EXIT', '80.000', 'GUARD_PHYSICAL_EXIT', date('02'), {
    metadata: {
      loadingId: 'loading', waybillId: 'waybill', physicalExitId: 'exit', authorizationId: 'authorization',
      allocationLineId: 'allocation-line', allocationRevisionId: 'revision',
    },
  });
  const inbound = { id: 'inbound', loadingId: 'loading', direction: 'INBOUND', purpose: 'SALES_RETURN', status: 'INFO_COMPLETED',
    occurredAt: date('03'), completedAt: date('03') };
  const initial = [
    evidenceAt('captured', 'CONTRACTED_SET', '100.000', 'FINANCIALLY_APPROVED_CONTRACT_QUANTITY_VERSION', date('01')),
    evidenceAt('reserve', 'ALLOCATION_FINALIZED', '90.000', 'LOGISTICS_ALLOCATION_REVISION', date('01'), {
      metadata: { loadingId: 'loading', revisionId: 'revision', loadingLineId: 'line' },
    }),
    dispatched,
    {
      ...evidenceAt('guard-return', 'GUARD_RETURN_VERIFIED', '5.000', 'GUARD_RETURN_MOVEMENT', date('03'), {
        dispatchEvidenceId: 'exit-main', guardReturnMovementId: inbound.id,
        metadata: { loadingId: inbound.loadingId, movementNumber: 'arrival', dispatchLoadingId: inbound.loadingId },
      }),
      guardReturnMovement: inbound, dispatchEvidence: dispatched,
    },
    evidenceAt('posted-correction', 'DISPATCH_CORRECTION_POSTED', '-5.000', 'DISPATCH_CORRECTION', date('04'), {
      returnEvidenceId: 'guard-return', metadata: { waybillId: 'waybill', correctionId: 'correction', reversalOfId: null },
    }),
  ];
  const rows = [...initial];
  const approved = [approval(1, '100.000', date('01'))];
  const previous = new Map<string, any>();
  const contract = {
    id: contractId, contractData: { products: [{ rowId: productRowId, productId: 'stone', unit }] },
    items: [{ id: contractItemId, productRowId, productId: 'stone', retiredAt: null, quantity: new Prisma.Decimal(100) }],
    logisticsLoadingLines: [],
  };
  const tx = {
    $queryRaw: async () => [],
    $executeRawUnsafe: async () => 0,
    salesContract: { findMany: async () => [contract], findUnique: async () => contract },
    accountingFinancialRecord: { findMany: async () => approved.map(entry => ({
      contractId, financiallyApprovedAt: entry.approvedAt,
    })) },
    contractApprovedPricingVersion: {
      findUnique: async ({ where }: any) => approved.find(entry =>
        entry.sourceFinancialRecordId === where.sourceFinancialRecordId_contractId.sourceFinancialRecordId),
      findMany: async () => approved,
    },
    shipmentQuantityEvidence: {
      findUnique: async ({ where }: any) => {
        const found = rows.find(row => row.id === where.id);
        return found ? { ...found, contractItem: { contractId, productRowId }, linkedReturns: rows.filter(row => row.dispatchEvidenceId === found.id) } : null;
      },
      findMany: async ({ where }: any) => where.kind ? rows.filter(row => row.kind === where.kind) : rows,
      createMany: async ({ data }: any) => { rows.push(...data); return { count: data.length }; },
    },
    shipmentQuantityProjection: {
      findMany: async () => [...previous.values()],
      upsert: async ({ create }: any) => { previous.set(create.contractItemId, create); },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, rows, approved, previous };
}

const share = { ...identity, dispatchShareId: 'share', dispatchEvidenceId: 'exit-main', quantity: '20.000' };
const command = { caseId: 'accepted-return', actorId: 'actor', finalizedAt: date('05'), shares: [share] };
const isConflict = (message: RegExp) => (error: unknown) =>
  error instanceof ShipmentReturnConflictError && message.test(error.message);

test('the transactional writer preserves the immutable approval and accounts for posted legacy returns only once', async () => {
  const { tx, previous } = fixture();
  const before = await readShipmentQuantityProjection(tx, { contractId });
  assert.equal(before.rows[0]?.health, 'CURRENT');
  assert.equal(before.rows[0]?.quantities?.availableToLoad, '15.000');
  assert.equal((await readPhysicalDispatchReturnHolding(tx, 'exit-main')).remainingQuantity, '75.000');

  const [{ evidenceId, dispatchShareId }] = await recordFinalizedExcessShipmentReturns(tx, command);
  assert.equal(dispatchShareId, share.dispatchShareId);
  const row = (await readShipmentQuantityProjection(tx, { contractId })).rows[0];
  assert.equal(row?.health, 'CURRENT');
  assert.ok(row?.sourceEvidenceIds.includes(evidenceId));
  assert.deepEqual(row?.quantities, {
    contracted: '80.000', finalizedReserved: '10.000', physicallyDispatched: '55.000', availableToLoad: '15.000',
    approvedGrossContracted: '100.000', excessRetired: '20.000',
  });
  assert.equal(previous.get(contractItemId)?.excessRetired, '20.000');
  assert.equal((await readPhysicalDispatchReturnHolding(tx, 'exit-main')).remainingQuantity, '55.000');

  await assert.rejects(recordFinalizedExcessShipmentReturns(tx, {
    ...command, shares: [{ ...share, dispatchShareId: 'next', quantity: '55.001' }],
  }), isConflict(/مانده/));
});

test('a later financial approval preserves the retired quantity and rejects a gross reduction below the effective floor', async () => {
  const { tx, approved } = fixture();
  await recordFinalizedExcessShipmentReturns(tx, command);
  const tooLow = approval(2, '84.9999', date('06'));
  approved.push(tooLow);
  await assert.rejects(captureContractQuantityVersionAtFinancialApproval(tx, {
    contractId, financialRecordId: tooLow.sourceFinancialRecordId, approvedAt: tooLow.approvedAt,
  }), isConflict(/رزروشده/));
  approved.pop();

  const exactFloor = approval(2, '85.000', date('06'));
  approved.push(exactFloor);
  await captureContractQuantityVersionAtFinancialApproval(tx, {
    contractId, financialRecordId: exactFloor.sourceFinancialRecordId, approvedAt: exactFloor.approvedAt,
  });
  const row = (await readShipmentQuantityProjection(tx, { contractId })).rows[0];
  assert.deepEqual(row?.quantities, {
    contracted: '65.000', finalizedReserved: '10.000', physicallyDispatched: '55.000', availableToLoad: '0.000',
    approvedGrossContracted: '85.000', excessRetired: '20.000',
  });
});

test('shipment evidence cannot be finalized against another row, unit or future dispatch', async () => {
  const { tx } = fixture();
  const replacements = [
    { ...share, productRowId: 'same-looking-stone' },
    { ...share, unit: 'count' },
    { ...share, dispatchEvidenceId: 'reserve' },
  ];
  for (const invalid of replacements) {
    await assert.rejects(recordFinalizedExcessShipmentReturns(tx, { ...command, shares: [invalid] }), ShipmentReturnConflictError);
  }
  await assert.rejects(recordFinalizedExcessShipmentReturns(tx, {
    ...command, finalizedAt: date('01'),
  }), ShipmentReturnConflictError);
  assert.equal((await readShipmentQuantityProjection(tx, { contractId })).rows[0]?.quantities?.contracted, '100.000');
});

test('readback keeps verified retirement decomposition when later evidence conflicts', async () => {
  const { tx, rows } = fixture();
  await recordFinalizedExcessShipmentReturns(tx, command);
  const verified = (await readShipmentQuantityProjection(tx, { contractId })).rows[0]?.quantities;
  assert.equal(verified?.excessRetired, '20.000');
  rows.push(evidenceAt('conflict', 'EVIDENCE_CONFLICT', '0.000', 'test', date('06')));
  const row = (await readShipmentQuantityProjection(tx, { contractId })).rows[0];
  assert.equal(row?.health, 'EVIDENCE_CONFLICT');
  assert.equal(row?.canAuthorizeLoading, false);
  assert.deepEqual(row?.quantities, verified);
});
