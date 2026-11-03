import assert from 'node:assert/strict';
import { parseCollateralReceiptDate } from '../hrCollateralReceiptDate';

assert.equal(parseCollateralReceiptDate('2026-08-23', new Date('2026-08-23T12:00:00Z')).toISOString(), '2026-08-23T00:00:00.000Z');
assert.throws(() => parseCollateralReceiptDate('2026-08-24', new Date('2026-08-23T12:00:00Z')), /FUTURE/);
assert.throws(() => parseCollateralReceiptDate('1405\/06\/01', new Date('2026-08-23T12:00:00Z')), /ISO_REQUIRED/);

console.log('HR collateral receipt date tests passed.');
