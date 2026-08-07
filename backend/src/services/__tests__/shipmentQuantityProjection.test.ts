import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  projectShipmentQuantities,
  type ShipmentQuantityEvidence,
} from '../shipmentQuantityProjection';

const evidence = (
  id: string,
  kind: ShipmentQuantityEvidence['kind'],
  quantity: string,
  overrides: Partial<ShipmentQuantityEvidence> = {},
): ShipmentQuantityEvidence => ({
  id,
  contractId: 'contract-1',
  contractItemId: 'item-1',
  productRowId: 'row-1',
  unit: 'squareMeter',
  kind,
  quantity,
  effectiveAt: '2026-08-01T08:00:00.000Z',
  recordedAt: '2026-08-01T08:00:01.000Z',
  sourceType: 'test',
  sourceId: id,
  sourceVersion: 1,
  integrityHash: `hash-${id}`,
  ...overrides,
});

test('reconciles scale-three quantities as mutually exclusive buckets', () => {
  const result = projectShipmentQuantities([
    evidence('contracted', 'CONTRACTED_SET', '10.125'),
    evidence('reserved-a', 'ALLOCATION_FINALIZED', '2.005'),
    evidence('reserved-b', 'ALLOCATION_FINALIZED', '1.120'),
    evidence('exit-a', 'PHYSICAL_EXIT', '2.005'),
  ]);

  assert.deepEqual(result.rows[0]?.quantities, {
    contracted: '10.125',
    finalizedReserved: '1.120',
    physicallyDispatched: '2.005',
    availableToLoad: '7.000',
  });
});

test('keeps identical-looking rows and incompatible units as separate identities', () => {
  const result = projectShipmentQuantities([
    evidence('row-a-contract', 'CONTRACTED_SET', '5.000'),
    evidence('row-b-contract', 'CONTRACTED_SET', '7.000', {
      contractItemId: 'item-2', productRowId: 'row-2', unit: 'squareMeter',
    }),
    evidence('row-c-contract', 'CONTRACTED_SET', '3.000', {
      contractItemId: 'item-3', productRowId: 'row-3', unit: 'count',
    }),
  ]);

  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.totalsByUnit, [
    { unit: 'count', contracted: '3.000', finalizedReserved: '0.000', physicallyDispatched: '0.000', availableToLoad: '3.000', affectedRowCount: 0, isComplete: true },
    { unit: 'squareMeter', contracted: '12.000', finalizedReserved: '0.000', physicallyDispatched: '0.000', availableToLoad: '12.000', affectedRowCount: 0, isComplete: true },
  ]);
});

test('applies only posted corrections and preserves negative availability', () => {
  const result = projectShipmentQuantities([
    evidence('contracted', 'CONTRACTED_SET', '4.000'),
    evidence('legacy-exit', 'LEGACY_DISPATCHED', '4.000'),
    evidence('late-positive', 'DISPATCH_CORRECTION_POSTED', '0.250'),
    evidence('draft-return', 'DISPATCH_CORRECTION_DRAFT', '-1.000'),
  ]);

  assert.deepEqual(result.rows[0]?.quantities, {
    contracted: '4.000',
    finalizedReserved: '0.000',
    physicallyDispatched: '4.250',
    availableToLoad: '-0.250',
  });
  assert.equal(result.rows[0]?.hasNegativeAvailability, true);
});

test('reconstructs operational and audit-known-at history independently', () => {
  const lateExit = evidence('late-exit', 'PHYSICAL_EXIT', '2.000', {
    effectiveAt: '2026-08-02T10:00:00.000Z',
    recordedAt: '2026-08-05T10:00:00.000Z',
  });
  const source = [
    evidence('contracted', 'CONTRACTED_SET', '5.000'),
    evidence('reserved', 'ALLOCATION_FINALIZED', '2.000'),
    lateExit,
  ];

  const operational = projectShipmentQuantities(source, {
    cutoff: '2026-08-03T00:00:00.000Z', mode: 'OPERATIONAL_AS_OF',
  });
  const knownAt = projectShipmentQuantities(source, {
    cutoff: '2026-08-03T00:00:00.000Z', mode: 'AUDIT_KNOWN_AT',
  });

  assert.equal(operational.rows[0]?.quantities?.physicallyDispatched, '2.000');
  assert.equal(knownAt.rows[0]?.quantities?.finalizedReserved, '2.000');
  assert.equal(knownAt.rows[0]?.quantities?.physicallyDispatched, '0.000');
});

test('preserves last verified truth when current evidence conflicts', () => {
  const result = projectShipmentQuantities([
    evidence('contracted', 'CONTRACTED_SET', '8.000'),
    evidence('conflict', 'EVIDENCE_CONFLICT', '0.000', {
      metadata: { reason: 'broken snapshot hash' },
    }),
  ], {
    lastVerifiedRows: [{
      contractId: 'contract-1', contractItemId: 'item-1', productRowId: 'row-1', unit: 'squareMeter',
      quantities: { contracted: '8.000', finalizedReserved: '2.000', physicallyDispatched: '1.000', availableToLoad: '5.000' },
      verifiedAt: '2026-08-01T09:00:00.000Z',
    }],
  });

  assert.equal(result.rows[0]?.health, 'EVIDENCE_CONFLICT');
  assert.equal(result.rows[0]?.quantities?.availableToLoad, '5.000');
  assert.equal(result.rows[0]?.canAuthorizeLoading, false);
  assert.equal(result.totalsByUnit[0]?.isComplete, false);
});

test('legacy finalized loading holds quantity until an explicit review decision', () => {
  const result = projectShipmentQuantities([
    evidence('contracted', 'CONTRACTED_SET', '9.000'),
    evidence('legacy', 'LEGACY_UNRECONCILED_RESERVED', '3.000'),
  ]);

  assert.equal(result.rows[0]?.health, 'LEGACY_UNRECONCILED');
  assert.equal(result.rows[0]?.quantities?.finalizedReserved, '3.000');
  assert.equal(result.rows[0]?.quantities?.availableToLoad, '6.000');
  assert.equal(result.rows[0]?.canAuthorizeLoading, false);
});

test('legacy review moves held quantity without rewriting the original evidence', () => {
  const result = projectShipmentQuantities([
    evidence('contracted', 'CONTRACTED_SET', '9.000'),
    evidence('legacy', 'LEGACY_UNRECONCILED_RESERVED', '3.000'),
    evidence('review', 'LEGACY_DISPATCHED', '3.000', { metadata: { reviewOf: 'legacy' } }),
  ]);

  assert.equal(result.rows[0]?.health, 'CURRENT');
  assert.equal(result.rows[0]?.quantities?.finalizedReserved, '0.000');
  assert.equal(result.rows[0]?.quantities?.physicallyDispatched, '3.000');
  assert.equal(result.rows[0]?.quantities?.availableToLoad, '6.000');
});

test('does not infer a missing contracted quantity as zero', () => {
  const result = projectShipmentQuantities([
    evidence('reserved-without-contract', 'ALLOCATION_FINALIZED', '1.000'),
  ]);

  assert.equal(result.rows[0]?.health, 'EVIDENCE_CONFLICT');
  assert.equal(result.rows[0]?.quantities, null);
  assert.equal(result.totalsByUnit[0]?.isComplete, false);
});

test('rejects quantities that cannot be represented at canonical scale three', () => {
  assert.throws(() => projectShipmentQuantities([
    evidence('too-precise', 'CONTRACTED_SET', '1.0004'),
  ]), /at most three decimal places/);
});
