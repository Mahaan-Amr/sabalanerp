import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCanonicalDecimal as decimal, parseStableIdentity as identity, type ProductOperationsTechnicalInput } from '@sabalanerp/contract-product-graph';
import { OperationCollectionsSection } from '../OperationCollectionsSection';

test('retail operation presentation follows technical edges without persisting rates', () => {
  const group = identity('operation-group', 'retail-group');
  const input: ProductOperationsTechnicalInput = {
    inputRevision: 1, productRowId: identity('product-row', 'retail-row'),
    lengthMeters: decimal('1.2'), widthMeters: decimal('0.4'), quantity: 12,
    groups: [{ operationGroupId: group, scope: decimal('12') }],
    tools: [{ toolSelectionId: identity('tool-selection', 'retail-tool'), operationGroupId: group,
      catalogItemId: 'tool', catalogSnapshotVersion: '2026-10-03T00:00:00.000Z', name: 'ابزار', unit: 'meter', edges: ['front'] }],
    finishings: [{ finishingSelectionId: identity('finishing-selection', 'retail-finishing'), operationGroupId: group,
      catalogItemId: 'finishing', catalogSnapshotVersion: '2026-10-03T00:00:00.000Z', name: 'پرداخت', unit: 'squareMeter', incompatibleCatalogItemIds: [] }],
  };
  const original = JSON.stringify(input);
  const render = (value: ProductOperationsTechnicalInput) => renderToStaticMarkup(<OperationCollectionsSection
    input={value} onChange={() => assert.fail('Rendering must not mutate selections')}
    loadTools={async () => []} loadFinishings={async () => []}
    retailRateFor={kind => kind === 'tool' ? '200000' : '800000'} />);
  const html = render(input);
  assert.ok(html.includes('۲۰۰٬۰۰۰ تومان / m'), 'tool rate includes its length unit');
  assert.ok(html.includes('۸۰۰٬۰۰۰ تومان / m²'));
  assert.ok(html.includes('۲٬۸۸۰٬۰۰۰ تومان'));
  assert.ok(html.includes('۴٬۶۰۸٬۰۰۰ تومان'));
  const changed = render({ ...input, tools: [{ ...input.tools[0], edges: ['front', 'back'] }] });
  assert.ok(changed.includes('۵٬۷۶۰٬۰۰۰ تومان'));
  assert.equal(JSON.stringify(input), original);
  assert.ok(!original.includes('rateToman'));
});
