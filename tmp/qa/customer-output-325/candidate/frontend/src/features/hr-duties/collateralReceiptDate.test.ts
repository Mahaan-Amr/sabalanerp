import assert from 'node:assert/strict';
import { collateralReceiptDatePayload, isFutureCollateralReceiptDate } from './collateralReceiptDate';

assert.equal(collateralReceiptDatePayload('1405/06/01'), '2026-08-23');
assert.equal(isFutureCollateralReceiptDate('1405/06/02', '1405/06/01'), true);
assert.equal(isFutureCollateralReceiptDate('1405/06/01', '1405/06/01'), false);
assert.equal(isFutureCollateralReceiptDate('1405/05/31', '1405/06/01'), false);

console.log('Collateral receipt Jalali date boundary tests passed.');
