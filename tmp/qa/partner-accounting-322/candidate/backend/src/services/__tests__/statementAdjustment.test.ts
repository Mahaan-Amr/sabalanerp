import assert from 'node:assert/strict';
import { allocatePricedRevision, type LockedApprovedPricingVersion, type PriorPricedAllocationEvent } from '../pricedAllocationLedger';
import {
  calculateStatementAdjustment,
  statementAdjustmentPriorEvents,
  StatementAdjustmentInvariantError,
} from '../statementAdjustment';

const pricing: LockedApprovedPricingVersion = {
  id: 'pricing-1', contractId: 'contract-1', versionNumber: 1, sourceFinancialRecordId: 'approval-1',
  approvedAt: '2026-08-09T10:00:00.000Z', approvedBy: 'finance-1', schemaVersion: 1, currency: 'TOMAN',
  grossAmount: '300.000000000000', discountAmount: '30.000000000000', netAmount: '270.000000000000',
  integrityHash: 'pricing-hash-1', readinessEvidenceHash: 'ready-hash-1',
  rows: [
    { id: 'pricing-row-a', contractItemId: 'item-a', productRowId: 'row-a', ordinal: 0,
      contractedQuantity: '3.000', unit: 'm2', canonicalAllInTotal: '100.000000000000', discountEligible: true,
      componentEvidence: { discountBasis: '100.000000000000' }, integrityHash: 'row-hash-a' },
    { id: 'pricing-row-b', contractItemId: 'item-b', productRowId: 'row-b', ordinal: 1,
      contractedQuantity: '2.000', unit: 'm2', canonicalAllInTotal: '200.000000000000', discountEligible: true,
      componentEvidence: { discountBasis: '200.000000000000' }, integrityHash: 'row-hash-b' },
  ],
};

const original: PriorPricedAllocationEvent[] = [
  { pricingRowId: 'pricing-row-a', pricingVersionId: 'pricing-1', quantity: '1.000', grossAmount: '33.333333333333',
    discountAmount: '3.333333333333', integrityVerified: true, ledgerSequence: 1 },
  { pricingRowId: 'pricing-row-b', pricingVersionId: 'pricing-1', quantity: '1.000', grossAmount: '100.000000000000',
    discountAmount: '10.000000000000', integrityVerified: true, ledgerSequence: 1 },
];

const calculate = (overrides: Partial<Parameters<typeof calculateStatementAdjustment>[0]> = {}) =>
  calculateStatementAdjustment({
    adjustmentId: 'adjustment-1', waybillId: 'waybill-1', correctionId: 'correction-1', sequence: 1,
    reason: 'اصلاح مقدار محموله', correctionIntegrityHash: 'c'.repeat(64),
    originalStatementDocumentId: 'statement-artifact-1', originalStatementSourceIntegrityHash: 'd'.repeat(64),
    originalStatementSha256: 'a'.repeat(64), issuedAt: '2026-08-09T12:00:00.000Z',
    issuedBy: 'accountant-1', currency: 'TOMAN', versions: [pricing], priorEvents: original,
    renderContext: { waybillNumber: '1258', customerName: 'مشتری نمونه', projectOrDestination: 'پروژه نمونه',
      vehiclePlate: 'ایران ۱۲ - ۳۴۵ ب ۶۷', templateVersion: 'statement-adjustment-v1' },
    lines: [{ correctionLineId: 'correction-line-a', contractId: 'contract-1', contractItemId: 'item-a',
      productRowId: 'row-a', label: 'ردیف الف', unit: 'm2', quantity: '0.500' }],
    ...overrides,
  });

{
  const result = calculate();
  assert.equal(result.snapshot.lines[0].ledgerSequence, 2);
  assert.equal(result.snapshot.lines[0].grossAmountDelta, '16.666666666666');
  assert.equal(result.snapshot.lines[0].discountDelta, '1.666666666666');
  assert.equal(result.snapshot.lines[0].netAmountDelta, '15.000000000000');
  assert.deepEqual(result.snapshot.totals, {
    grossAmountDelta: '16.666666666666', discountDelta: '1.666666666666', netAmountDelta: '15.000000000000',
  });
  assert.equal(result.renderInput.kind, 'STATEMENT_ADJUSTMENT');
  assert.equal(result.snapshot.correctionIntegrityHash, 'c'.repeat(64));
  assert.equal(result.snapshot.originalStatementSha256, 'a'.repeat(64));
  assert.deepEqual(result.renderInput.payload.lines[0], {
    contractId: 'contract-1', contractItemId: 'item-a', productRowId: 'row-a', label: 'ردیف الف', unit: 'm2',
    quantityDelta: '0.500', grossAmountDelta: '16.666666666666', discountDelta: '1.666666666666',
    netAmountDelta: '15.000000000000',
  });
}

{
  const returned = calculate({ lines: [{ correctionLineId: 'return-line', contractId: 'contract-1', contractItemId: 'item-a',
    productRowId: 'row-a', label: 'ردیف الف', unit: 'm2', quantity: '-1.000' }] });
  assert.deepEqual({
    quantityDelta: returned.snapshot.lines[0].quantityDelta,
    grossAmountDelta: returned.snapshot.lines[0].grossAmountDelta,
    discountDelta: returned.snapshot.lines[0].discountDelta,
    netAmountDelta: returned.snapshot.lines[0].netAmountDelta,
    afterQuantity: returned.snapshot.lines[0].afterQuantity,
    ledgerSequence: returned.snapshot.lines[0].ledgerSequence,
  }, { quantityDelta: '-1.000', grossAmountDelta: '-33.333333333333', discountDelta: '-3.333333333333',
    netAmountDelta: '-30.000000000000', afterQuantity: '0.000', ledgerSequence: 2 });
}

