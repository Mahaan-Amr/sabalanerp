import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCanonicalDecimal as c, parseStableIdentity as id, type ProductOperationsTechnicalInput } from '@sabalanerp/contract-product-graph';
import { OperationMinimumContext } from '../OperationMinimumContext';
import { OperationCollectionsSection } from '../OperationCollectionsSection';
import { getOperationalErrorMessage } from '@/lib/operationalError';

test('editing a saved row replaces its previous amount; lock resolves at contract-wide threshold without deleting selection', () => {
  const input: ProductOperationsTechnicalInput = { inputRevision: 1, productRowId: id('product-row', 'row-a'),
    lengthMeters: c('100'), widthMeters: c('0.4'), groups: [{ operationGroupId: id('operation-group', 'group-a'), scope: c('100') }],
    tools: [{ toolSelectionId: id('tool-selection', 'tool-a'), operationGroupId: id('operation-group', 'group-a'),
      catalogItemId: 'scratch', catalogSnapshotVersion: 'current', name: 'اسکراچ سفارشی', unit: 'meter', edges: ['front'] }], finishings: [] };
  const state = { rules: [{ kind: 'tool' as const, catalogItemId: 'scratch', name: 'اسکراچ سفارشی', unit: 'meter' as const, minimumQuantity: '300' }],
    quantities: ['a', 'b', 'c'].map(letter => ({ kind: 'tool' as const, catalogItemId: 'scratch', unit: 'meter' as const,
      quantity: '100', selectionId: `tool-${letter}`, scopeId: `row-${letter}` })) };
  const render = (value: ProductOperationsTechnicalInput) => renderToStaticMarkup(<OperationMinimumContext.Provider value={state}>
    <OperationCollectionsSection input={value} onChange={() => assert.fail('Render may not remove selections')}
      loadTools={async () => []} loadFinishings={async () => []} />
  </OperationMinimumContext.Provider>);
  assert.ok(!render(input).includes('کمتر از حداقل'));
  const changed = { ...input, lengthMeters: c('50'), groups: [{ ...input.groups[0], scope: c('50') }] };
  const html = render(changed);
  assert.ok(html.includes('کسری: ۵۰ متر طول')); assert.ok(html.includes('role="status"')); assert.ok(html.includes('اسکراچ سفارشی'));
  assert.equal(changed.tools.length, 1);
});
test('minimum editing authentication failures remain Persian and preserve a recovery action', () => {
  const message = getOperationalErrorMessage({ response: { status: 401, data: { error: 'Not authorized to access this route' } } },
    { failedAction: 'ذخیره حداقل مقدار', nextStep: 'با حساب دارای مجوز وارد شوید و دوباره تلاش کنید.' });
  assert.ok(!message.includes('Not authorized'));
  assert.ok(message.includes('وارد شوید'));
});
