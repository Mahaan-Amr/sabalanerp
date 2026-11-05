import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAssetPolicyIntervals, type AssetPolicyInterval } from '../accountingAssetPolicyIntervals';
const d = (day: string) => new Date(`2026-01-${day}T00:00:00Z`);
const item = (version: number, from: string, to?: string): AssetPolicyInterval =>
  ({ version, effectiveFrom: d(from), effectiveTo: to ? d(to) : null });
test('new intervals are sequential, ordered and disjoint from every existing interval', () => {
  assert.doesNotThrow(() => assertAssetPolicyIntervals([], item(1, '01')));
  assert.throws(() => assertAssetPolicyIntervals([], item(2, '01')));
  assert.throws(() => assertAssetPolicyIntervals([], item(1, '02', '01')));
  assert.throws(() => assertAssetPolicyIntervals([item(1, '01')], item(2, '02')));
  assert.throws(() => assertAssetPolicyIntervals([item(1, '01', '05')], item(2, '05')));
  assert.doesNotThrow(() => assertAssetPolicyIntervals([item(1, '01', '05')], item(2, '06')));
  assert.throws(() => assertAssetPolicyIntervals([item(1, '01', '20'), item(2, '05', '06')], item(3, '07')));
  assert.throws(() => assertAssetPolicyIntervals([item(1, '01', '05')], item(2, '01')));
  assert.throws(() => assertAssetPolicyIntervals([item(1, '01', '05')], item(3, '06')));
});