{
  const reattributed = calculate({ lines: [
    { correctionLineId: 'source-line', contractId: 'contract-1', contractItemId: 'item-a', productRowId: 'row-a',
      label: 'ردیف الف', unit: 'm2', quantity: '-0.250' },
    { correctionLineId: 'destination-line', contractId: 'contract-1', contractItemId: 'item-b', productRowId: 'row-b',
      label: 'ردیف ب', unit: 'm2', quantity: '0.250' },
  ] });
  assert.deepEqual(reattributed.snapshot.lines.map((line) => [line.contractItemId, line.quantityDelta, line.ledgerSequence]), [
    ['item-a', '-0.250', 2], ['item-b', '0.250', 2],
  ]);
  assert.deepEqual(reattributed.snapshot.quantityDeltasByUnit, { m2: '0.000' });
  assert.equal(reattributed.snapshot.lines.length, 2, 'only affected stable rows belong to an adjustment');
}

{
  const fullOriginal: PriorPricedAllocationEvent[] = [{ pricingRowId: 'pricing-row-a', pricingVersionId: 'pricing-1',
    quantity: '3.000', grossAmount: '100.000000000000', discountAmount: '10.000000000000',
    integrityVerified: true, ledgerSequence: 1 }];
  const returned = calculate({ priorEvents: fullOriginal, lines: [{ correctionLineId: 'return-line', contractId: 'contract-1',
    contractItemId: 'item-a', productRowId: 'row-a', label: 'ردیف الف', unit: 'm2', quantity: '-1.000' }] });
  const reshipment = allocatePricedRevision({ versions: [pricing],
    priorEvents: [...fullOriginal, ...statementAdjustmentPriorEvents({ snapshot: returned.snapshot, integrityHash: returned.integrityHash })],
    lines: [{ allocationRevisionLineId: 'later-reshipment', contractId: 'contract-1', contractItemId: 'item-a',
      productRowId: 'row-a', unit: 'm2', quantity: '1.000' }],
  });
  assert.equal(reshipment.events[0].consumesFinalRemainder, true);
  assert.equal(reshipment.events[0].grossAmount, '33.333333333333');
  assert.equal(reshipment.events[0].discountAmount, '3.333333333333');
}

{
  const over = calculate({ lines: [{ correctionLineId: 'over-line', contractId: 'contract-1', contractItemId: 'item-a',
    productRowId: 'row-a', label: 'ردیف الف', unit: 'm2', quantity: '3.000' }] });
  assert.equal(over.snapshot.lines[0].afterQuantity, '4.000');
  assert.equal(over.snapshot.lines[0].grossAmountDelta, '100.000000000000');
}

{
  const first = calculate();
  const recovered = statementAdjustmentPriorEvents({ snapshot: first.snapshot, integrityHash: first.integrityHash });
  const reversal = calculate({ adjustmentId: 'adjustment-2', correctionId: 'correction-2', sequence: 2,
    priorEvents: [...original, ...recovered], lines: [{ correctionLineId: 'reversal-line', contractId: 'contract-1',
      contractItemId: 'item-a', productRowId: 'row-a', label: 'ردیف الف', unit: 'm2', quantity: '-0.500' }] });
  assert.equal(reversal.snapshot.lines[0].ledgerSequence, 3);
  assert.equal(reversal.snapshot.lines[0].grossAmountDelta, '-16.666666666666');
  assert.equal(reversal.snapshot.lines[0].discountDelta, '-1.666666666666');
}

assert.throws(
  () => statementAdjustmentPriorEvents({ snapshot: calculate().snapshot, integrityHash: 'tampered' }),
  (error: unknown) => error instanceof StatementAdjustmentInvariantError && error.code === 'INTEGRITY_MISMATCH',
);

assert.throws(
  () => calculate({ sequence: 0 }),
  (error: unknown) => error instanceof StatementAdjustmentInvariantError && error.code === 'INVALID_SEQUENCE',
);

assert.throws(
  () => calculate({ lines: [] }),
  (error: unknown) => error instanceof StatementAdjustmentInvariantError && error.code === 'EMPTY_ADJUSTMENT',
);

assert.throws(
  () => calculate({ lines: [
    { correctionLineId: 'duplicate-a', contractId: 'contract-1', contractItemId: 'item-a', productRowId: 'row-a',
      label: 'ردیف الف', unit: 'm2', quantity: '0.100' },
    { correctionLineId: 'duplicate-b', contractId: 'contract-1', contractItemId: 'item-a', productRowId: 'row-a',
      label: 'ردیف الف', unit: 'm2', quantity: '0.200' },
  ] }),
  (error: unknown) => error instanceof StatementAdjustmentInvariantError && error.code === 'DUPLICATE_STABLE_ROW',
);

assert.throws(
  () => calculate({ originalStatementSha256: 'not-a-checksum' }),
  (error: unknown) => error instanceof StatementAdjustmentInvariantError && error.code === 'INVALID_SOURCE_EVIDENCE',
);

console.log('statement adjustment domain tests passed');
