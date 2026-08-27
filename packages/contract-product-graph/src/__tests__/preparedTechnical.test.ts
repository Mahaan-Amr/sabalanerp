import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as graph from '../index';

test('prepared and legacy volumetric rows retain explicit unit and quantity without inventing dimensions', () => {
  for (const family of ['prepared', 'volumetric'] as const) {
    const result = graph.calculatePreparedTechnical({ inputRevision: 2,
      productRowId: graph.parseStableIdentity('product-row', 'ready'), family,
      kind: 'cubic', unit: 'ton', quantity: graph.parseCanonicalDecimal('1.25') });
    assert.ok(result.ok);
    assert.equal(result.result.family, family);
    assert.equal(result.result.quantity, '1.25');
    assert.equal(result.result.unit, 'ton');
    assert.equal(result.result.squareMeters, '0');
    assert.equal(/length|width|Rate|Amount|Hash|policy/i.test(JSON.stringify(result)), false);
  }
});

test('prepared preview rejects private data and disallowed units without discarding valid square-meter quantities', () => {
  const input: graph.PreparedTechnicalInput = { inputRevision: 2,
    productRowId: graph.parseStableIdentity('product-row', 'ready'), family: 'prepared',
    kind: 'readyPiece', unit: 'squareMeter', quantity: graph.parseCanonicalDecimal('2.5') };
  const area = graph.calculatePreparedTechnical(input);
  assert.ok(area.ok);
  assert.equal(area.result.squareMeters, '2.5');
  for (const invalid of [{ ...input, unitPrice: 'private-price' }, { ...input, unit: 'ton' },
    { ...input, quantity: 'private-value' }, { ...input, inputRevision: -1 }]) {
    const result = graph.calculatePreparedTechnical(invalid as graph.PreparedTechnicalInput);
    assert.ok(!result.ok);
    assert.equal(JSON.stringify(result).includes('private-'), false);
  }
  const incomplete = graph.calculatePreparedTechnical({ ...input, quantity: undefined });
  assert.ok(!incomplete.ok);
  assert.equal(incomplete.conflicts[0].field, 'quantity');
});
