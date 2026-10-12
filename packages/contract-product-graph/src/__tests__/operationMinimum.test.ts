import assert from 'node:assert/strict';
import test from 'node:test';
import { collectProductOperationQuantities, evaluateOperationMinimums, operationMinimumMessage, collectCalculatedOperationQuantities,
  type OperationMinimumQuantity, type OperationMinimumRule } from '../operationMinimum';

const rule = (id = 'scratch', minimum: string | null = '300', kind: 'tool' | 'finishing' = 'tool'): OperationMinimumRule =>
  ({ kind, catalogItemId: id, name: 'اسکراچ سفارشی', unit: 'meter', minimumQuantity: minimum });
const quantity = (id: string, amount: string, catalogItemId = 'scratch', kind: 'tool' | 'finishing' = 'tool'): OperationMinimumQuantity =>
  ({ kind, catalogItemId, unit: 'meter', quantity: amount, selectionId: id });
const product = (id: string, length: string, edges: string[], override?: string) => ({ rowId: id, operationPolicyInput: {
  policyVersion: 'operations-v1', pricingPolicyVersion: 'pricing-v1', roundingPolicyVersion: 'half-up-v1',
  productRowId: id, lengthMeters: length, widthMeters: '0.4', groups: [{ operationGroupId: `${id}:group`, scope: length }],
  tools: [{ toolSelectionId: `${id}:tool`, operationGroupId: `${id}:group`, catalogItemId: 'scratch',
    catalogSnapshotVersion: 'current', name: 'اسکراچ', unit: 'meter', rateToman: '100', edges,
    ...(override ? { quantityOverride: { value: override, automaticQuantitySnapshot: length } } : {}) }], finishings: [],
}, appliedSubServices: [{ id: `${id}:legacy-copy`, subServiceId: 'scratch', meter: 9999, calculationBase: 'length' }] });

test('three 100m rows qualify exactly; removing a row creates a Persian 100m deficit without mutation', () => {
  const products = ['a', 'b', 'c'].map(id => product(id, '100', ['front']));
  const before = JSON.stringify(products);
  const quantities = collectProductOperationQuantities(products);
  assert.deepEqual(evaluateOperationMinimums(quantities, [rule()]), []);
  const [deficit] = evaluateOperationMinimums(quantities.slice(0, 2), [rule()]);
  assert.equal(deficit.totalQuantity, '200'); assert.equal(deficit.deficitQuantity, '100');
  assert.match(operationMinimumMessage(deficit), /کسری: ۱۰۰ متر طول/);
  assert.equal(JSON.stringify(products), before);
});
test('front and back on 200m create 400m of work; a valid manual 300m replaces automatic 200m', () => {
  assert.equal(collectProductOperationQuantities([product('a', '200', ['front', 'back'])])[0].quantity, '400');
  assert.deepEqual(evaluateOperationMinimums(collectProductOperationQuantities([product('a', '200', ['front', 'back'])]), [rule()]), []);
  assert.deepEqual(evaluateOperationMinimums(collectProductOperationQuantities([product('a', '200', ['front'], '300')]), [rule()]), []);
});
test('different items/kinds/units never qualify another operation and each has its own threshold', () => {
  const amounts = [quantity('a', '200'), quantity('b', '200', 'other'), quantity('c', '400', 'scratch', 'finishing')];
  const deficits = evaluateOperationMinimums(amounts, [rule(), rule('other', '250'), rule('scratch', '500', 'finishing')]);
  assert.deepEqual(deficits.map(item => item.deficitQuantity), ['100', '50', '100']);
  assert.equal(evaluateOperationMinimums([{ ...quantity('a', '400'), unit: 'squareMeter' }], [rule()])[0].unitMismatch, true);
  assert.equal(evaluateOperationMinimums([{ ...quantity('a', '400'), unit: 'count' }], [rule()])[0].unitMismatch, true);
});
test('empty and zero are unrestricted; decimal comparison is exact and duplicate projections count once', () => {
  assert.deepEqual(evaluateOperationMinimums([quantity('a', '1')], [rule('scratch', null)]), []);
  assert.deepEqual(evaluateOperationMinimums([quantity('a', '1')], [rule('scratch', '0')]), []);
  assert.deepEqual(evaluateOperationMinimums([quantity('a', '0.1'), quantity('b', '0.2')], [rule('scratch', '0.3')]), []);
  assert.equal(evaluateOperationMinimums([quantity('a', '200'), quantity('a', '200')], [rule()])[0].totalQuantity, '200');
  assert.throws(() => evaluateOperationMinimums([quantity('a', '-1')], [rule()]), /مقدار عملیات معتبر نیست/);
});
test('nested layer results contribute, input/price-only fields do not, and duplicate snapshots are ignored', () => {
  const selection = { toolSelectionId: 'layer-tool', catalogItemId: 'scratch', unit: 'meter', finalQuantity: '400' };
  assert.equal(collectCalculatedOperationQuantities({ input: { ...selection, finalQuantity: undefined },
    layers: [{ sideOperationResults: [{ result: { tools: [selection] } }] }], displayCopy: selection }).length, 1);
});
test('historical layer-side collections with the same parent retain their independent selections', () => {
  const parent = product('parent', '200', ['front']);
  const first = product('parent', '50', ['front']).operationPolicyInput;
  const second = product('parent', '50', ['back']).operationPolicyInput;
  first.tools[0].toolSelectionId = 'side-first'; second.tools[0].toolSelectionId = 'side-second';
  const quantities = collectProductOperationQuantities([{ ...parent, layerSourcePlan: { canonicalInput: { sideOperations: [
    { operations: first }, { operations: second },
  ] } } }]);
  assert.equal(quantities.length, 3);
  assert.deepEqual(evaluateOperationMinimums(quantities, [rule()]), []);
});
