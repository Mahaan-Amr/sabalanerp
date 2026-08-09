import assert from 'node:assert/strict';
import { normalizeDispatchCorrectionDraft, StatementCorrectionPolicyError } from '../dispatchCorrectionAdjustmentPolicy';

const scope = [
  { contractId: 'contract-1', contractItemId: 'item-a', productRowId: 'row-a', unit: 'm2', pricingVersionId: 'pricing-1' },
  { contractId: 'contract-1', contractItemId: 'item-b', productRowId: 'row-b', unit: 'm2', pricingVersionId: 'pricing-1' },
  { contractId: 'contract-2', contractItemId: 'item-c', productRowId: 'row-c', unit: 'count', pricingVersionId: 'pricing-2' },
];

{
  const result = normalizeDispatchCorrectionDraft({ reattributions: [{ sourceContractItemId: 'item-a',
    destinationContractItemId: 'item-b', quantity: '0.250' }] }, scope);
  assert.equal(result.kind, 'REATTRIBUTION');
  assert.deepEqual(result.lines, [
    { ...scope[0], quantity: '-0.250', returnEvidenceId: null },
    { ...scope[1], quantity: '0.250', returnEvidenceId: null },
  ]);
  assert.deepEqual(result.reattributions, [{ sourceContractItemId: 'item-a', destinationContractItemId: 'item-b',
    quantity: '0.250', unit: 'm2', pricingVersionId: 'pricing-1' }]);
}

assert.throws(
  () => normalizeDispatchCorrectionDraft({ lines: [
    { contractItemId: 'item-a', quantity: '-0.250' }, { contractItemId: 'item-b', quantity: '0.250' },
  ] }, scope),
  (error: unknown) => error instanceof StatementCorrectionPolicyError && error.code === 'AMBIGUOUS_MIXED_SIGN',
  'an arbitrary net-zero set is not row reattribution',
);

assert.throws(
  () => normalizeDispatchCorrectionDraft({ reattributions: [{ sourceContractItemId: 'item-a',
    destinationContractItemId: 'item-c', quantity: '0.250' }] }, scope),
  (error: unknown) => error instanceof StatementCorrectionPolicyError && error.code === 'REATTRIBUTION_SEMANTICS_MISMATCH',
);

assert.throws(
  () => normalizeDispatchCorrectionDraft({ reattributions: [{ sourceContractItemId: 'item-a',
    destinationContractItemId: 'item-b', quantity: '-0.250' }] }, scope),
  (error: unknown) => error instanceof StatementCorrectionPolicyError && error.code === 'INVALID_QUANTITY',
);

{
  const returned = normalizeDispatchCorrectionDraft({ lines: [{ contractItemId: 'item-a', quantity: '-0.500',
    returnEvidenceId: 'guard-return-1' }] }, scope);
  assert.equal(returned.kind, 'RETURN');
  assert.equal(returned.lines[0].returnEvidenceId, 'guard-return-1');
}

console.log('dispatch correction adjustment policy tests passed');
