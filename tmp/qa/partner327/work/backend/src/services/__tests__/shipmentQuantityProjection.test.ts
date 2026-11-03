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
  assert.equal(result.totalsByUnit[0]?.contracted, null);
});

test('rejects quantities that cannot be represented at canonical scale three', () => {
  assert.throws(() => projectShipmentQuantities([
    evidence('too-precise', 'CONTRACTED_SET', '1.0004'),
  ]), /at most three decimal places/);
});

test('keeps dispatched truth and reports a verified return awaiting Accounting', () => {
  const result = projectShipmentQuantities([
    evidence('contracted', 'CONTRACTED_SET', '5.000'),
    evidence('exit', 'LEGACY_DISPATCHED', '5.000'),
    evidence('return', 'GUARD_RETURN_VERIFIED', '1.125', { guardReturnMovementId: 'movement-in', dispatchEvidenceId: 'exit', guardReturnValidated: true, sourceId: 'return-1' }),
  ]);
  assert.equal(result.rows[0]?.health, 'EVIDENCE_CONFLICT');
  assert.equal(result.rows[0]?.quantities?.physicallyDispatched, '5.000');
  assert.match(result.rows[0]?.healthReasons.join(' ') || '', /awaits Accounting/);
});

test('applies a return correction only when it links verified Guard inbound evidence', () => {
  const source = [
    evidence('contracted', 'CONTRACTED_SET', '5.000'),
    evidence('exit', 'LEGACY_DISPATCHED', '5.000'),
    evidence('return', 'GUARD_RETURN_VERIFIED', '1.125', { guardReturnMovementId: 'movement-in', dispatchEvidenceId: 'exit', guardReturnValidated: true, sourceId: 'return-1' }),
    evidence('posted-return', 'DISPATCH_CORRECTION_POSTED', '-1.125', { returnEvidenceId: 'return' }),
  ];
  const valid = projectShipmentQuantities(source);
  const unlinked = projectShipmentQuantities(source.filter((item) => item.id !== 'return'));
  assert.equal(valid.rows[0]?.health, 'CURRENT');
  assert.equal(valid.rows[0]?.quantities?.physicallyDispatched, '3.875');
  assert.equal(unlinked.rows[0]?.health, 'EVIDENCE_CONFLICT');
  assert.equal(unlinked.rows[0]?.quantities?.physicallyDispatched, '5.000');
});

test('non-current health uses verified projection truth without inventing zeros', () => {
  const result = projectShipmentQuantities([
    evidence('contracted', 'CONTRACTED_SET', '10.000'),
    evidence('stale', 'PROJECTION_STALE', '0.000'),
  ], { lastVerifiedRows: [{
    contractId: 'contract-1', contractItemId: 'item-1', productRowId: 'row-1', unit: 'squareMeter',
    quantities: { contracted: '9.999', finalizedReserved: '0.001', physicallyDispatched: '0.002', availableToLoad: '9.996' },
    verifiedAt: '2026-08-01T09:00:00.000Z',
  }] });
  assert.deepEqual(result.rows[0]?.quantities, { contracted: '9.999', finalizedReserved: '0.001', physicallyDispatched: '0.002', availableToLoad: '9.996' });
  assert.equal(result.rows[0]?.lastVerifiedAt, '2026-08-01T09:00:00.000Z');
});

test('every unsafe health state carries the verified timestamp forward', () => {
  const verifiedAt = '2026-07-31T09:00:00.000Z';
  const lastVerifiedRows = [{
    contractId: 'contract-1', contractItemId: 'item-1', productRowId: 'row-1', unit: 'squareMeter',
    quantities: { contracted: '8.000', finalizedReserved: '1.000', physicallyDispatched: '2.000', availableToLoad: '5.000' }, verifiedAt,
  }];
  for (const unsafe of [
    evidence('stale', 'PROJECTION_STALE', '0.000'),
    evidence('legacy', 'LEGACY_UNRECONCILED_RESERVED', '1.000'),
    evidence('conflict', 'EVIDENCE_CONFLICT', '0.000'),
  ]) {
    const result = projectShipmentQuantities([evidence('contracted', 'CONTRACTED_SET', '8.000'), unsafe], { lastVerifiedRows });
    assert.equal(result.rows[0]?.lastVerifiedAt, verifiedAt, unsafe.kind);
    assert.equal(result.rows[0]?.cutoff, result.cutoff, unsafe.kind);
  }
});

test('fabricated or over-consumed return evidence cannot reduce dispatched truth', () => {
  const base = [evidence('contracted', 'CONTRACTED_SET', '5.000'), evidence('exit', 'LEGACY_DISPATCHED', '5.000')];
  const fabricated = projectShipmentQuantities([
    ...base, evidence('return', 'GUARD_RETURN_VERIFIED', '1.000', { guardReturnMovementId: 'fake', dispatchEvidenceId: 'exit' }),
    evidence('correction', 'DISPATCH_CORRECTION_POSTED', '-1.000', { returnEvidenceId: 'return' }),
  ]);
  assert.equal(fabricated.rows[0]?.quantities?.physicallyDispatched, '5.000');
  assert.equal(fabricated.rows[0]?.health, 'EVIDENCE_CONFLICT');

  const validReturn = evidence('return', 'GUARD_RETURN_VERIFIED', '1.000', { guardReturnMovementId: 'movement-in', dispatchEvidenceId: 'exit', guardReturnValidated: true });
  const reused = projectShipmentQuantities([
    ...base, validReturn,
    evidence('correction-a', 'DISPATCH_CORRECTION_POSTED', '-0.750', { returnEvidenceId: 'return' }),
    evidence('correction-b', 'DISPATCH_CORRECTION_POSTED', '-0.500', { returnEvidenceId: 'return', effectiveAt: '2026-08-01T09:00:00.000Z' }),
  ]);
  assert.equal(reused.rows[0]?.quantities?.physicallyDispatched, '4.250');
  assert.equal(reused.rows[0]?.health, 'EVIDENCE_CONFLICT');
});

test('a posted correction mistake is undone only by an opposite immutable reversal', () => {
  const result = projectShipmentQuantities([
    evidence('contracted', 'CONTRACTED_SET', '5.000'),
    evidence('exit', 'LEGACY_DISPATCHED', '5.000'),
    evidence('mistake', 'DISPATCH_CORRECTION_POSTED', '1.250'),
    evidence('reversal', 'DISPATCH_CORRECTION_POSTED', '-1.250', { metadata: { reversalOfId: 'mistake' } }),
  ]);
  assert.equal(result.rows[0]?.health, 'CURRENT');
  assert.equal(result.rows[0]?.quantities?.physicallyDispatched, '5.000');
});

test('contracted quantity follows the financially approved version effective at cutoff', () => {
  const versions = [
    evidence('approved-v1', 'CONTRACTED_SET', '10.000', { effectiveAt: '2026-08-01T00:00:00.000Z', recordedAt: '2026-08-01T01:00:00.000Z', sourceVersion: 1 }),
    evidence('approved-v2', 'CONTRACTED_SET', '8.000', { effectiveAt: '2026-08-05T00:00:00.000Z', recordedAt: '2026-08-06T00:00:00.000Z', sourceVersion: 2 }),
  ];
  assert.equal(projectShipmentQuantities(versions, { cutoff: '2026-08-04T00:00:00.000Z' }).rows[0]?.quantities?.contracted, '10.000');
  assert.equal(projectShipmentQuantities(versions, { cutoff: '2026-08-07T00:00:00.000Z' }).rows[0]?.quantities?.contracted, '8.000');
});
