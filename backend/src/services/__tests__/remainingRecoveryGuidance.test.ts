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
const childMessage = remainingRecoveryGuidance(products, ids[1]).message;
assert.doesNotMatch(childMessage, /ردیف|row|contract-row/i, 'Sales guidance must not expose internal row indexing or identity');
assert.ok(childMessage.includes('این محصول'), 'Guidance addresses the product shown beside the error');
assert.ok(childMessage.includes('محصولات وابسته'), 'Guidance names dependencies in user-facing language');
assert.ok(childMessage.length <= 420, 'Guidance remains short enough to scan in the sales workspace');
const missing = structuredClone(products);
delete missing[1].meta.remainingSource.generatedRemainingStoneIds;
const uncertain = remainingRecoveryGuidance(missing, ids[1]);
assert.deepEqual(uncertain.rebuildProductRowIds, []);
assert.ok(uncertain.message.includes('هیچ محصولی را حذف نکنید'));
assert.ok(uncertain.message.includes('منبع سنگ، ابعاد و مقدار مصرف'));
assert.doesNotMatch(uncertain.message, /ردیف|row|contract-row/i);
assert.ok(uncertain.message.length <= 420);
assert.doesNotMatch(uncertain.message, /پشتیبانی|تماس بگیرید/);
assert.equal(uncertain.relatedProductRowIds.includes(ids[4]), false);
for (const causeCode of [
  'cutting-price-drift',
  'final-inventory-mismatch',
  'ambiguous-layer-consumption-order',
  'invalid-source-identity',
  'invalid-physical-layout',
  'unknown-recovery-conflict'
]) {
  const message = remainingRecoveryGuidance(missing, ids[1], causeCode).message;
  assert.doesNotMatch(message, /ردیف|row|contract-row|پشتیبانی|تماس بگیرید/i);
  assert.ok(message.includes('بررسی و ذخیره کنید'), `Cause ${causeCode} keeps one concrete recovery action`);
  assert.ok(message.length <= 420, `Cause ${causeCode} remains concise`);
}
for (const generated of [[], ['wrong-secondary']]) {
  const orphan = structuredClone(products);
  orphan[1].meta.remainingSource.generatedRemainingStoneIds = generated;
  const guidance = remainingRecoveryGuidance(orphan, ids[1], 'invalid-physical-layout');
  assert.deepEqual(guidance.rebuildProductRowIds, [], 'An orphan consumer cannot yield a guessed deletion order');
  assert.ok(guidance.relatedProductRowIds.includes(ids[2]));
  assert.ok(guidance.message.includes('هیچ محصولی را حذف نکنید'));
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
assert.doesNotMatch(error.issues[0].message, /ردیف|row|contract-row/i);
assert.ok(error.issues[0].message.includes(error.trackingId));
assert.ok(error.issues[0].message.includes('پیش‌نویس شما حفظ شده'));
assert.equal(JSON.stringify(products), before);
console.log('remaining recovery guidance tests passed');
