import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { remainingRecoveryGuidance } from '../remainingRecoveryGuidance';
import { ContractProductGraphValidationError } from '../contractService';
const products = JSON.parse(readFileSync(`${__dirname}/../../../../packages/contract-product-graph/src/__tests__/fixtures/remaining-child-chain.json`, 'utf8'));
const ids = products.map((p: any) => p.rowId);
const before = JSON.stringify(products);
const child = remainingRecoveryGuidance(products, ids[1]);
assert.equal(child.sourceProductRowId, ids[0]);
assert.deepEqual(child.rebuildProductRowIds, [ids[1], ids[2]], 'Only the consumed-secondary dependent follows child A');
assert.deepEqual(remainingRecoveryGuidance(products, ids[0]).rebuildProductRowIds, ids.slice(0, 4));
assert.deepEqual(remainingRecoveryGuidance(products, ids[4]).rebuildProductRowIds, [ids[4]], 'Independent product never requires other products');
assert.deepEqual(remainingRecoveryGuidance(products, ids[2]).rebuildProductRowIds, [ids[2]], 'A leaf does not require rebuilding its paid source');
assert.ok(remainingRecoveryGuidance(products, ids[2]).message.includes('باقی‌ماندهٔ ردیف 2'), 'Secondary producer is identified separately from the root');
const missing = structuredClone(products);
delete missing[1].meta.remainingSource.generatedRemainingStoneIds;
const uncertain = remainingRecoveryGuidance(missing, ids[1]);
assert.deepEqual(uncertain.rebuildProductRowIds, []);
assert.ok(uncertain.message.includes('ردیفی را حذف نکنید'));
assert.equal(uncertain.relatedProductRowIds.includes(ids[4]), false);
for (const generated of [[], ['wrong-secondary']]) {
  const orphan = structuredClone(products);
  orphan[1].meta.remainingSource.generatedRemainingStoneIds = generated;
  const guidance = remainingRecoveryGuidance(orphan, ids[1], 'invalid-physical-layout');
  assert.deepEqual(guidance.rebuildProductRowIds, [], 'An orphan consumer cannot yield a guessed deletion order');
  assert.ok(guidance.relatedProductRowIds.includes(ids[2]));
  assert.ok(guidance.message.includes('ردیفی را حذف نکنید'));
}
const sourceError = new ContractProductGraphValidationError([{ code: 'legacy-canonical-input-invalid',
  path: ['products', '0', 'longitudinalPolicyInput'], message: 'missing source rate' }], { products });
assert.deepEqual(sourceError.issues[0].rebuildProductRowIds, ids.slice(0, 4), 'Early source errors retain whole-chain guidance');
assert.ok(sourceError.issues[0].message.includes(sourceError.trackingId));
const aliases = products.map(({ rowId, ...p }: any) => ({ ...p, productRowId: rowId }));
const error = new ContractProductGraphValidationError([{ code: 'legacy-remaining-recovery-required',
  causeCode: 'cutting-price-drift', path: ['products', ids[1], 'remainingSource'], productRowId: ids[1], message: 'internal' }], { products: aliases });
assert.deepEqual(error.issues[0].path, [`productRow:${ids[1]}`]);
assert.deepEqual(error.issues[0].rebuildProductRowIds, [ids[1], ids[2]]);
assert.ok(error.issues[0].message.includes('ردیف ۲') || error.issues[0].message.includes('ردیف 2'));
assert.ok(error.issues[0].message.includes(error.trackingId));
assert.ok(error.issues[0].message.includes('پیش‌نویس حفظ شده'));
assert.equal(JSON.stringify(products), before);
console.log('remaining recovery guidance tests passed');
