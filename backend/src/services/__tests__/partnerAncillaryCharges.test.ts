import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanonicalProductGraph, CanonicalProductRow } from '@sabalanerp/contract-product-graph';
import { describeWholesaleAncillaryCharges } from '../partnerSales/inquiries/ancillaryCharges';

const row = { productRowId: 'row', catalogProductId: 'stone', commercial: { calculationSnapshot: {
  pricingLines: [{ lineId: 'crossCutRateToman', quantity: '2', rateToman: '10', amountToman: '0' },
    { lineId: 'longitudinal-cut', quantity: '1', rateToman: '5', amountToman: '5' }],
} } } as unknown as CanonicalProductRow;
const graph = { operationGroups: [{ productRowId: 'row', operationGroupId: 'group' }, { productRowId: 'another-row', operationGroupId: 'other' }],
  toolSelections: [{ toolSelectionId: 'tool', operationGroupId: 'group', name: 'کله بر', amountToman: '40', finalQuantity: '8', rateToman: '5', unit: 'meter' },
    { toolSelectionId: 'private-other', operationGroupId: 'other', name: 'ابزار محصول دیگر', amountToman: '999' }],
  finishingSelections: [{ finishingSelectionId: 'finish', operationGroupId: 'group', name: 'صیقل', amountToman: '7' }],
  layerConfigurations: [],
} as unknown as CanonicalProductGraph;
const pricing = (componentAmount: string) => ({ componentAmount, materialAmount: '100', totalAmount: '172', mandatoryCharges: [] });

test('fee names and amounts stay attached to their exact row; waived cross cutting is absent', () => {
  const before = JSON.stringify(graph);
  assert.deepEqual(describeWholesaleAncillaryCharges(row, graph, pricing('52'), { enabled: true, percentage: '20' }), [
    { id: 'cut:longitudinal-cut', label: 'برش طولی', amount: '5', quantity: '1', unitPrice: '5', unit: 'meter' },
    { id: 'tool', label: 'ابزار: کله بر', amount: '40', quantity: '8', unitPrice: '5', unit: 'meter' },
    { id: 'finish', label: 'پرداخت: صیقل', amount: '7' },
  ]);
  assert.equal(JSON.stringify(graph), before);
  const restored = describeWholesaleAncillaryCharges(row, graph, pricing('72'), { enabled: false, percentage: '20' });
  assert.equal(restored?.find(line => line.label === 'برش عرضی')?.amount, '20');
});

test('unexplained positive residual is never invented as a named fee and zero costs produce no rows', () => {
  assert.equal(describeWholesaleAncillaryCharges(row, graph, pricing('53'), { enabled: true, percentage: '20' }), undefined);
  const emptyGraph = { ...graph, operationGroups: [], toolSelections: [], finishingSelections: [] };
  const emptyRow = { ...row, commercial: { ...row.commercial, calculationSnapshot: {} } };
  assert.deepEqual(describeWholesaleAncillaryCharges(emptyRow, emptyGraph, pricing('0')), []);
});
